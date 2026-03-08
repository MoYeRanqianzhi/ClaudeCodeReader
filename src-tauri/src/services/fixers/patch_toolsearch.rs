//! # 修复项：解除 Claude Code ToolSearch 域名限制
//!
//! ## 修复信息
//!
//! - **修复者（Author）**：MoYeRanQianZhi（CCR 项目维护者）
//! - **修复模型（Model）**：Claude Opus 4.6
//! - **修复时间（Date）**：2026-03-08
//! - **修复设备（Device）**：Windows 11 PC
//! - **档位（Level）**：Full（特殊修复）
//!
//! ## 问题描述
//!
//! Claude Code 的 ToolSearch 功能内置了域名白名单检查，
//! 仅允许 `api.anthropic.com` 域名通过验证。
//! 当用户使用第三方 API 代理（如自建中转、镜像站）时，
//! ToolSearch 功能因域名校验失败而无法使用。
//!
//! 具体表现为打包后的 JS 代码中存在如下检查逻辑：
//! ```js
//! return["api.anthropic.com"].includes(<varname>)}catch{return!1}
//! ```
//! 该检查会在域名不匹配时返回 `false`，导致 ToolSearch 被禁用。
//!
//! ## 修复方式
//!
//! 通过字节级正则匹配找到上述域名检查代码，并进行等长替换：
//! 将 `return["api.anthropic.com"].includes(...)` 替换为 `return!0/*...*/`，
//! 同时将 `catch{return!1}` 替换为 `catch{return!0}`，
//! 使函数始终返回 `true`，从而绕过域名白名单限制。
//!
//! 等长替换确保不改变文件大小，避免可能的偏移量问题。
//!
//! ## 致谢
//!
//! 本修复方案的脚本思路来自 L 站（Linux.do）的**此方**大佬，
//! 原帖地址：<https://linux.do/t/topic/1703407>
//!
//! ## 为什么使用 Full 档位
//!
//! 该修复操作的是 Claude Code 的安装文件（二进制/JS），
//! 而非会话 JSONL 文件。安装位置可能在 `~/.local/bin/`、
//! npm 全局目录、VS Code/Cursor 扩展目录等，
//! 均不在 `~/.claude/` 路径范围内，因此必须使用 Full 档位。

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;

use regex::bytes::Regex;

use crate::services::cache::AppCache;
use crate::services::fixers::{FixDefinition, FixLevel, FixResult};

// ============ 补丁定义常量 ============

/// 补丁替换前缀：`return!0/*`
///
/// 将原始的域名检查 `return["api.anthropic.com"].includes(...)` 替换为
/// 始终返回 true 的 `return!0`，后跟多行注释开头 `/*` 用于填充剩余空间。
const PATCH_PREFIX: &[u8] = b"return!0/*";

/// 补丁替换后缀：`*/}catch{return!0}`
///
/// 多行注释结尾 `*/` 关闭填充区域，然后将 `catch{return!1}` 替换为
/// `catch{return!0}`，使异常处理也返回 true。
const PATCH_SUFFIX: &[u8] = b"*/}catch{return!0}";

/// 备份文件后缀名
///
/// 对 Claude Code 安装文件进行补丁前，
/// 先以此后缀创建备份文件，方便用户恢复。
/// `pub(super)` 供 `restore_toolsearch` 模块复用。
pub(super) const BACKUP_SUFFIX: &str = ".toolsearch-bak";

// ============ 安装探测结构体 ============

/// 表示系统中检测到的一个 Claude Code 安装
///
/// 每个安装实例包含目标文件路径和人类可读的描述信息。
/// 安装类型信息已包含在 description 字段中（如 "Bun 官方安装"、"npm 全局安装"）。
/// `pub(super)` 供 `restore_toolsearch` 模块复用。
#[derive(Debug)]
pub(super) struct Installation {
    /// 需要补丁的目标文件的绝对路径
    pub(super) target: PathBuf,
    /// 人类可读的安装描述（如 "Bun 官方安装 (C:\Users\xxx\.local\bin\claude.exe)"）
    pub(super) description: String,
}

/// 单个安装的补丁结果
///
/// 记录每个安装的补丁操作结果，用于汇总报告。
#[derive(Debug)]
struct PatchResult {
    /// 安装描述
    description: String,
    /// 是否成功
    success: bool,
    /// 结果消息
    message: String,
}

// ============ 公开接口 ============

