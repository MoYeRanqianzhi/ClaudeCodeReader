//! # 代理相关 Tauri Commands
//!
//! 提供中转抓包代理的 Tauri command 处理函数：
//! - `start_proxy` / `stop_proxy` / `get_proxy_status` - 代理生命周期管理
//! - `set_proxy_mode` - 切换工作模式
//! - `resolve_intercept` - 处理拦截决策
//! - `get_proxy_records` / `get_record_detail` - 查询记录
//! - `clear_proxy_records` / `export_proxy_records` - 清空和导出
//! - `check_proxy_recovery` - 启动时崩溃恢复检查

use std::sync::Mutex;

use tauri::{AppHandle, State};

use crate::models::proxy::{
    InterceptAction, ProxyMode, ProxyRecord, ProxyRecordDetail, ProxyStatus,
};
use crate::services::proxy::{config_guard, server::ProxyServer};

/// 代理服务器全局状态
///
/// 使用 Tauri managed state 管理代理服务器实例。
/// Mutex 包装以支持跨线程安全访问。
pub struct ProxyState {
    /// 当前运行的代理服务器实例（None 表示未运行）
    pub server: Mutex<Option<ProxyServer>>,
    /// 代理监听端口
    pub port: Mutex<Option<u16>>,
    /// 上游 URL
    pub upstream_url: Mutex<Option<String>>,
}

impl ProxyState {
    /// 创建新的代理状态
    pub fn new() -> Self {
        Self {
            server: Mutex::new(None),
            port: Mutex::new(None),
            upstream_url: Mutex::new(None),
        }
    }
}

/// 启动代理服务器
///
/// 1. 检查是否已在运行
/// 2. 通过 config_guard 备份并替换 ANTHROPIC_BASE_URL
/// 3. 启动 hyper HTTP 服务器
///
/// # 参数
/// - `port` - 指定端口号，None 时自动检测
///
/// # 返回值
/// 返回代理运行状态
#[tauri::command]
pub async fn start_proxy(
    port: Option<u16>,
    proxy_state: State<'_, ProxyState>,
    app_handle: AppHandle,
) -> Result<ProxyStatus, String> {
    // 检查是否已在运行
    {
        let server = proxy_state.server.lock().unwrap();
        if server.is_some() {
            return Err("代理已在运行中".to_string());
        }
    }

    // 通过 config_guard 备份并替换 URL
    let upstream_url = config_guard::activate(port.unwrap_or(8080)).await?;

    // 创建并启动代理服务器
    let server = ProxyServer::new(upstream_url.clone(), Some(app_handle));
    let actual_port = server.start(port).await?;

    // 更新 config_guard 中的实际端口（如果自动分配了不同端口）
    if port.is_none() || port != Some(actual_port) {
        // 重新激活以使用正确的端口
        config_guard::deactivate().await?;
        let upstream_url_new = config_guard::activate(actual_port).await?;
        // upstream_url 不变
        assert_eq!(upstream_url, upstream_url_new);
    }

    // 保存状态
    let mode = server.get_mode();
    {
        let mut server_lock = proxy_state.server.lock().unwrap();
        *server_lock = Some(server);
    }
    {
        let mut port_lock = proxy_state.port.lock().unwrap();
        *port_lock = Some(actual_port);
    }
    {
        let mut url_lock = proxy_state.upstream_url.lock().unwrap();
        *url_lock = Some(upstream_url.clone());
    }

    Ok(ProxyStatus {
        running: true,
        port: Some(actual_port),
        mode,
        upstream_url: Some(upstream_url),
        pending_intercepts: 0,
    })
}

/// 停止代理服务器
///
/// 1. 关闭 hyper 服务器
/// 2. 通过 config_guard 恢复 ANTHROPIC_BASE_URL
#[tauri::command]
pub async fn stop_proxy(proxy_state: State<'_, ProxyState>) -> Result<(), String> {
    let server = {
        let mut server_lock = proxy_state.server.lock().unwrap();
        server_lock.take()
    };

    if let Some(server) = server {
        server.shutdown();
    }

    // 恢复 settings.json
    config_guard::deactivate().await?;

    // 清理状态
    {
        let mut port_lock = proxy_state.port.lock().unwrap();
        *port_lock = None;
    }
    {
        let mut url_lock = proxy_state.upstream_url.lock().unwrap();
        *url_lock = None;
    }

    Ok(())
}

