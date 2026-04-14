//! # 文件系统扫描服务
//!
//! 提供并行文件系统扫描功能，是整个性能优化的核心模块。
//! 使用 tokio 异步 I/O 和 JoinSet 实现并行扫描，
//! 一次 Rust 函数调用替代前端原来的 1000+ 次 IPC 往返。
//!
//! ## 性能优化策略
//! 1. 使用 `tokio::fs::read_dir` 异步读取目录
//! 2. 使用 `tokio::task::JoinSet` 并行扫描所有项目目录
//! 3. 每个项目内部的会话文件 stat + 轻量读取也并行执行
//! 4. 一次调用返回完整的项目树
//!
//! ## v0.4.0 升级：head+tail 轻量读取
//! 参考 Claude Code 源码 `listSessionsImpl.ts` 的 `readSessionLite` 策略：
//! - 对每个 JSONL 文件读取 **前 64KB** (head) 和 **后 64KB** (tail)
//! - 从 head 提取: `cwd`, `gitBranch`, `timestamp`(创建时间), `isSidechain`, `firstPrompt`
//! - 从 tail 提取: `customTitle`, `aiTitle`, `lastPrompt`, `summary`, `tag`, `gitBranch`
//! - 标题优先级: `customTitle` > `aiTitle` > `lastPrompt`

use std::path::{Path, PathBuf};

use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::task::JoinSet;

use crate::models::project::{Project, Session};
use crate::utils::path::decode_project_path;

/// head+tail 轻量读取的缓冲区大小（64KB）
///
/// 与 Claude Code 源码中 `readSessionLite` 的 `LITE_READ_BYTES = 65536` 一致。
/// 64KB 足以覆盖大部分会话的前几条消息和末尾的元数据条目。
const LITE_READ_BYTES: u64 = 65_536;

/// firstPrompt 的最大截取长度（字符数）
///
/// 与 Claude Code 源码中 `MAX_FIRST_PROMPT_LENGTH = 200` 一致。
/// 避免将超长的首条用户消息完整存入内存和传输给前端。
const MAX_FIRST_PROMPT_LENGTH: usize = 200;

/// 并行扫描所有项目及其会话
///
/// 扫描 `~/.claude/projects/` 目录下的所有子目录，每个子目录代表一个项目。
/// 对每个项目并行扫描其会话文件，获取文件元数据（修改时间）并执行轻量读取提取元数据。
///
/// # 性能特点
/// - **并行度**：所有项目目录的扫描并行执行，不再串行等待
/// - **单次 IPC**：前端只需一次 `invoke('scan_projects')` 调用，
///   替代原来的 N 次 readDir + N*M 次 stat 调用
/// - **轻量读取**：每个文件仅读取 head(64KB) + tail(64KB)，不读取完整文件
///
/// # 参数
/// - `claude_path` - Claude 数据目录路径（`~/.claude/`）
///
/// # 返回值
/// 返回按最新会话时间倒序排列的 Project 数组
///
/// # 错误
/// 如果 projects 目录不可读，返回错误信息
pub async fn scan_all_projects(claude_path: &str) -> Result<Vec<Project>, String> {
    let projects_path = Path::new(claude_path).join("projects");

    // 如果 projects 目录不存在，说明没有任何项目数据
    if !projects_path.exists() {
        return Ok(vec![]);
    }

    // 第一步：读取 projects 目录下的所有条目
    let mut dir = tokio::fs::read_dir(&projects_path)
        .await
        .map_err(|e| format!("读取项目目录失败: {}", e))?;

    // 收集所有子目录的名称和完整路径
    let mut project_dirs = Vec::new();
    while let Some(entry) = dir
        .next_entry()
        .await
        .map_err(|e| format!("遍历项目目录条目失败: {}", e))?
    {
        // 检查是否为目录（跳过文件）
        let file_type = entry
            .file_type()
            .await
            .map_err(|e| format!("获取条目文件类型失败: {}", e))?;

        if file_type.is_dir() {
            let dir_name = entry.file_name().to_string_lossy().to_string();
            let dir_path = entry.path();
            project_dirs.push((dir_name, dir_path));
        }
    }

    // 第二步：使用 JoinSet 并行扫描所有项目目录的会话文件
    let mut join_set = JoinSet::new();

    for (dir_name, dir_path) in project_dirs {
        join_set.spawn(async move {
            // 解码编码后的目录名为原始文件系统路径
            let project_path = decode_project_path(&dir_name);

            // 扫描项目目录下的所有会话文件
            let sessions = scan_project_sessions(&dir_path).await.unwrap_or_default();

            Project {
                name: dir_name,
                path: project_path,
                sessions,
            }
        });
    }

    // 第三步：收集所有并行任务的结果
    let mut projects = Vec::new();
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok(project) => projects.push(project),
            Err(e) => {
                // 单个项目扫描失败不影响其他项目，仅记录日志
                log::warn!("扫描项目任务失败: {}", e);
            }
        }
    }

    // 第四步：按每个项目中最新会话的时间戳降序排列
    projects.sort_by(|a, b| {
        let a_latest = a.sessions.first().map(|s| s.timestamp.as_str()).unwrap_or("");
        let b_latest = b.sessions.first().map(|s| s.timestamp.as_str()).unwrap_or("");
        b_latest.cmp(a_latest)
    });

    Ok(projects)
}