/// 返回修复项的元数据定义
///
/// 提供 ToolSearch 域名限制修复的完整描述信息，
/// 供前端列表展示和搜索过滤使用。
pub fn definition() -> FixDefinition {
    FixDefinition {
        id: "patch_toolsearch".to_string(),
        name: "ToolSearch 域名限制（全局补丁）".to_string(),
        description: concat!(
            "Claude Code 的 ToolSearch 功能内置了域名白名单检查，",
            "仅允许 api.anthropic.com 域名。\n",
            "使用第三方 API 代理时，ToolSearch 因域名校验失败而无法使用。\n\n",
            "本修复会扫描系统中所有 Claude Code 安装（bun / npm / pnpm / ",
            "VS Code / Cursor），自动应用补丁解除限制。\n\n",
            "⚠️ 注意：本修复与当前打开的会话文件无关，",
            "它直接修改 Claude Code 的安装文件。",
            "修复后需要重启 Claude Code 生效。\n\n",
            "致谢：脚本思路来自 Linux.do 的此方大佬\n",
            "原帖：https://linux.do/t/topic/1703407",
        )
        .to_string(),
        fix_method: concat!(
            "扫描所有 Claude Code 安装位置，找到包含域名检查代码的文件，",
            "通过等长字节替换将域名校验逻辑改为始终返回 true。\n",
            "替换前自动创建 .toolsearch-bak 备份文件。",
        )
        .to_string(),
        tags: vec![
            "toolsearch".to_string(),
            "tool_search".to_string(),
            "域名限制".to_string(),
            "api.anthropic.com".to_string(),
            "代理".to_string(),
            "proxy".to_string(),
            "search".to_string(),
        ],
        level: FixLevel::Full,
    }
}

/// 执行修复（Full 档位函数指针入口）
///
/// 扫描系统中所有 Claude Code 安装，自动检测并应用 ToolSearch 域名限制补丁。
///
/// # 参数
/// - `_session_file_path` — 会话文件路径（本修复不使用，仅为满足 Full 档位签名）
/// - `_cache` — AppCache 引用（本修复不使用 file_guard，因为操作的不是会话文件）
///
/// # 返回值
/// 成功时返回 FixResult，包含所有安装的补丁结果汇总；
/// 失败时返回错误描述字符串。
pub fn execute<'a>(
    _session_file_path: &'a str,
    _cache: &'a AppCache,
) -> Pin<Box<dyn Future<Output = Result<FixResult, String>> + Send + 'a>> {
    Box::pin(execute_inner())
}

// ============ 内部实现 ============

/// 修复逻辑的内部实现
///
/// 执行完整的扫描 → 检测 → 补丁流程：
/// 1. 探测所有 Claude Code 安装位置
/// 2. 对每个安装检查补丁状态
/// 3. 对未补丁的安装执行补丁操作
/// 4. 汇总所有结果
async fn execute_inner() -> Result<FixResult, String> {
    // 第 1 步：探测所有 Claude Code 安装
    let installations = find_all_installations().await;

    // 没有找到任何安装
    if installations.is_empty() {
        return Ok(FixResult {
            success: true,
            message: concat!(
                "未检测到任何 Claude Code 安装。\n",
                "支持的安装方式：bun 官方安装 / npm -g / pnpm add -g / ",
                "VS Code·Cursor 扩展",
            )
            .to_string(),
            affected_lines: 0,
        });
    }

    // 第 2 步：对每个安装执行补丁
    let mut results: Vec<PatchResult> = Vec::new();
    let mut success_count: usize = 0;

    for inst in &installations {
        let patch_result = apply_patch_to_installation(inst).await;
        if patch_result.success {
            success_count += 1;
        }
        results.push(patch_result);
    }

    // 第 3 步：汇总结果消息
    let mut report = String::new();
    report.push_str(&format!(
        "扫描到 {} 个安装，成功补丁 {} 个：\n",
        installations.len(),
        success_count,
    ));

    for r in &results {
        // 使用 ✓ 或 ✗ 标记每个安装的结果
        let icon = if r.success { "✓" } else { "✗" };
        report.push_str(&format!("\n{} [{}]\n  {}", icon, r.description, r.message));
    }

    // 补丁成功时提醒用户重启
    if success_count > 0 {
        report.push_str("\n\n请重启 Claude Code 使补丁生效。");
    }

    Ok(FixResult {
        success: true,
        message: report,
        // affected_lines 用于表示成功补丁的安装数量
        affected_lines: success_count,
    })
}

// ============ 补丁核心逻辑 ============

