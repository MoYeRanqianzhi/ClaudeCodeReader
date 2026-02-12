//! # 文件系统扫描服务
//!
//! 提供并行文件系统扫描功能，是整个性能优化的核心模块。
//! 使用 tokio 异步 I/O 和 JoinSet 实现并行扫描，
//! 一次 Rust 函数调用替代前端原来的 1000+ 次 IPC 往返。
//!
//! ## 性能优化策略
//! 1. 使用 `tokio::fs::read_dir` 异步读取目录
//! 2. 使用 `tokio::task::JoinSet` 并行扫描所有项目目录
//! 3. 每个项目内部的会话文件 stat 也并行执行
//! 4. 一次调用返回完整的项目树

use std::path::Path;

use tokio::task::JoinSet;

use crate::models::project::{Project, Session};
use crate::utils::path::decode_project_path;

/// 并行扫描所有项目及其会话
///
/// 扫描 `~/.claude/projects/` 目录下的所有子目录，每个子目录代表一个项目。
/// 对每个项目并行扫描其会话文件，获取文件元数据（修改时间）。
///
/// # 性能特点
/// - **并行度**：所有项目目录的扫描并行执行，不再串行等待
/// - **单次 IPC**：前端只需一次 `invoke('scan_projects')` 调用，
///   替代原来的 N 次 readDir + N*M 次 stat 调用
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
/// 对每个文件获取 metadata 以读取最后修改时间。
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

    // 并行获取所有会话文件的元数据
    let mut join_set = JoinSet::new();

    for (file_name, file_path) in session_files {
        join_set.spawn(async move {
            // 获取文件元数据以读取最后修改时间
            let metadata = tokio::fs::metadata(&file_path).await.ok()?;
            let mtime = metadata.modified().ok()?;

            // 从文件名中提取会话 ID（去掉 .jsonl 扩展名）
            let session_id = file_name.trim_end_matches(".jsonl").to_string();

            // 将系统时间转换为 ISO 8601 格式字符串
            let timestamp = system_time_to_iso8601(mtime);

            Some(Session {
                id: session_id,
                name: None,
                timestamp,
                message_count: 0,
                file_path: file_path.to_string_lossy().to_string(),
            })
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