/// 扫描指定项目目录下的所有会话文件
///
/// 遍历项目目录中的 `.jsonl` 文件，排除 `agent-` 前缀的子 agent 会话文件。
/// 对每个文件获取 metadata 并执行 head+tail 轻量读取提取元数据。
///
/// # 过滤规则
/// - 必须是文件（非目录）
/// - 必须以 `.jsonl` 结尾
/// - 排除 `agent-` 前缀的文件（子 agent 会话不应作为独立会话展示）
///
/// # 参数
/// - `project_dir` - 项目在 `~/.claude/projects/` 下的完整目录路径
///
/// # 返回值
/// 返回按时间戳降序排列的 Session 数组
async fn scan_project_sessions(project_dir: &Path) -> Result<Vec<Session>, String> {
    let mut dir = tokio::fs::read_dir(project_dir)
        .await
        .map_err(|e| format!("读取项目会话目录失败: {}", e))?;

    // 收集所有符合条件的 .jsonl 文件路径
    let mut session_files = Vec::new();
    while let Some(entry) = dir
        .next_entry()
        .await
        .map_err(|e| format!("遍历会话文件条目失败: {}", e))?
    {
        let file_name = entry.file_name().to_string_lossy().to_string();

        // 过滤条件：.jsonl 文件，非 agent- 前缀
        if file_name.ends_with(".jsonl") && !file_name.starts_with("agent-") {
            let file_type = entry.file_type().await.unwrap_or_else(|_| {
                // 在极端情况下（如符号链接损坏），默认当作普通文件处理
                std::fs::metadata(entry.path())
                    .map(|m| m.file_type())
                    .unwrap_or_else(|_| std::fs::metadata(".").unwrap().file_type())
            });

            if file_type.is_file() {
                session_files.push((file_name, entry.path()));
            }
        }
    }

    // 并行获取所有会话文件的元数据 + 轻量读取
    let mut join_set = JoinSet::new();

    for (file_name, file_path) in session_files {
        join_set.spawn(async move {
            scan_single_session(file_name, file_path).await
        });
    }

    // 收集结果
    let mut sessions = Vec::new();
    while let Some(result) = join_set.join_next().await {
        if let Ok(Some(session)) = result {
            sessions.push(session);
        }
    }

    // 按时间戳降序排列（最新修改的会话排在前面）
    sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(sessions)
}

/// 扫描单个会话文件：获取元数据 + head+tail 轻量读取
///
/// 这是 v0.4.0 的核心改动——将旧版的 stat-only 扫描升级为 head+tail 轻量读取。
/// 每个文件仅读取前 64KB 和后 64KB，从中提取会话元数据。
///
/// # 参数
/// - `file_name` - JSONL 文件名（如 "abc-123.jsonl"）
/// - `file_path` - JSONL 文件的完整路径
///
/// # 返回值
/// 成功时返回填充了元数据的 `Session`，失败时返回 `None`
async fn scan_single_session(file_name: String, file_path: PathBuf) -> Option<Session> {
    // 获取文件元数据以读取最后修改时间和文件大小
    let metadata = tokio::fs::metadata(&file_path).await.ok()?;
    let mtime = metadata.modified().ok()?;
    let file_size = metadata.len();

    // 从文件名中提取会话 ID（去掉 .jsonl 扩展名）
    let session_id = file_name.trim_end_matches(".jsonl").to_string();

    // 将系统时间转换为 ISO 8601 格式字符串
    let timestamp = system_time_to_iso8601(mtime);

    // 执行 head+tail 轻量读取，提取会话元数据
    let lite_meta = read_session_lite(&file_path, file_size).await.unwrap_or_default();

    // 按照 Claude Code 源码的标题优先级确定 name 字段：
    // customTitle > aiTitle > lastPrompt
    let name = lite_meta.custom_title
        .or(lite_meta.ai_title)
        .or(lite_meta.last_prompt);

    Some(Session {
        id: session_id,
        name,
        timestamp,
        message_count: 0,
        file_path: file_path.to_string_lossy().to_string(),
        summary: lite_meta.summary,
        first_prompt: lite_meta.first_prompt,
        git_branch: lite_meta.git_branch,
        cwd: lite_meta.cwd,
        tag: lite_meta.tag,
        created_at: lite_meta.created_at,
        file_size: Some(file_size),
        is_sidechain: lite_meta.is_sidechain,
    })
}