/// 构造正则：匹配未补丁的域名检查代码
///
/// 匹配形如：
/// `return["api.anthropic.com"].includes(<varname>)}catch{return!1}`
/// 其中 `<varname>` 是任意合法的 JS 标识符。
///
/// 使用字节模式的正则匹配，因为目标可能是二进制文件。
fn build_target_regex() -> Result<Regex, String> {
    // 正则解释：
    // return\["api\.anthropic\.com"\]\.includes\(  — 匹配域名检查的开头
    // [A-Za-z_$][A-Za-z0-9_$]*                    — 匹配 JS 变量名（混淆后可能是任意合法标识符）
    // \)\}catch\{return!1\}                         — 匹配检查的结尾（失败时返回 false）
    Regex::new(
        r#"return\["api\.anthropic\.com"\]\.includes\([A-Za-z_$][A-Za-z0-9_$]*\)\}catch\{return!1\}"#,
    )
    .map_err(|e| format!("构造补丁正则表达式失败: {}", e))
}

/// 构造正则：匹配已补丁的代码
///
/// 匹配形如：`return!0/* ... */}catch{return!0}`
/// 用于检测文件是否已经打过补丁。
fn build_patched_regex() -> Result<Regex, String> {
    Regex::new(r#"return!0/\* *\*/\}catch\{return!0\}"#)
        .map_err(|e| format!("构造已补丁正则表达式失败: {}", e))
}

/// 根据匹配长度动态生成等长替换字节
///
/// 替换结构：`return!0/*<padding>*/}catch{return!0}`
/// 其中 `<padding>` 是空格填充，确保替换后的总长度与原始匹配完全相同。
///
/// # 参数
/// - `original_len` — 原始匹配的字节长度
///
/// # 返回值
/// 等长的替换字节序列
///
/// # 错误
/// 如果原始匹配长度小于前缀+后缀的长度，则无法生成有效替换
fn build_patched_bytes(original_len: usize) -> Result<Vec<u8>, String> {
    let prefix_len = PATCH_PREFIX.len();
    let suffix_len = PATCH_SUFFIX.len();
    let min_len = prefix_len + suffix_len;

    // 确保原始长度足够容纳前缀和后缀
    if original_len < min_len {
        return Err(format!(
            "匹配长度 {} 小于补丁模板最小长度 {}，无法生成等长替换",
            original_len, min_len,
        ));
    }

    // 计算中间填充空格的数量
    let padding = original_len - min_len;

    // 组装：前缀 + 空格填充 + 后缀
    let mut result = Vec::with_capacity(original_len);
    result.extend_from_slice(PATCH_PREFIX);
    result.extend(std::iter::repeat_n(b' ', padding));
    result.extend_from_slice(PATCH_SUFFIX);

    Ok(result)
}

/// 检测文件的补丁状态
///
/// 读取文件内容并判断是否包含目标补丁模式或已补丁模式。
///
/// # 参数
/// - `data` — 文件的原始字节内容
///
/// # 返回值
/// - `"unpatched"` — 包含未补丁的域名检查代码
/// - `"patched"` — 已经补丁过
/// - `"unknown"` — 既不包含目标模式也不包含已补丁模式（版本不兼容）
fn get_patch_status(data: &[u8]) -> Result<&'static str, String> {
    let target_re = build_target_regex()?;
    let patched_re = build_patched_regex()?;

    if target_re.is_match(data) {
        return Ok("unpatched");
    }
    if patched_re.is_match(data) {
        return Ok("patched");
    }
    Ok("unknown")
}

/// 对文件字节内容执行补丁替换
///
/// 使用正则匹配找到所有域名检查代码，并用等长的补丁字节替换。
///
/// # 参数
/// - `data` — 文件的原始字节内容
///
/// # 返回值
/// 元组 `(patched_data, replacement_count)`：
/// - `patched_data` — 补丁后的字节内容
/// - `replacement_count` — 替换的匹配数量
fn patch_bytes(data: &[u8]) -> Result<(Vec<u8>, usize), String> {
    let target_re = build_target_regex()?;

    // 收集所有匹配的位置和长度（需要先收集，因为 Regex::replace_all 不能直接计数）
    let matches: Vec<_> = target_re.find_iter(data).collect();
    let count = matches.len();

    if count == 0 {
        // 没有匹配，返回原始数据的克隆
        return Ok((data.to_vec(), 0));
    }

    // 手动进行替换（因为每个匹配可能长度不同，需要分别生成等长替换）
    let mut result = Vec::with_capacity(data.len());
    let mut last_end = 0;

    for m in &matches {
        // 复制匹配之前的部分
        result.extend_from_slice(&data[last_end..m.start()]);
        // 生成等长替换字节并追加
        let replacement = build_patched_bytes(m.len())?;
        result.extend_from_slice(&replacement);
        last_end = m.end();
    }

    // 复制最后一个匹配之后的部分
    result.extend_from_slice(&data[last_end..]);

    Ok((result, count))
}

