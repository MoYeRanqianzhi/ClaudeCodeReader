//! # 设置和配置 Tauri Commands
//!
//! 提供设置文件和环境配置的读写 Tauri command 处理函数：
//! - `get_claude_data_path` - 获取 `~/.claude/` 路径
//! - `read_settings` / `save_settings` - 读写 Claude Code 的 settings.json
//! - `read_env_config` / `save_env_config` - 读写 CCR 环境切换器配置
//! - `read_history` - 读取命令历史记录
//! - `check_file_exists` - 检查文件是否存在
//!
//! 注意：文件管理器定位功能（原 `open_in_explorer`）已迁移到 `tauri-plugin-opener`，
//! 使用 OS 原生 API 替代手动拼接 shell 命令。

use std::path::Path;

use tauri::State;

use crate::models::message::HistoryEntry;
use crate::models::settings::{ClaudeSettings, EnvSwitcherConfig};
use crate::services::cache::AppCache;
use crate::services::file_guard;
use crate::utils::path;

/// 获取 Claude Code 数据目录的绝对路径
///
/// 前端在应用启动时调用此 command 获取 `~/.claude/` 的绝对路径，
/// 作为后续所有数据操作的基础路径。
///
/// # 返回值
/// 返回 `~/.claude/` 目录的绝对路径字符串
///
/// # 错误
/// 如果无法确定用户主目录，返回错误信息
#[tauri::command]
pub async fn get_claude_data_path() -> Result<String, String> {
    let path = path::get_claude_data_path()?;
    Ok(path.to_string_lossy().to_string())
}

