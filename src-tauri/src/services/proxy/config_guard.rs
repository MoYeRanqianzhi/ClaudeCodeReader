//! # 配置守卫
//!
//! 管理代理启动/停止时对 `~/.claude/settings.json` 中
//! `ANTHROPIC_BASE_URL` 环境变量的自动替换和恢复。
//!
//! ## 安全机制
//! - 启动前：通过 file_guard 备份 settings.json + 写入 proxy-state.json
//! - 关闭时：从 proxy-state.json 恢复原始 URL
//! - 崩溃恢复：CCR 启动时检测 active 标记，自动修复
//!
//! ## 默认上游 URL
//! 如果 settings.json 中未设置 `ANTHROPIC_BASE_URL`，
//! 使用 Anthropic 官方 API 地址 `https://api.anthropic.com`。

use std::path::Path;

use crate::models::proxy::ProxyStateFile;
use crate::utils::path;

/// Anthropic 官方 API 默认地址
const DEFAULT_UPSTREAM_URL: &str = "https://api.anthropic.com";

/// 代理状态文件名
const PROXY_STATE_FILENAME: &str = "proxy-state.json";

/// 从 settings.json 读取当前的 ANTHROPIC_BASE_URL
///
/// 如果 env 字段或 ANTHROPIC_BASE_URL 不存在，返回 None。
///
/// # 参数
/// - `claude_path` - Claude 数据目录路径（~/.claude/）
async fn read_current_url(claude_path: &Path) -> Result<Option<String>, String> {
    let settings_path = claude_path.join("settings.json");

    if !settings_path.exists() {
        return Ok(None);
    }

    let content = tokio::fs::read_to_string(&settings_path)
        .await
        .map_err(|e| format!("读取 settings.json 失败: {}", e))?;

    let settings: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 settings.json 失败: {}", e))?;

    Ok(settings
        .get("env")
        .and_then(|env| env.get("ANTHROPIC_BASE_URL"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string()))
}

/// 修改 settings.json 中的 ANTHROPIC_BASE_URL
///
/// 如果 env 字段不存在会自动创建。
/// 如果 `new_url` 为 None，则移除该环境变量。
///
/// # 参数
/// - `claude_path` - Claude 数据目录路径
/// - `new_url` - 新的 URL 值，None 表示移除
async fn write_url(claude_path: &Path, new_url: Option<&str>) -> Result<(), String> {
    let settings_path = claude_path.join("settings.json");

    // 读取现有设置（文件不存在则使用空对象）
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = tokio::fs::read_to_string(&settings_path)
            .await
            .map_err(|e| format!("读取 settings.json 失败: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("解析 settings.json 失败: {}", e))?
    } else {
        serde_json::json!({})
    };

    // 确保 settings 是 Object
    let obj = settings
        .as_object_mut()
        .ok_or_else(|| "settings.json 顶层不是 JSON Object".to_string())?;

    match new_url {
        Some(url) => {
            // 确保 env 字段存在且为 Object
            if !obj.contains_key("env") {
                obj.insert("env".to_string(), serde_json::json!({}));
            }
            if let Some(env) = obj.get_mut("env").and_then(|v| v.as_object_mut()) {
                env.insert(
                    "ANTHROPIC_BASE_URL".to_string(),
                    serde_json::Value::String(url.to_string()),
                );
            }
        }
        None => {
            // 移除 ANTHROPIC_BASE_URL
            if let Some(env) = obj.get_mut("env").and_then(|v| v.as_object_mut()) {
                env.remove("ANTHROPIC_BASE_URL");
            }
        }
    }

    // 写回文件
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("序列化 settings.json 失败: {}", e))?;

    tokio::fs::write(&settings_path, content)
        .await
        .map_err(|e| format!("写入 settings.json 失败: {}", e))
}

/// 获取 proxy-state.json 的完整路径
fn get_state_file_path() -> Result<std::path::PathBuf, String> {
    let ccr_path = path::get_ccr_config_path()?;
    Ok(ccr_path.join(PROXY_STATE_FILENAME))
}

/// 读取代理状态文件
///
/// 如果文件不存在，返回 None。
pub async fn read_proxy_state() -> Result<Option<ProxyStateFile>, String> {
    let state_path = get_state_file_path()?;

    if !state_path.exists() {
        return Ok(None);
    }

    let content = tokio::fs::read_to_string(&state_path)
        .await
        .map_err(|e| format!("读取 proxy-state.json 失败: {}", e))?;

    let state: ProxyStateFile =
        serde_json::from_str(&content).map_err(|e| format!("解析 proxy-state.json 失败: {}", e))?;

    Ok(Some(state))
}

/// 写入代理状态文件
async fn write_proxy_state(state: &ProxyStateFile) -> Result<(), String> {
    let state_path = get_state_file_path()?;

    // 确保 CCR 配置目录存在
    if let Some(parent) = state_path.parent() {
        if !parent.exists() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("创建 CCR 配置目录失败: {}", e))?;
        }
    }

    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("序列化 proxy-state.json 失败: {}", e))?;

    tokio::fs::write(&state_path, content)
        .await
        .map_err(|e| format!("写入 proxy-state.json 失败: {}", e))
}