/// 对单个安装执行补丁
///
/// 完整的单安装补丁流程：
/// 1. 读取目标文件
/// 2. 检查补丁状态
/// 3. 创建备份文件
/// 4. 执行字节替换
/// 5. 写回文件（Windows 上如果文件被占用，尝试重命名方式）
///
/// # 参数
/// - `inst` — 安装信息
///
/// # 返回值
/// 补丁结果，包含描述、是否成功和结果消息
async fn apply_patch_to_installation(inst: &Installation) -> PatchResult {
    let desc = inst.description.clone();

    // 读取目标文件内容
    let data = match tokio::fs::read(&inst.target).await {
        Ok(d) => d,
        Err(e) => {
            return PatchResult {
                description: desc,
                success: false,
                message: format!("读取文件失败: {}", e),
            };
        }
    };

    // 检查当前补丁状态
    let status = match get_patch_status(&data) {
        Ok(s) => s,
        Err(e) => {
            return PatchResult {
                description: desc,
                success: false,
                message: format!("检查补丁状态失败: {}", e),
            };
        }
    };

    match status {
        "patched" => {
            // 已经补丁过，跳过
            return PatchResult {
                description: desc,
                success: true,
                message: "已经补丁过，跳过。".to_string(),
            };
        }
        "unknown" => {
            // 版本不兼容，无法补丁
            return PatchResult {
                description: desc,
                success: false,
                message: "未找到目标字符串，可能版本不兼容。".to_string(),
            };
        }
        // "unpatched" — 继续执行补丁
        _ => {}
    }

    // 执行字节替换
    let (patched_data, count) = match patch_bytes(&data) {
        Ok(r) => r,
        Err(e) => {
            return PatchResult {
                description: desc,
                success: false,
                message: format!("生成补丁字节失败: {}", e),
            };
        }
    };

    if count == 0 {
        return PatchResult {
            description: desc,
            success: false,
            message: "未找到匹配项（状态检查与补丁不一致）".to_string(),
        };
    }

    // 创建备份文件（在目标文件同目录，添加 .toolsearch-bak 后缀）
    let backup_path = format!("{}{}", inst.target.display(), BACKUP_SUFFIX);
    if let Err(e) = tokio::fs::copy(&inst.target, &backup_path).await {
        return PatchResult {
            description: desc,
            success: false,
            message: format!("创建备份文件失败: {}", e),
        };
    }

    // 写入补丁后的内容
    let write_result = write_patched_file(&inst.target, &patched_data).await;

    match write_result {
        Ok(()) => PatchResult {
            description: desc,
            success: true,
            message: format!(
                "补丁成功，共替换 {} 处。备份: {}",
                count, backup_path,
            ),
        },
        Err(e) => PatchResult {
            description: desc,
            success: false,
            message: format!("写入补丁文件失败: {}", e),
        },
    }
}

/// 写入补丁后的文件内容
///
/// 先尝试直接覆写，如果文件被占用（Windows 上常见于运行中的 exe），
/// 则使用重命名方式替换：
/// 1. 将补丁内容写入 `.tmp` 临时文件
/// 2. 将原文件重命名为 `.old`
/// 3. 将临时文件重命名为原文件名
/// 4. 删除 `.old` 文件
///
/// `pub(super)` 供 `restore_toolsearch` 模块复用。
///
/// # 参数
/// - `target` — 目标文件路径
/// - `data` — 要写入的字节内容
pub(super) async fn write_patched_file(target: &Path, data: &[u8]) -> Result<(), String> {
    // 尝试直接写入
    match tokio::fs::write(target, data).await {
        Ok(()) => return Ok(()),
        Err(e) => {
            // 仅在权限错误（文件被占用）时尝试重命名方式
            if e.kind() != std::io::ErrorKind::PermissionDenied {
                return Err(format!("写入失败: {}", e));
            }
            // 继续尝试重命名方式
        }
    }

    // 重命名方式替换（适用于 Windows 上文件被运行中进程占用的情况）
    let target_str = target.display().to_string();
    let tmp_path = format!("{}.tmp", target_str);
    let old_path = format!("{}.old", target_str);

    // 清理之前可能残留的临时文件
    let _ = tokio::fs::remove_file(&tmp_path).await;
    let _ = tokio::fs::remove_file(&old_path).await;

    // 将补丁内容写入临时文件
    tokio::fs::write(&tmp_path, data)
        .await
        .map_err(|e| format!("写入临时文件失败: {}", e))?;

    // 将原文件重命名为 .old（运行中的 exe 在 Windows 上可以重命名但不能覆写）
    if let Err(e) = tokio::fs::rename(target, &old_path).await {
        // 重命名失败，清理临时文件并返回错误
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(format!(
            "无法重命名 {}，请关闭 Claude Code 后重试: {}",
            target.display(),
            e,
        ));
    }

    // 将临时文件重命名为原文件名
    tokio::fs::rename(&tmp_path, target)
        .await
        .map_err(|e| format!("重命名临时文件失败: {}", e))?;

    // 尝试删除旧文件（正在运行时可能删不掉，不影响功能）
    let _ = tokio::fs::remove_file(&old_path).await;

    Ok(())
}

