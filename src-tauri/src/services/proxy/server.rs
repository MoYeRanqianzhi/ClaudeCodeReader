//! # HTTP 代理服务器
//!
//! 使用 hyper 启动本地 HTTP 服务器，接收 Claude Code CLI 的请求，
//! 根据当前工作模式（总览/查看/拦截）进行处理后转发到上游。
//!
//! ## 架构
//! - `ProxyServer` 持有共享状态（模式、记录器、拦截器、上游 URL）
//! - 每个请求由 `handle_request` 异步处理
//! - 通过 Tauri AppHandle 发送事件到前端

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::time::Instant;

use bytes::Bytes;
use http_body_util::BodyExt;
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::models::proxy::{InterceptAction, ProxyMode};
use crate::services::proxy::forwarder;
use crate::services::proxy::interceptor::Interceptor;
use crate::services::proxy::recorder::Recorder;

/// 代理服务器共享状态
///
/// 由所有请求 handler 共享，通过 Arc 克隆传递。
#[derive(Clone)]
pub struct ProxyState {
    /// 当前工作模式
    pub mode: Arc<RwLock<ProxyMode>>,
    /// 上游 API URL（如 https://api.anthropic.com）
    pub upstream_url: Arc<String>,
    /// 请求记录器
    pub recorder: Recorder,
    /// 拦截器
    pub interceptor: Interceptor,
    /// reqwest HTTP 客户端（复用连接池）
    pub client: reqwest::Client,
    /// Tauri AppHandle（用于发送事件到前端）
    pub app_handle: Option<tauri::AppHandle>,
}

/// 代理服务器
pub struct ProxyServer {
    /// 共享状态
    pub state: ProxyState,
    /// 关闭信号发送端
    shutdown_tx: watch::Sender<bool>,
}

impl ProxyServer {
    /// 创建新的代理服务器实例
    pub fn new(upstream_url: String, app_handle: Option<tauri::AppHandle>) -> Self {
        let (shutdown_tx, _) = watch::channel(false);

        Self {
            state: ProxyState {
                mode: Arc::new(RwLock::new(ProxyMode::Overview)),
                upstream_url: Arc::new(upstream_url),
                recorder: Recorder::new(),
                interceptor: Interceptor::new(),
                client: reqwest::Client::new(),
                app_handle,
            },
            shutdown_tx,
        }
    }

    /// 启动代理服务器
    ///
    /// 绑定指定端口（或自动检测可用端口），开始接受连接。
    /// 返回实际绑定的端口号。
    ///
    /// # 参数
    /// - `port` - 指定端口号，None 时自动检测（8080-8099）
    pub async fn start(&self, port: Option<u16>) -> Result<u16, String> {
        let addr = self.find_available_port(port).await?;
        let actual_port = addr.port();

        let state = self.state.clone();
        let mut shutdown_rx = self.shutdown_tx.subscribe();

        // 在后台 tokio task 中运行服务器
        tokio::spawn(async move {
            let listener = TcpListener::bind(addr)
                .await
                .expect("绑定端口失败");

            log::info!("代理服务器已启动，监听 {}", addr);

            loop {
                tokio::select! {
                    // 接受新连接
                    result = listener.accept() => {
                        match result {
                            Ok((stream, _)) => {
                                let state = state.clone();
                                let io = TokioIo::new(stream);

                                tokio::spawn(async move {
                                    let service = service_fn(move |req| {
                                        let state = state.clone();
                                        async move { handle_request(req, state).await }
                                    });

                                    if let Err(e) = http1::Builder::new()
                                        .serve_connection(io, service)
                                        .await
                                    {
                                        log::warn!("HTTP 连接处理错误: {}", e);
                                    }
                                });
                            }
                            Err(e) => {
                                log::warn!("接受连接失败: {}", e);
                            }
                        }
                    }
                    // 收到关闭信号
                    _ = shutdown_rx.changed() => {
                        log::info!("代理服务器收到关闭信号，停止接受新连接");
                        break;
                    }
                }
            }
        });

        Ok(actual_port)
    }

    /// 关闭代理服务器
    pub fn shutdown(&self) {
        // 发送关闭信号
        let _ = self.shutdown_tx.send(true);
        // 清空所有待处理的拦截（向等待中的 handler 发送 Forward）
        self.state.interceptor.clear_all();
    }

    /// 查找可用端口
    ///
    /// 如果指定了端口号，直接尝试绑定。
    /// 否则在 8080-8099 范围内依次尝试。
    async fn find_available_port(&self, port: Option<u16>) -> Result<SocketAddr, String> {
        if let Some(p) = port {
            let addr: SocketAddr = ([127, 0, 0, 1], p).into();
            // 尝试绑定以验证端口可用
            TcpListener::bind(addr)
                .await
                .map_err(|_| format!("端口 {} 已被占用", p))?;
            // 绑定成功后释放，实际绑定在 start 中进行
            // 注意：存在 TOCTOU 竞态，但对用户场景足够
            return Ok(addr);
        }

        // 自动检测：尝试 8080-8099
        for p in 8080..=8099 {
            let addr: SocketAddr = ([127, 0, 0, 1], p).into();
            if TcpListener::bind(addr).await.is_ok() {
                return Ok(addr);
            }
        }

        Err("端口 8080-8099 全部被占用，请手动指定端口".to_string())
    }

    /// 设置工作模式
    pub fn set_mode(&self, mode: ProxyMode) {
        *self.state.mode.write().unwrap() = mode;
    }

    /// 获取当前工作模式
    pub fn get_mode(&self) -> ProxyMode {
        *self.state.mode.read().unwrap()
    }
}

