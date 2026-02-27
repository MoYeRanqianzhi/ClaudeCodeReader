//! # 实用工具 Tauri Commands
//!
//! 提供实用工具相关的 Tauri command 处理函数：
//! - `read_resume_config` / `save_resume_config` - 一键 Resume 配置读写
//! - `open_resume_terminal` - 打开终端执行 claude --resume 命令
//! - `read_backup_config` / `save_backup_config` - 备份配置读写
//! - `get_temp_backups` - 获取本次运行期间的临时备份列表
//! - `list_fixers` - 获取所有可用的一键修复项列表
//! - `execute_fixer` - 执行指定的一键修复
//!
//! 所有 CCR 配置存储在 `~/.mo/CCR/` 目录下，
//! 与 Claude Code 的 `settings.json` 完全隔离。

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::services::cache::AppCache;
use crate::services::file_guard::{self, BackupConfig, TempBackupEntry};
use crate::services::fixers::{self, FixDefinition, FixResult};
use crate::utils::path;

/// 一键 Resume 功能的配置数据结构
///
/// 存储用户在设置面板中配置的 Claude CLI resume 参数。
/// 配置文件路径：`~/.mo/CCR/resume-config.json`
///
/// 对应前端 TypeScript 接口：
/// ```typescript
/// interface ResumeConfig {
///   flags: string[];
///   customArgs: string;
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeConfig {
    /// 勾选的 CLI flag 列表
    ///
    /// 用户在设置面板中勾选的常用 flag，如：
    /// - `--dangerously-skip-permissions`
    /// - `--verbose`
    /// - `--debug`
    /// - `--no-chrome`
    pub flags: Vec<String>,

    /// 用户自定义的额外参数字符串
    ///
    /// 追加在 `claude --resume <session_id> <flags>` 命令末尾，
    /// 允许用户指定任意 CLI 参数（如 `--model opus`）。
    pub custom_args: String,
}

/// ResumeConfig 默认值：空 flag 列表 + 空自定义参数
impl Default for ResumeConfig {
    fn default() -> Self {
        Self {
            flags: vec![],
            custom_args: String::new(),
        }
    }
}