// ============ 安装探测 ============

/// 探测系统中所有 Claude Code 安装
///
/// 并行扫描以下安装方式：
/// - Bun 官方安装（二进制）
/// - npm 全局安装
/// - pnpm 全局安装
/// - VS Code / Cursor 扩展捆绑
///
/// `pub(super)` 供 `restore_toolsearch` 模块复用。
///
/// 返回所有探测到的安装列表。
pub(super) async fn find_all_installations() -> Vec<Installation> {
    let mut all: Vec<Installation> = Vec::new();

    // 依次探测各种安装方式
    all.extend(find_bun_installations().await);
    all.extend(find_npm_installations().await);
    all.extend(find_pnpm_installations().await);
    all.extend(find_vscode_installations().await);

    all
}

/// 获取用户主目录
///
/// 封装 `dirs::home_dir()`，方便统一调用。
fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

/// 在 npm/pnpm 包目录中搜索包含域名检查代码的 JS 文件
///
/// 搜索策略：
/// 1. 优先检查 `cli.js`（最常见的入口文件）
/// 2. 如果没有找到，递归搜索目录下所有 `.js` 文件
/// 3. 跳过小于 1000 字节的文件（不太可能是主要代码文件）
///
/// # 参数
/// - `pkg_dir` — `@anthropic-ai/claude-code` 包目录的路径
///
/// # 返回值
/// 找到的包含目标代码的文件路径，或 None
async fn find_patch_target_in_pkg(pkg_dir: &Path) -> Option<PathBuf> {
    // 用于快速检测的关键字节序列（比完整正则匹配快得多）
    let marker = b"api.anthropic.com";

    // 优先检查 cli.js（大多数 npm 包的入口文件）
    let cli_js = pkg_dir.join("cli.js");
    if cli_js.is_file() {
        if let Ok(data) = tokio::fs::read(&cli_js).await {
            if memchr::memmem::find(&data, marker).is_some() {
                return Some(cli_js);
            }
        }
    }

    // 递归搜索目录下的 .js 文件
    // 使用同步遍历（因为 tokio 没有内置的递归目录遍历）
    let pkg_dir_owned = pkg_dir.to_path_buf();
    let result = tokio::task::spawn_blocking(move || {
        find_js_with_marker_sync(&pkg_dir_owned, marker)
    })
    .await;

    match result {
        Ok(found) => found,
        Err(_) => None,
    }
}

/// 同步递归搜索目录中包含指定字节标记的 JS 文件
///
/// 在 `spawn_blocking` 中执行，避免阻塞异步 runtime。
///
/// # 参数
/// - `dir` — 要搜索的目录
/// - `marker` — 要查找的字节序列
fn find_js_with_marker_sync(dir: &Path, marker: &[u8]) -> Option<PathBuf> {
    // 使用 walkdir 风格的手动递归遍历
    let mut stack = vec![dir.to_path_buf()];

    while let Some(current_dir) = stack.pop() {
        let entries = match std::fs::read_dir(&current_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_dir() {
                // 将子目录压入栈以递归处理
                stack.push(path);
            } else if path.is_file() {
                // 检查是否是 .js 文件且大小 >= 1000 字节
                let is_js = path
                    .extension()
                    .is_some_and(|ext| ext == "js");

                if !is_js {
                    continue;
                }

                // 检查文件大小
                let metadata = match std::fs::metadata(&path) {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                if metadata.len() < 1000 {
                    continue;
                }

                // 读取文件内容并检查是否包含标记
                if let Ok(data) = std::fs::read(&path) {
                    if memchr::memmem::find(&data, marker).is_some() {
                        return Some(path);
                    }
                }
            }
        }
    }

    None
}

/// 查找 Bun 官方安装的 Claude 二进制
///
/// 根据操作系统平台，检查以下位置：
/// - **Windows**: `~/.local/bin/claude.exe`
/// - **macOS/Linux**: `~/.claude/local/claude` 和 `~/.local/bin/claude`
async fn find_bun_installations() -> Vec<Installation> {
    let mut results = Vec::new();

    let home = match home_dir() {
        Some(h) => h,
        None => return results,
    };

    // 根据平台构建候选路径列表
    let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
        vec![home.join(".local").join("bin").join("claude.exe")]
    } else {
        vec![
            home.join(".claude").join("local").join("claude"),
            home.join(".local").join("bin").join("claude"),
        ]
    };

    // 检查每个候选路径
    for path in candidates {
        if path.is_file() {
            results.push(Installation {
                target: path.clone(),
                description: format!("Bun 官方安装 ({})", path.display()),
            });
        }
    }

    results
}