/// 获取代理当前状态
#[tauri::command]
pub async fn get_proxy_status(proxy_state: State<'_, ProxyState>) -> Result<ProxyStatus, String> {
    let server = proxy_state.server.lock().unwrap();

    match server.as_ref() {
        Some(s) => {
            let port = proxy_state.port.lock().unwrap();
            let url = proxy_state.upstream_url.lock().unwrap();
            Ok(ProxyStatus {
                running: true,
                port: *port,
                mode: s.get_mode(),
                upstream_url: url.clone(),
                pending_intercepts: s.state.interceptor.pending_count(),
            })
        }
        None => Ok(ProxyStatus {
            running: false,
            port: None,
            mode: ProxyMode::Overview,
            upstream_url: None,
            pending_intercepts: 0,
        }),
    }
}

/// 切换代理工作模式
#[tauri::command]
pub async fn set_proxy_mode(
    mode: ProxyMode,
    proxy_state: State<'_, ProxyState>,
) -> Result<(), String> {
    let server = proxy_state.server.lock().unwrap();
    match server.as_ref() {
        Some(s) => {
            s.set_mode(mode);
            Ok(())
        }
        None => Err("代理未运行".to_string()),
    }
}

/// 处理拦截决策
///
/// 前端用户在拦截模式下对暂停的请求做出决策。
#[tauri::command]
pub async fn resolve_intercept(
    id: u64,
    action: InterceptAction,
    proxy_state: State<'_, ProxyState>,
) -> Result<(), String> {
    let server = proxy_state.server.lock().unwrap();
    match server.as_ref() {
        Some(s) => {
            if s.state.interceptor.resolve(id, action) {
                Ok(())
            } else {
                Err(format!("拦截请求 {} 不存在或已超时", id))
            }
        }
        None => Err("代理未运行".to_string()),
    }
}

/// 分页获取请求记录
#[tauri::command]
pub async fn get_proxy_records(
    offset: usize,
    limit: usize,
    proxy_state: State<'_, ProxyState>,
) -> Result<Vec<ProxyRecord>, String> {
    let server = proxy_state.server.lock().unwrap();
    match server.as_ref() {
        Some(s) => Ok(s.state.recorder.get_records(offset, limit)),
        None => Ok(vec![]),
    }
}

/// 获取单条记录详情
#[tauri::command]
pub async fn get_record_detail(
    id: u64,
    proxy_state: State<'_, ProxyState>,
) -> Result<ProxyRecordDetail, String> {
    let server = proxy_state.server.lock().unwrap();
    match server.as_ref() {
        Some(s) => s
            .state
            .recorder
            .get_detail(id)
            .ok_or_else(|| format!("记录 {} 不存在", id)),
        None => Err("代理未运行".to_string()),
    }
}

/// 清空所有请求记录
#[tauri::command]
pub async fn clear_proxy_records(proxy_state: State<'_, ProxyState>) -> Result<(), String> {
    let server = proxy_state.server.lock().unwrap();
    if let Some(s) = server.as_ref() {
        s.state.recorder.clear();
    }
    Ok(())
}

/// 导出所有记录为 JSON 格式
#[tauri::command]
pub async fn export_proxy_records(
    proxy_state: State<'_, ProxyState>,
) -> Result<String, String> {
    let server = proxy_state.server.lock().unwrap();
    match server.as_ref() {
        Some(s) => s.state.recorder.export_json(),
        None => Ok("[]".to_string()),
    }
}

/// 启动时崩溃恢复检查
///
/// CCR 启动时调用，检测是否有上次异常退出未恢复的代理状态。
#[tauri::command]
pub async fn check_proxy_recovery() -> Result<bool, String> {
    config_guard::check_and_recover().await
}