/// 读取一键 Resume 配置
///
/// 从 `~/.mo/CCR/resume-config.json` 加载用户配置的 Resume 参数。
/// 如果配置文件不存在（首次使用），返回默认空配置。
///
/// # 返回值
/// 返回 ResumeConfig 对象，包含 flags 列表和自定义参数字符串
///
/// # 错误
/// 文件存在但无法读取或 JSON 解析失败时返回错误
#[tauri::command]
pub async fn read_resume_config() -> Result<ResumeConfig, String> {
    let ccr_path = path::get_ccr_config_path()?;
    let config_path = ccr_path.join("resume-config.json");

    // 配置文件不存在时返回默认空配置
    if !config_path.exists() {
        return Ok(ResumeConfig::default());
    }

    let content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("读取 Resume 配置文件失败: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("解析 Resume 配置文件失败: {}", e))
}

/// 保存一键 Resume 配置
///
/// 将 ResumeConfig 序列化为 JSON（带缩进格式化）并写入配置文件。
/// 如果 CCR 配置目录不存在，会自动递归创建。
///
/// # 参数
/// - `config` - 要保存的 ResumeConfig 对象
///
/// # 错误
/// 目录创建失败或文件写入失败时返回错误
#[tauri::command]
pub async fn save_resume_config(config: ResumeConfig) -> Result<(), String> {
    let ccr_path = path::get_ccr_config_path()?;

    // 确保 CCR 配置目录存在
    if !ccr_path.exists() {
        tokio::fs::create_dir_all(&ccr_path)
            .await
            .map_err(|e| format!("创建 CCR 配置目录失败: {}", e))?;
    }

    let config_path = ccr_path.join("resume-config.json");
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化 Resume 配置失败: {}", e))?;

    tokio::fs::write(&config_path, content)
        .await
        .map_err(|e| format!("写入 Resume 配置文件失败: {}", e))
}

/// 打开系统终端并执行 claude --resume 命令
///
/// 根据当前操作系统平台，打开对应的终端模拟器，
/// 自动 cd 到项目目录并执行 `claude --resume <session_id> <flags> <custom_args>`。
///
/// 使用 `std::process::Command::spawn()` 非阻塞启动子进程，
/// 不等待终端关闭即返回。
///
/// # 参数
/// - `project_path` - 项目的真实文件系统路径（已解码）
/// - `session_id` - 会话 UUID
///
/// # 平台行为
/// - **Windows**: `cmd /c start cmd /k "cd /d <path> && <command>"`
/// - **macOS**: 通过 AppleScript 调用 Terminal.app
/// - **Linux**: 依次尝试 x-terminal-emulator / gnome-terminal / konsole / xterm
///
/// # 错误
/// 终端启动失败时返回错误
#[tauri::command]
pub async fn open_resume_terminal(
    project_path: String,
    session_id: String,
) -> Result<(), String> {
    // 1. 读取 Resume 配置
    let config = read_resume_config_internal().await;

    // 2. 拼接 claude 命令
    let mut cmd_parts: Vec<String> = vec![
        "claude".to_string(),
        "--resume".to_string(),
        session_id,
    ];

    // 追加勾选的 flags
    for flag in &config.flags {
        cmd_parts.push(flag.clone());
    }

    // 追加自定义参数（按空格分割，过滤空字符串）
    let custom_trimmed = config.custom_args.trim();
    if !custom_trimmed.is_empty() {
        for part in custom_trimmed.split_whitespace() {
            cmd_parts.push(part.to_string());
        }
    }

    let full_command = cmd_parts.join(" ");

    // 3. 按平台打开终端
    open_terminal_with_command(&project_path, &full_command)
}

/// 内部函数：读取 Resume 配置（不经过 Tauri command 层）
///
/// 供 `open_resume_terminal` 内部调用，避免重复的 command 注册。
/// 读取失败时静默返回默认配置。
async fn read_resume_config_internal() -> ResumeConfig {
    let ccr_path = match path::get_ccr_config_path() {
        Ok(p) => p,
        Err(_) => return ResumeConfig::default(),
    };
    let config_path = ccr_path.join("resume-config.json");

    if !config_path.exists() {
        return ResumeConfig::default();
    }

    match tokio::fs::read_to_string(&config_path).await {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => ResumeConfig::default(),
    }
}

/// 按平台打开终端并执行指定命令
///
/// # 参数
/// - `working_dir` - 终端的工作目录
/// - `command` - 要在终端中执行的完整命令字符串
fn open_terminal_with_command(working_dir: &str, command: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        // CREATE_NEW_CONSOLE: 为子进程分配一个全新的控制台窗口
        const CREATE_NEW_CONSOLE: u32 = 0x00000010;

        // 使用 .current_dir() 设置工作目录（而非 cd /d），
        // 使用 .raw_arg() 传递命令（而非 .args()），
        // 避免 Rust 的 MSVC 风格参数转义与 cmd.exe 的引号解析规则冲突。
        // /k 参数使窗口在命令执行后保持打开（用户可以看到输出并继续交互）
        std::process::Command::new("cmd")
            .raw_arg(format!("/k {}", command))
            .current_dir(working_dir)
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .map_err(|e| format!("启动 Windows 终端失败: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: 通过 osascript 执行 AppleScript 打开 Terminal.app
        // 使用 `do script` 在新窗口中执行命令
        let script = format!(
            "tell application \"Terminal\"\n\
                activate\n\
                do script \"cd '{}' && {}\"\n\
            end tell",
            working_dir.replace('\'', "'\\''"),
            command.replace('\\', "\\\\").replace('"', "\\\""),
        );

        std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("启动 macOS 终端失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: 依次尝试常见的终端模拟器
        // 使用 sh -c 包裹命令，确保 cd 和后续命令在同一 shell 中执行
        let shell_cmd = format!("cd '{}' && {} ; exec $SHELL", working_dir, command);

        let terminals = [
            ("x-terminal-emulator", vec!["-e", "sh", "-c"]),
            ("gnome-terminal", vec!["--", "sh", "-c"]),
            ("konsole", vec!["-e", "sh", "-c"]),
            ("xfce4-terminal", vec!["-e", "sh -c"]),
            ("xterm", vec!["-e", "sh", "-c"]),
        ];

        let mut launched = false;
        for (terminal, args) in &terminals {
            let mut cmd = std::process::Command::new(terminal);
            for arg in args {
                cmd.arg(arg);
            }
            cmd.arg(&shell_cmd);

            if cmd.spawn().is_ok() {
                launched = true;
                break;
            }
        }

        if !launched {
            return Err("未找到可用的终端模拟器（已尝试 x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, xterm）".to_string());
        }
    }

    Ok(())
}

// ============ 备份配置 Commands ============

/// 读取备份配置
///
/// 从 `~/.mo/CCR/backup-config.json` 加载备份设置。
/// 配置文件不存在时返回默认配置（主动备份关闭）。
///
/// # 返回值
/// 返回 BackupConfig 对象
#[tauri::command]
pub async fn read_backup_config() -> Result<BackupConfig, String> {
    Ok(file_guard::read_backup_config_internal().await)
}

/// 保存备份配置
///
/// 将 BackupConfig 序列化为 JSON 并写入 `~/.mo/CCR/backup-config.json`。
///
/// # 参数
/// - `config` - 要保存的 BackupConfig 对象
#[tauri::command]
pub async fn save_backup_config(config: BackupConfig) -> Result<(), String> {
    let ccr_path = path::get_ccr_config_path()?;

    // 确保 CCR 配置目录存在
    if !ccr_path.exists() {
        tokio::fs::create_dir_all(&ccr_path)
            .await
            .map_err(|e| format!("创建 CCR 配置目录失败: {}", e))?;
    }

    let config_path = ccr_path.join("backup-config.json");
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化备份配置失败: {}", e))?;

    tokio::fs::write(&config_path, content)
        .await
        .map_err(|e| format!("写入备份配置文件失败: {}", e))
}

/// 获取本次运行期间的所有临时备份记录
///
/// 返回 AppCache 中注册的临时备份列表，供前端展示。
/// 应用关闭后注册表清空，但 TEMP 目录下的备份文件仍由 OS 管理。
///
/// # 返回值
/// 返回 TempBackupEntry 数组，按创建时间顺序排列
#[tauri::command]
pub async fn get_temp_backups(cache: State<'_, AppCache>) -> Result<Vec<TempBackupEntry>, String> {
    Ok(cache.get_all_temp_backups())
}

// ============ 一键修复 Commands ============

/// 获取所有可用的一键修复项列表
///
/// 从修复注册表中收集所有修复项的元数据定义，供前端弹窗展示。
/// 返回的列表按注册顺序排列。
///
/// # 返回值
/// 返回 FixDefinition 数组，包含每个修复项的 id、名称、描述、修复方式和搜索标签
#[tauri::command]
pub async fn list_fixers() -> Result<Vec<FixDefinition>, String> {
    Ok(fixers::list_definitions())
}

/// 执行指定的一键修复
///
/// 根据 fixer_id 在注册表中查找对应的修复项并执行。
/// 修复逻辑通过 `file_guard` 安全写入文件，自动进行双重备份。
///
/// # 参数
/// - `fixer_id` - 修复项的唯一标识符（如 "strip_thinking"）
/// - `session_file_path` - 要修复的会话 JSONL 文件的绝对路径
/// - `cache` - Tauri managed state，传递给 file_guard 进行备份注册
///
/// # 返回值
/// 返回 FixResult，包含修复是否成功、结果消息和受影响行数
///
/// # 错误
/// 未找到指定 ID 的修复项或修复执行失败时返回错误
#[tauri::command]
pub async fn execute_fixer(
    fixer_id: String,
    session_file_path: String,
    cache: State<'_, AppCache>,
) -> Result<FixResult, String> {
    fixers::execute_by_id(&fixer_id, &session_file_path, &cache).await
}