/// 查找 npm 全局安装
///
/// 策略：
/// 1. 尝试执行 `npm root -g` 获取全局包目录
/// 2. 在全局包目录下查找 `@anthropic-ai/claude-code`
/// 3. 如果 npm 命令不可用，回退到扫描已知的版本管理器目录
async fn find_npm_installations() -> Vec<Installation> {
    let mut results = Vec::new();

    // 尝试通过 npm root -g 获取全局包目录
    if let Some(npm_root) = run_cmd_async("npm", &["root", "-g"]).await {
        let pkg_dir = PathBuf::from(&npm_root)
            .join("@anthropic-ai")
            .join("claude-code");

        if pkg_dir.is_dir() {
            if let Some(target) = find_patch_target_in_pkg(&pkg_dir).await {
                results.push(Installation {
                    target: target.clone(),
                    description: format!("npm 全局安装 ({})", target.display()),
                });
                return results;
            }
        }
    }

    // npm 命令不可用时，回退到扫描版本管理器目录
    results.extend(find_npm_fallback().await);
    results
}

/// npm 命令不可用时的回退搜索
///
/// 扫描以下版本管理器的安装目录：
/// - **Windows**: npm 默认全局、nvm-windows、fnm
/// - **macOS/Linux**: nvm、fnm、系统级 npm
/// - **跨平台**: volta
async fn find_npm_fallback() -> Vec<Installation> {
    let mut results = Vec::new();

    let home = match home_dir() {
        Some(h) => h,
        None => return results,
    };

    // 构建搜索目录列表：(node_modules 路径, 描述)
    let mut search_dirs: Vec<(PathBuf, String)> = Vec::new();

    if cfg!(target_os = "windows") {
        // Windows 平台的搜索路径

        // npm 默认全局目录（%APPDATA%/npm/node_modules）
        if let Ok(appdata) = std::env::var("APPDATA") {
            let appdata_path = PathBuf::from(&appdata);
            search_dirs.push((
                appdata_path.join("npm").join("node_modules"),
                "npm 默认全局".to_string(),
            ));

            // nvm-windows（%NVM_HOME% 或 %APPDATA%/nvm）
            let nvm_home = std::env::var("NVM_HOME")
                .unwrap_or_else(|_| appdata_path.join("nvm").display().to_string());
            let nvm_path = PathBuf::from(&nvm_home);
            if nvm_path.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&nvm_path) {
                    for entry in entries.flatten() {
                        let nm = entry.path().join("node_modules");
                        if entry.path().is_dir() && nm.is_dir() {
                            let name = entry.file_name().to_string_lossy().to_string();
                            search_dirs.push((nm, format!("nvm ({})", name)));
                        }
                    }
                }
            }
        }

        // fnm（%FNM_DIR% 或 ~/.fnm）
        let fnm_dir = std::env::var("FNM_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join(".fnm"));
        let nv = fnm_dir.join("node-versions");
        if nv.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&nv) {
                for entry in entries.flatten() {
                    let nm = entry.path().join("installation").join("node_modules");
                    if nm.is_dir() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        search_dirs.push((nm, format!("fnm ({})", name)));
                    }
                }
            }
        }
    } else {
        // macOS / Linux 平台的搜索路径

        // nvm（$NVM_DIR 或 ~/.nvm）
        let nvm_dir = std::env::var("NVM_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join(".nvm"));
        let versions = nvm_dir.join("versions").join("node");
        if versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&versions) {
                for entry in entries.flatten() {
                    let nm = entry
                        .path()
                        .join("lib")
                        .join("node_modules");
                    if nm.is_dir() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        search_dirs.push((nm, format!("nvm ({})", name)));
                    }
                }
            }
        }

        // fnm
        let fnm_dir = std::env::var("FNM_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join(".fnm"));
        let nv = fnm_dir.join("node-versions");
        if nv.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&nv) {
                for entry in entries.flatten() {
                    let nm = entry
                        .path()
                        .join("installation")
                        .join("lib")
                        .join("node_modules");
                    if nm.is_dir() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        search_dirs.push((nm, format!("fnm ({})", name)));
                    }
                }
            }
        }

        // 系统级 npm 目录
        for sys_path in ["/usr/local/lib/node_modules", "/usr/lib/node_modules"] {
            let p = PathBuf::from(sys_path);
            if p.is_dir() {
                search_dirs.push((p, "系统 npm".to_string()));
            }
        }
    }

    // volta（跨平台：$VOLTA_HOME 或 ~/.volta）
    let volta_home = std::env::var("VOLTA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home.join(".volta"));
    let volta_node = volta_home.join("tools").join("image").join("node");
    if volta_node.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&volta_node) {
            for entry in entries.flatten() {
                // Windows 上 node_modules 直接在版本目录下，
                // macOS/Linux 上在 lib/node_modules 下
                let nm = if cfg!(target_os = "windows") {
                    entry.path().join("node_modules")
                } else {
                    entry.path().join("lib").join("node_modules")
                };
                if nm.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    search_dirs.push((nm, format!("volta ({})", name)));
                }
            }
        }
    }

    // 在所有搜索目录中查找 @anthropic-ai/claude-code
    // 使用 HashSet 去重（同一个 resolve 后的文件只报告一次）
    let mut seen = std::collections::HashSet::new();

    for (nm_dir, desc) in &search_dirs {
        let pkg_dir = nm_dir.join("@anthropic-ai").join("claude-code");
        if pkg_dir.is_dir() {
            if let Some(target) = find_patch_target_in_pkg(&pkg_dir).await {
                // 尝试 resolve 到真实路径进行去重
                let key = target
                    .canonicalize()
                    .unwrap_or_else(|_| target.clone())
                    .display()
                    .to_string();

                if seen.insert(key) {
                    results.push(Installation {
                        target: target.clone(),
                        description: format!("npm ({}) ({})", desc, target.display()),
                    });
                }
            }
        }
    }

    results
}