/// 读取 Claude Code 设置文件
///
/// 从 `~/.claude/settings.json` 加载用户设置。
/// 如果文件不存在（如首次安装 Claude Code），返回空的 JSON 对象 `{}`。
///
/// # 参数
/// - `claude_path` - Claude 数据目录路径（`~/.claude/`）
///
/// # 返回值
/// 返回解析后的设置 JSON 对象
///
/// # 错误
/// 文件存在但无法读取或 JSON 解析失败时返回错误
#[tauri::command]
pub async fn read_settings(claude_path: String) -> Result<ClaudeSettings, String> {
    let settings_path = Path::new(&claude_path).join("settings.json");

    // 文件不存在时返回空的 JSON 对象，与前端行为保持一致
    if !settings_path.exists() {
        return Ok(serde_json::json!({}));
    }

    let content = tokio::fs::read_to_string(&settings_path)
        .await
        .map_err(|e| format!("读取设置文件失败: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("解析设置文件失败: {}", e))
}

/// 保存 Claude Code 设置文件
///
/// 将设置对象序列化为 JSON（带 2 空格缩进）并通过 `file_guard` 安全写入
/// `~/.claude/settings.json`。写入前自动进行路径验证和双重备份。
///
/// # 参数
/// - `claude_path` - Claude 数据目录路径（`~/.claude/`）
/// - `settings` - 要保存的完整设置对象
/// - `cache` - Tauri managed state，用于 file_guard 注册临时备份
///
/// # 错误
/// 序列化失败、路径验证失败、备份失败或文件写入失败时返回错误
#[tauri::command]
pub async fn save_settings(
    claude_path: String,
    settings: ClaudeSettings,
    cache: State<'_, AppCache>,
) -> Result<(), String> {
    let settings_path = Path::new(&claude_path).join("settings.json");

    // 使用 2 空格缩进格式化 JSON，与前端 JSON.stringify(settings, null, 2) 保持一致
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("序列化设置失败: {}", e))?;

    // 通过 file_guard 安全写入（含路径验证 + 双重备份）
    file_guard::safe_write_file(
        &settings_path.to_string_lossy(),
        content.as_bytes(),
        "save_settings",
        &cache,
    )
    .await
}

/// 读取环境切换器配置
///
/// 从 `~/.mo/CCR/env-profiles.json` 加载所有环境配置组及激活状态。
/// 如果配置文件不存在（首次使用），返回空的默认配置。
///
/// # 参数
/// - `_claude_path` - Claude 数据路径（保留参数，保持前端 API 一致性）
///
/// # 返回值
/// 返回包含所有配置组和激活 ID 的 EnvSwitcherConfig 对象
///
/// # 错误
/// 文件存在但无法读取或 JSON 解析失败时返回错误
#[tauri::command]
pub async fn read_env_config(_claude_path: String) -> Result<EnvSwitcherConfig, String> {
    let ccr_path = path::get_ccr_config_path()?;
    let config_path = ccr_path.join("env-profiles.json");

    // 配置文件不存在时返回空的默认配置，与前端行为保持一致
    if !config_path.exists() {
        return Ok(EnvSwitcherConfig {
            profiles: vec![],
            active_profile_id: None,
        });
    }

    let content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("读取环境配置文件失败: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("解析环境配置文件失败: {}", e))
}

/// 保存环境切换器配置到文件
///
/// 将完整的配置对象序列化为 JSON（带缩进格式化）并写入配置文件。
/// 如果 CCR 配置目录不存在，会自动递归创建。
///
/// # 参数
/// - `_claude_path` - Claude 数据路径（保留参数，保持前端 API 一致性）
/// - `config` - 要保存的完整环境切换器配置对象
///
/// # 错误
/// 目录创建失败或文件写入失败时返回错误
#[tauri::command]
pub async fn save_env_config(
    _claude_path: String,
    config: EnvSwitcherConfig,
) -> Result<(), String> {
    let ccr_path = path::get_ccr_config_path()?;

    // 确保 CCR 配置目录存在，递归创建所有缺失的父目录
    if !ccr_path.exists() {
        tokio::fs::create_dir_all(&ccr_path)
            .await
            .map_err(|e| format!("创建 CCR 配置目录失败: {}", e))?;
    }

    let config_path = ccr_path.join("env-profiles.json");
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化环境配置失败: {}", e))?;

    tokio::fs::write(&config_path, content)
        .await
        .map_err(|e| format!("写入环境配置文件失败: {}", e))
}

/// 读取 Claude Code 命令历史记录
///
/// 从 `~/.claude/history.jsonl` 加载所有历史记录条目。
/// 文件采用 JSONL 格式，每行是一个独立的 JSON 对象。
///
/// # 参数
/// - `claude_path` - Claude 数据目录路径（`~/.claude/`）
///
/// # 返回值
/// 返回按原始顺序排列的 HistoryEntry 数组；文件不存在时返回空数组
///
/// # 错误
/// 文件存在但无法读取时返回错误
#[tauri::command]
pub async fn read_history(claude_path: String) -> Result<Vec<HistoryEntry>, String> {
    let history_path = Path::new(&claude_path).join("history.jsonl");

    // 文件不存在时返回空数组，与前端行为保持一致
    if !history_path.exists() {
        return Ok(vec![]);
    }

    let content = tokio::fs::read_to_string(&history_path)
        .await
        .map_err(|e| format!("读取历史记录文件失败: {}", e))?;

    // 按换行符分割，过滤空行，逐行解析 JSON
    let entries: Vec<HistoryEntry> = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            // 与前端一致：解析失败的行静默跳过
            serde_json::from_str(line).ok()
        })
        .collect();

    Ok(entries)
}

/// 检查指定路径的文件是否存在
///
/// 前端在渲染工具结果的"打开文件位置"按钮时调用，
/// 根据返回值决定按钮是否可用（文件不存在时禁用按钮）。
///
/// # 参数
/// - `file_path` - 要检查的文件的绝对路径
///
/// # 返回值
/// 文件存在返回 true，否则返回 false
#[tauri::command]
pub async fn check_file_exists(file_path: String) -> bool {
    std::path::Path::new(&file_path).exists()
}