/// 处理单个 HTTP 请求
///
/// 根据当前工作模式执行不同的处理流程：
/// - 总览模式：转发 + 记录摘要
/// - 查看模式：转发 + 完整记录
/// - 拦截模式：暂停等待决策 + 转发/丢弃/伪造
async fn handle_request(
    req: Request<Incoming>,
    state: ProxyState,
) -> Result<Response<http_body_util::Full<Bytes>>, hyper::Error> {
    let start_time = Instant::now();

    // 提取请求信息
    let method = req.method().to_string();
    let path = req.uri().path_and_query()
        .map(|pq| pq.to_string())
        .unwrap_or_else(|| "/".to_string());

    // 提取 headers
    let headers: HashMap<String, String> = req
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    // 读取 body
    let body_bytes = req
        .into_body()
        .collect()
        .await
        .map(|collected| collected.to_bytes())
        .unwrap_or_default();
    let body_str = String::from_utf8_lossy(&body_bytes).to_string();
    let body_opt = if body_str.is_empty() {
        None
    } else {
        Some(body_str.clone())
    };

    // 获取当前模式
    let mode = *state.mode.read().unwrap();

    // 记录请求（查看模式和拦截模式记录完整内容，总览模式也记录但 body 可以省略）
    let record_body = match mode {
        ProxyMode::Overview => None, // 总览模式不记录 body
        _ => body_opt.clone(),
    };
    let record_id = state
        .recorder
        .record_request(&method, &path, headers.clone(), record_body);

    // 发送请求事件到前端
    emit_event(&state, "proxy:request", &serde_json::json!({
        "id": record_id,
        "method": &method,
        "url": &path,
        "timestamp": now_iso(),
    }));

    // 根据模式处理
    let (final_headers, final_body) = match mode {
        ProxyMode::Intercept => {
            // 拦截模式：等待用户决策
            state.recorder.mark_intercepted(record_id);

            // 发送拦截事件到前端
            emit_event(&state, "proxy:intercept", &serde_json::json!({
                "id": record_id,
                "method": &method,
                "url": &path,
                "headers": &headers,
                "body": &body_opt,
            }));

            // 创建拦截并等待决策
            let receiver = state.interceptor.create_intercept(record_id);
            let action = state.interceptor.wait_for_decision(record_id, receiver).await;

            match action {
                InterceptAction::Forward => (headers.clone(), body_opt.clone()),
                InterceptAction::ForwardModified {
                    headers: mod_headers,
                    body: mod_body,
                } => {
                    let h = mod_headers.unwrap_or_else(|| headers.clone());
                    let b = mod_body.or_else(|| body_opt.clone());
                    (h, b)
                }
                InterceptAction::Drop { status_code } => {
                    state.recorder.mark_dropped(record_id);
                    let resp = forwarder::build_error_response(
                        status_code,
                        "请求被代理拦截并丢弃",
                    );
                    return Ok(resp);
                }
                InterceptAction::MockResponse {
                    status_code,
                    headers: mock_headers,
                    body: mock_body,
                } => {
                    let duration = start_time.elapsed().as_millis() as u64;
                    state.recorder.record_response(
                        record_id,
                        status_code,
                        duration,
                        mock_headers.clone(),
                        Some(mock_body.clone()),
                    );

                    emit_event(&state, "proxy:response", &serde_json::json!({
                        "id": record_id,
                        "status": status_code,
                        "durationMs": duration,
                        "size": mock_body.len(),
                    }));

                    match forwarder::build_response(status_code, &mock_headers, &mock_body) {
                        Ok(resp) => return Ok(resp),
                        Err(_) => {
                            return Ok(forwarder::build_error_response(500, "构建伪造响应失败"));
                        }
                    }
                }
            }
        }
        // 总览/查看模式：直接使用原始请求
        _ => (headers.clone(), body_opt.clone()),
    };

    // 转发请求到上游
    match forwarder::forward_request(
        &state.client,
        &state.upstream_url,
        &method,
        &path,
        &final_headers,
        final_body.as_deref(),
    )
    .await
    {
        Ok(result) => {
            let duration = start_time.elapsed().as_millis() as u64;

            // 记录响应
            let resp_body = match mode {
                ProxyMode::Overview => None, // 总览模式不记录响应 body
                _ => Some(result.body.clone()),
            };
            state.recorder.record_response(
                record_id,
                result.status,
                duration,
                result.headers.clone(),
                resp_body,
            );

            // 发送响应事件
            emit_event(&state, "proxy:response", &serde_json::json!({
                "id": record_id,
                "status": result.status,
                "durationMs": duration,
                "size": result.body.len(),
            }));

            // 构建返回给客户端的响应
            match forwarder::build_response(result.status, &result.headers, &result.body) {
                Ok(resp) => Ok(resp),
                Err(_) => Ok(forwarder::build_error_response(502, "构建转发响应失败")),
            }
        }
        Err(e) => {
            let duration = start_time.elapsed().as_millis() as u64;
            state.recorder.record_error(record_id, duration, &e);

            emit_event(&state, "proxy:response", &serde_json::json!({
                "id": record_id,
                "status": 502,
                "durationMs": duration,
                "error": &e,
            }));

            Ok(forwarder::build_error_response(502, &e))
        }
    }
}

/// 向前端发送事件
fn emit_event(state: &ProxyState, event: &str, payload: &serde_json::Value) {
    if let Some(ref handle) = state.app_handle {
        use tauri::Emitter;
        let _ = handle.emit(event, payload.clone());
    }
}

/// 获取当前时间 ISO 8601 格式
fn now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", now.as_secs())
}