/// 查找 pnpm 全局安装
///
/// 通过 `pnpm root -g` 获取全局包目录，然后搜索目标包。
/// 如果在标准位置未找到，回退到 `.pnpm` 目录下搜索。
async fn find_pnpm_installations() -> Vec<Installation> {
    let mut results = Vec::new();

    // 通过 pnpm root -g 获取全局包目录
    let pnpm_root = match run_cmd_async("pnpm", &["root", "-g"]).await {
        Some(root) => root,
        None => return results,
    };

    let pkg_dir = PathBuf::from(&pnpm_root)
        .join("@anthropic-ai")
        .join("claude-code");

    if pkg_dir.is_dir() {
        if let Some(target) = find_patch_target_in_pkg(&pkg_dir).await {
            // 使用 canonicalize 解析符号链接到实际文件
            let resolved = target.canonicalize().unwrap_or(target);
            results.push(Installation {
                target: resolved.clone(),
                description: format!("pnpm 全局安装 ({})", resolved.display()),
            });
            return results;
        }
    }

    // 回退：在 .pnpm 目录下搜索
    let pnpm_dir = PathBuf::from(&pnpm_root)
        .parent()
        .map(|p| p.join(".pnpm"));

    if let Some(pnpm_store) = pnpm_dir {
        if pnpm_store.is_dir() {
            // 使用同步搜索（因为需要递归遍历 .pnpm 目录）
            let pnpm_store_owned = pnpm_store.clone();
            let found = tokio::task::spawn_blocking(move || {
                find_claude_code_in_pnpm_sync(&pnpm_store_owned)
            })
            .await;

            if let Ok(Some(pkg_path)) = found {
                if let Some(target) = find_patch_target_in_pkg(&pkg_path).await {
                    results.push(Installation {
                        target: target.clone(),
                        description: format!("pnpm 全局安装 ({})", target.display()),
                    });
                }
            }
        }
    }

    results
}

/// 在 pnpm .pnpm 目录中同步搜索 @anthropic-ai/claude-code 包
///
/// pnpm 的 .pnpm 目录使用扁平结构存储所有依赖包，
/// 通过递归查找名为 `claude-code` 的目录来定位目标包。
fn find_claude_code_in_pnpm_sync(pnpm_dir: &Path) -> Option<PathBuf> {
    // 遍历 .pnpm 目录查找 @anthropic-ai/claude-code
    let mut stack = vec![pnpm_dir.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // 检查路径是否以 @anthropic-ai/claude-code 结尾
                let path_str = path.display().to_string();
                if path_str.contains("@anthropic-ai")
                    && path_str.ends_with("claude-code")
                {
                    return Some(path);
                }
                stack.push(path);
            }
        }
    }

    None
}