/// 轻量读取提取的会话元数据
///
/// 存储从 JSONL 文件 head+tail 区域中解析出的所有可用元数据字段。
/// 所有字段均为可选，因为不同的会话文件可能缺少某些条目。
#[derive(Default, Debug)]
struct LiteMetadata {
    /// 用户自定义标题（从尾部 `custom-title` 条目提取）
    custom_title: Option<String>,
    /// AI 生成标题（从尾部 `ai-title` 条目提取）
    ai_title: Option<String>,
    /// 最后一条用户输入（从尾部 `last-prompt` 条目提取）
    last_prompt: Option<String>,
    /// 会话摘要（从尾部 `summary` 条目提取）
    summary: Option<String>,
    /// 首条用户消息文本（从头部第一条 user 消息提取）
    first_prompt: Option<String>,
    /// Git 分支名（优先取尾部，回退头部）
    git_branch: Option<String>,
    /// 工作目录（从头部消息的 cwd 字段提取）
    cwd: Option<String>,
    /// 会话标签（从尾部 `tag` 条目提取）
    tag: Option<String>,
    /// 创建时间（从头部第一条消息的 timestamp 字段提取）
    created_at: Option<String>,
    /// 是否为侧链会话（从头部第一条消息的 isSidechain 字段判断）
    is_sidechain: bool,
}

/// 对 JSONL 文件执行 head+tail 轻量读取，提取会话元数据
///
/// 参考 Claude Code 源码 `readSessionLite` 的策略：
/// - 读取文件的前 64KB (head) 和后 64KB (tail)
/// - 将读取到的字节按行分割后逐行解析 JSON
/// - 从 head 行提取：cwd, gitBranch, timestamp, isSidechain, firstPrompt
/// - 从 tail 行提取：customTitle, aiTitle, lastPrompt, summary, tag, gitBranch
///
/// 对于小于 128KB 的文件，head 和 tail 可能有重叠，通过 tail 行的去重处理避免重复解析。
///
/// # 参数
/// - `file_path` - JSONL 文件的完整路径
/// - `file_size` - 文件大小（字节数），避免重复获取
///
/// # 返回值
/// 成功时返回解析出的 `LiteMetadata`，读取失败时返回 Err
async fn read_session_lite(file_path: &Path, file_size: u64) -> Result<LiteMetadata, String> {
    let mut meta = LiteMetadata::default();

    // 文件为空，直接返回默认值
    if file_size == 0 {
        return Ok(meta);
    }

    let mut file = tokio::fs::File::open(file_path)
        .await
        .map_err(|e| format!("打开文件失败: {}", e))?;

    // ---- 读取 head 区域（前 64KB）----
    let head_size = std::cmp::min(file_size, LITE_READ_BYTES) as usize;
    let mut head_buf = vec![0u8; head_size];
    file.read_exact(&mut head_buf)
        .await
        .map_err(|e| format!("读取文件头部失败: {}", e))?;

    // 将 head 字节按行分割（JSONL 每行一个 JSON 对象）
    let head_str = String::from_utf8_lossy(&head_buf);
    let head_lines: Vec<&str> = head_str.lines().collect();

    // 用于标记 head 中的 gitBranch（tail 优先级更高，如果 tail 也有则覆盖）
    let mut head_git_branch: Option<String> = None;

    // 解析 head 行
    for line in &head_lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // 尝试解析为 JSON 对象
        if let Ok(obj) = serde_json::from_str::<serde_json::Value>(line) {
            parse_head_line(&obj, &mut meta, &mut head_git_branch);
        }
    }

    // ---- 读取 tail 区域（后 64KB）----
    // 仅当文件大于 head 读取范围时才需要单独读取 tail
    if file_size > LITE_READ_BYTES {
        let tail_start = file_size - LITE_READ_BYTES;
        file.seek(std::io::SeekFrom::Start(tail_start))
            .await
            .map_err(|e| format!("Seek 到文件尾部失败: {}", e))?;

        let mut tail_buf = vec![0u8; LITE_READ_BYTES as usize];
        let bytes_read = file.read(&mut tail_buf)
            .await
            .map_err(|e| format!("读取文件尾部失败: {}", e))?;
        tail_buf.truncate(bytes_read);

        let tail_str = String::from_utf8_lossy(&tail_buf);
        let tail_lines: Vec<&str> = tail_str.lines().collect();

        // tail 区域的第一行可能是不完整的（被 seek 截断的行），跳过它
        let skip_first = tail_start > 0;

        for (i, line) in tail_lines.iter().enumerate() {
            // 跳过 tail 区域被截断的第一行
            if skip_first && i == 0 {
                continue;
            }
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(obj) = serde_json::from_str::<serde_json::Value>(line) {
                parse_tail_line(&obj, &mut meta);
            }
        }
    } else {
        // 文件较小（<= 64KB），head 已包含全部内容，从 head 行中也提取 tail 信息
        for line in &head_lines {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(obj) = serde_json::from_str::<serde_json::Value>(line) {
                parse_tail_line(&obj, &mut meta);
            }
        }
    }

    // 如果 tail 中没有找到 gitBranch，使用 head 中的值作为回退
    if meta.git_branch.is_none() {
        meta.git_branch = head_git_branch;
    }

    Ok(meta)
}