/// 激活代理：备份原始 URL 并替换为代理地址
///
/// 1. 读取当前 ANTHROPIC_BASE_URL（不存在则记录为 None）
/// 2. 写入 proxy-state.json（active=true）
/// 3. 将 ANTHROPIC_BASE_URL 替换为 `http://127.0.0.1:{port}`
///
/// # 参数
/// - `port` - 代理监听端口
///
/// # 返回值
/// 返回原始上游 URL（未设置时返回默认官方地址）
pub async fn activate(port: u16) -> Result<String, String> {
    let claude_path = path::get_claude_data_path()?;

    // 读取当前 URL
    let current_url = read_current_url(&claude_path).await?;
    let upstream_url = current_url
        .clone()
        .unwrap_or_else(|| DEFAULT_UPSTREAM_URL.to_string());

    // 写入状态文件
    let state = ProxyStateFile {
        active: true,
        original_url: current_url,
        started_at: chrono_now_iso(),
        port,
    };
    write_proxy_state(&state).await?;

    // 替换 URL 为代理地址
    let proxy_url = format!("http://127.0.0.1:{}", port);
    write_url(&claude_path, Some(&proxy_url)).await?;

    Ok(upstream_url)
}

/// 停用代理：恢复原始 URL
///
/// 1. 从 proxy-state.json 读取原始 URL
/// 2. 恢复 settings.json 中的 ANTHROPIC_BASE_URL
/// 3. 将 proxy-state.json 的 active 标记设为 false
pub async fn deactivate() -> Result<(), String> {
    let state = read_proxy_state().await?;

    if let Some(state) = state {
        if state.active {
            let claude_path = path::get_claude_data_path()?;

            // 恢复原始 URL
            match &state.original_url {
                Some(url) => write_url(&claude_path, Some(url)).await?,
                None => write_url(&claude_path, None).await?,
            }

            // 标记为非激活
            let updated = ProxyStateFile {
                active: false,
                ..state
            };
            write_proxy_state(&updated).await?;
        }
    }

    Ok(())
}

/// 崩溃恢复检查
///
/// CCR 启动时调用。如果检测到 proxy-state.json 中 active=true，
/// 说明上次异常退出未能恢复 settings.json，自动执行恢复。
///
/// # 返回值
/// 返回 true 表示执行了恢复操作，false 表示无需恢复
pub async fn check_and_recover() -> Result<bool, String> {
    let state = read_proxy_state().await?;

    match state {
        Some(state) if state.active => {
            log::warn!(
                "检测到代理异常退出（启动于 {}），正在恢复 settings.json ...",
                state.started_at
            );
            deactivate().await?;
            log::info!("settings.json 恢复完成");
            Ok(true)
        }
        _ => Ok(false),
    }
}

/// 获取当前时间的 ISO 8601 格式字符串（无需额外依赖 chrono）
fn chrono_now_iso() -> String {
    // 使用 std 获取 Unix 时间戳，格式化为简单的 ISO 格式
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    // 简单格式：Unix 秒数（精确时间记录）
    format!("{}", now.as_secs())
}

/// 获取默认上游 URL
///
/// 公开常量供其他模块在需要时引用默认的 Anthropic API URL。
#[allow(dead_code)]
pub fn default_upstream_url() -> &'static str {
    DEFAULT_UPSTREAM_URL
}