/// 查找 VS Code / Cursor 扩展中的 Claude Code 捆绑二进制
///
/// 搜索以下扩展目录：
/// - `~/.vscode/extensions/` — VS Code
/// - `~/.vscode-insiders/extensions/` — VS Code Insiders
/// - `~/.cursor/extensions/` — Cursor
///
/// 在扩展目录中查找 `anthropic.claude-code-*` 子目录，
/// 然后搜索大于 10MB 的二进制文件（Claude Code 的捆绑二进制）。
async fn find_vscode_installations() -> Vec<Installation> {
    let mut results = Vec::new();

    let home = match home_dir() {
        Some(h) => h,
        None => return results,
    };

    // 搜索基础目录列表：(标签, 扩展目录路径)
    let search_bases: Vec<(&str, PathBuf)> = vec![
        ("VS Code", home.join(".vscode").join("extensions")),
        (
            "VS Code Insiders",
            home.join(".vscode-insiders").join("extensions"),
        ),
        (
            "Cursor",
            home.join(".cursor").join("extensions"),
        ),
    ];

    for (label, base) in &search_bases {
        if !base.is_dir() {
            continue;
        }

        // 查找 anthropic.claude-code-* 扩展目录（取最新版本）
        let ext_dirs = match std::fs::read_dir(base) {
            Ok(entries) => {
                let mut dirs: Vec<PathBuf> = entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| {
                        p.is_dir()
                            && p.file_name()
                                .is_some_and(|n| {
                                    n.to_string_lossy()
                                        .starts_with("anthropic.claude-code-")
                                })
                    })
                    .collect();
                // 按名称倒序排列，取最新版本
                dirs.sort_unstable_by(|a, b| b.cmp(a));
                dirs
            }
            Err(_) => continue,
        };

        // 使用最新版本的扩展目录
        let ext_dir = match ext_dirs.first() {
            Some(d) => d,
            None => continue,
        };

        // 搜索捆绑的 Claude 二进制文件（大于 10MB）
        let binary_names: Vec<&str> = if cfg!(target_os = "windows") {
            vec!["claude.exe", "claude"]
        } else {
            vec!["claude"]
        };

        // 使用同步搜索查找大文件
        let ext_dir_owned = ext_dir.clone();
        let names = binary_names.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let found = tokio::task::spawn_blocking(move || {
            find_large_binary_sync(&ext_dir_owned, &names, 10 * 1024 * 1024)
        })
        .await;

        if let Ok(Some(binary_path)) = found {
            let ext_name = ext_dir
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            results.push(Installation {
                target: binary_path,
                description: format!("{} 捆绑二进制 ({})", label, ext_name),
            });
        }
    }

    results
}

/// 在目录中递归搜索指定名称且大于指定大小的二进制文件
///
/// # 参数
/// - `dir` — 搜索目录
/// - `names` — 目标文件名列表
/// - `min_size` — 最小文件大小（字节）
fn find_large_binary_sync(
    dir: &Path,
    names: &[String],
    min_size: u64,
) -> Option<PathBuf> {
    let mut stack = vec![dir.to_path_buf()];

    while let Some(current) = stack.pop() {
        let entries = match std::fs::read_dir(&current) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_dir() {
                stack.push(path);
            } else if path.is_file() {
                // 检查文件名是否匹配且不是备份文件
                let file_name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                if !names.contains(&file_name) || file_name.ends_with(".bak") {
                    continue;
                }

                // 检查文件大小
                if let Ok(metadata) = std::fs::metadata(&path) {
                    if metadata.len() > min_size {
                        return Some(path);
                    }
                }
            }
        }
    }

    None
}

// ============ 工具函数 ============

/// 异步执行外部命令并返回标准输出
///
/// 用于执行 `npm root -g` 或 `pnpm root -g` 等命令获取安装路径。
/// 命令执行超时或失败时返回 None。
///
/// # 参数
/// - `program` — 要执行的程序名
/// - `args` — 命令行参数列表
///
/// # 返回值
/// 命令成功时返回 stdout 输出（已 trim），失败或超时时返回 None
async fn run_cmd_async(program: &str, args: &[&str]) -> Option<String> {
    // 先检查命令是否存在于 PATH 中
    if which_sync(program).is_none() {
        return None;
    }

    // 使用 tokio 的 Command 异步执行
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::process::Command::new(program)
            .args(args)
            .output(),
    )
    .await;

    match output {
        Ok(Ok(out)) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if stdout.is_empty() {
                None
            } else {
                Some(stdout)
            }
        }
        _ => None,
    }
}

/// 同步检查程序是否存在于 PATH 中
///
/// 模拟 Python 的 `shutil.which()` 功能，
/// 遍历 PATH 环境变量中的所有目录查找可执行文件。
///
/// # 参数
/// - `program` — 程序名（如 "npm"、"pnpm"）
fn which_sync(program: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;

    // Windows 上需要检查带扩展名的版本
    let extensions: Vec<String> = if cfg!(target_os = "windows") {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
            .split(';')
            .map(|s| s.to_lowercase())
            .collect()
    } else {
        vec![String::new()]
    };

    for dir in std::env::split_paths(&path_var) {
        for ext in &extensions {
            let candidate = dir.join(format!("{}{}", program, ext));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}