/// 从 head 区域的单行 JSON 中提取元数据
///
/// head 区域包含会话的前几条消息，从中提取：
/// - 第一条消息的 `timestamp` → `created_at`
/// - 第一条消息的 `cwd` → `cwd`
/// - 第一条消息的 `gitBranch` → `git_branch`（低优先级，tail 可覆盖）
/// - 第一条消息的 `isSidechain` → `is_sidechain`
/// - 第一条 `type: "user"` 消息的文本 → `first_prompt`
///
/// # 参数
/// - `obj` - 解析后的 JSON 对象
/// - `meta` - 当前累积的元数据（就地修改）
/// - `head_git_branch` - head 区域发现的 gitBranch（低优先级缓存）
fn parse_head_line(
    obj: &serde_json::Value,
    meta: &mut LiteMetadata,
    head_git_branch: &mut Option<String>,
) {
    let entry_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");

    // 提取创建时间（仅第一条消息有效，后续不覆盖）
    if meta.created_at.is_none() {
        if let Some(ts) = obj.get("timestamp").and_then(|v| v.as_str()) {
            meta.created_at = Some(ts.to_string());
        }
    }

    // 提取工作目录（仅第一条消息有效，后续不覆盖）
    if meta.cwd.is_none() {
        if let Some(cwd) = obj.get("cwd").and_then(|v| v.as_str()) {
            meta.cwd = Some(cwd.to_string());
        }
    }

    // 提取 Git 分支（head 的值为低优先级，tail 可覆盖）
    if head_git_branch.is_none() {
        if let Some(branch) = obj.get("gitBranch").and_then(|v| v.as_str()) {
            *head_git_branch = Some(branch.to_string());
        }
    }

    // 检测侧链标记（仅检查第一条消息）
    if !meta.is_sidechain {
        if let Some(true) = obj.get("isSidechain").and_then(|v| v.as_bool()) {
            meta.is_sidechain = true;
        }
    }

    // 提取首条用户消息文本（仅第一条 user 消息有效）
    if meta.first_prompt.is_none() && entry_type == "user" {
        meta.first_prompt = extract_message_text(obj);
        // 截取到最大长度
        if let Some(ref mut text) = meta.first_prompt {
            if text.chars().count() > MAX_FIRST_PROMPT_LENGTH {
                let truncated: String = text.chars().take(MAX_FIRST_PROMPT_LENGTH).collect();
                *text = truncated;
            }
        }
    }
}

/// 从 tail 区域的单行 JSON 中提取元数据条目
///
/// tail 区域包含会话末尾追加的元数据条目，从中提取：
/// - `type: "custom-title"` → `custom_title`
/// - `type: "ai-title"` → `ai_title`
/// - `type: "last-prompt"` → `last_prompt`
/// - `type: "summary"` → `summary`
/// - `type: "tag"` → `tag`
/// - 任何消息的 `gitBranch` 字段 → `git_branch`（tail 优先级最高）
///
/// 注意：这些条目可能存在多次（每次都会覆盖之前的值），保留最后一次的值。
///
/// # 参数
/// - `obj` - 解析后的 JSON 对象
/// - `meta` - 当前累积的元数据（就地修改）
fn parse_tail_line(obj: &serde_json::Value, meta: &mut LiteMetadata) {
    let entry_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match entry_type {
        // 用户自定义标题（每次覆盖，保留最新值）
        "custom-title" => {
            if let Some(title) = obj.get("customTitle").and_then(|v| v.as_str()) {
                meta.custom_title = Some(title.to_string());
            }
        }
        // AI 生成标题（每次覆盖，保留最新值）
        "ai-title" => {
            if let Some(title) = obj.get("aiTitle").and_then(|v| v.as_str()) {
                meta.ai_title = Some(title.to_string());
            }
        }
        // 最后一条用户输入（每次覆盖，保留最新值）
        "last-prompt" => {
            if let Some(prompt) = obj.get("lastPrompt").and_then(|v| v.as_str()) {
                meta.last_prompt = Some(prompt.to_string());
            }
        }
        // 会话摘要（每次覆盖，保留最新值）
        "summary" => {
            if let Some(summary) = obj.get("summary").and_then(|v| v.as_str()) {
                meta.summary = Some(summary.to_string());
            }
        }
        // 会话标签（每次覆盖，保留最新值）
        "tag" => {
            if let Some(tag) = obj.get("tag").and_then(|v| v.as_str()) {
                meta.tag = Some(tag.to_string());
            }
        }
        _ => {}
    }

    // tail 区域中所有消息的 gitBranch 都可能有值，保留最后一个
    // 这反映了会话结束时的分支状态，比 head 的更准确
    if let Some(branch) = obj.get("gitBranch").and_then(|v| v.as_str()) {
        meta.git_branch = Some(branch.to_string());
    }
}

/// 从消息对象中提取纯文本内容
///
/// 处理 `message.content` 的两种格式：
/// - 字符串格式：直接返回
/// - 数组格式：提取所有 text 类型块的 text 字段并拼接
///
/// # 参数
/// - `obj` - 消息 JSON 对象
///
/// # 返回值
/// 提取到的纯文本，无内容时返回 None
fn extract_message_text(obj: &serde_json::Value) -> Option<String> {
    let content = obj.get("message")?.get("content")?;

    match content {
        // 字符串格式：直接返回
        serde_json::Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        // 数组格式：拼接所有 text 块
        serde_json::Value::Array(arr) => {
            let mut buf = String::new();
            for block in arr {
                if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                    if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                        if !buf.is_empty() {
                            buf.push('\n');
                        }
                        buf.push_str(t);
                    }
                }
            }
            let trimmed = buf.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        _ => None,
    }
}

/// 将 `SystemTime` 转换为 ISO 8601 格式字符串
///
/// 由于不引入额外的时间库（如 chrono），使用标准库手动转换。
/// 格式：`YYYY-MM-DDTHH:MM:SS.sssZ`（UTC 时间）
///
/// # 参数
/// - `time` - 要转换的系统时间
///
/// # 返回值
/// ISO 8601 格式的时间字符串；如果转换失败返回当前 Unix 时间戳字符串
fn system_time_to_iso8601(time: std::time::SystemTime) -> String {
    // 计算自 Unix epoch 以来的毫秒数
    match time.duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => {
            let total_secs = duration.as_secs();
            let millis = duration.subsec_millis();

            // 手动计算日期时间各分量（UTC）
            // 使用简化的日期计算算法
            let days = total_secs / 86400;
            let time_of_day = total_secs % 86400;
            let hours = time_of_day / 3600;
            let minutes = (time_of_day % 3600) / 60;
            let seconds = time_of_day % 60;

            // 从天数计算年月日（基于 1970-01-01）
            let (year, month, day) = days_to_date(days);

            format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
                year, month, day, hours, minutes, seconds, millis
            )
        }
        Err(_) => {
            // 如果系统时间早于 Unix epoch（不太可能），返回 epoch
            "1970-01-01T00:00:00.000Z".to_string()
        }
    }
}

/// 将自 1970-01-01 以来的天数转换为 (年, 月, 日)
///
/// 使用公历日期计算算法，正确处理闰年。
///
/// # 参数
/// - `days_since_epoch` - 自 Unix epoch (1970-01-01) 以来的天数
///
/// # 返回值
/// (year, month, day) 元组
fn days_to_date(days_since_epoch: u64) -> (u64, u64, u64) {
    // 将 epoch 偏移到公元 0 年 3 月 1 日以简化闰年计算
    // 使用 Howard Hinnant 的算法：http://howardhinnant.github.io/date_algorithms.html
    let z = days_since_epoch + 719468;
    let era = z / 146097;
    let doe = z - era * 146097; // day of era [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // year of era [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // day of year [0, 365]
    let mp = (5 * doy + 2) / 153; // month index [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // day [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // month [1, 12]
    let y = if m <= 2 { y + 1 } else { y };

    (y, m, d)
}
