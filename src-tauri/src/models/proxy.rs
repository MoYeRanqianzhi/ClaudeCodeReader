//! # 代理数据模型
//!
//! 定义中转抓包功能的所有数据结构，对应前端 TypeScript 类型。
//! 包括代理模式、代理状态、请求记录、拦截决策等。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// 代理工作模式
///
/// 三种模式对应不同的请求处理策略：
/// - Overview: 直接转发，仅记录摘要
/// - Inspect: 直接转发，完整记录 headers 和 body
/// - Intercept: 暂停请求，等待用户决策
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProxyMode {
    /// 总览模式：直接转发，仅记录摘要（方法、URL、状态码、耗时、大小）
    Overview,
    /// 查看模式：直接转发，完整记录 headers 和 body
    Inspect,
    /// 拦截模式：暂停请求，等待用户决策（放行/修改/丢弃/伪造）
    Intercept,
}

/// 代理运行状态
///
/// 通过 Tauri command 返回给前端，反映代理的当前状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatus {
    /// 代理是否正在运行
    pub running: bool,
    /// 代理监听的端口号（未运行时为 None）
    pub port: Option<u16>,
    /// 当前工作模式
    pub mode: ProxyMode,
    /// 上游 API 的原始 URL（代理启动前的 ANTHROPIC_BASE_URL）
    pub upstream_url: Option<String>,
    /// 当前待处理的拦截请求数量
    pub pending_intercepts: usize,
}

/// 代理记录摘要
///
/// 请求列表中每条记录的摘要信息，用于列表展示。
/// 完整的请求/响应内容通过 `get_record_detail` 命令按需获取。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRecord {
    /// 记录唯一 ID（自增）
    pub id: u64,
    /// HTTP 方法（GET/POST/PUT/DELETE 等）
    pub method: String,
    /// 请求 URL 路径（如 /v1/messages）
    pub url: String,
    /// 请求状态
    pub status: RecordStatus,
    /// HTTP 响应状态码（请求未完成时为 None）
    pub status_code: Option<u16>,
    /// 请求耗时（毫秒，请求未完成时为 None）
    pub duration_ms: Option<u64>,
    /// 响应体大小（字节，请求未完成时为 None）
    pub response_size: Option<u64>,
    /// 请求发起时间（ISO 8601 格式）
    pub timestamp: String,
}

/// 请求记录状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordStatus {
    /// 请求进行中（等待上游响应）
    Pending,
    /// 等待用户拦截决策（请求阶段）
    Intercepted,
    /// 等待用户拦截决策（响应阶段：上游已返回，等待用户决定如何回传给 CC）
    ResponseIntercepted,
    /// 请求已完成
    Completed,
    /// 请求被用户丢弃
    Dropped,
    /// 请求出错（上游不可达、超时等）
    Error,
}

/// 代理记录详情
///
/// 包含完整的请求和响应内容，用于详情面板展示和编辑。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRecordDetail {
    /// 记录摘要（包含 id、method、url 等基础信息）
    pub summary: ProxyRecord,
    /// 请求 headers
    pub request_headers: HashMap<String, String>,
    /// 请求 body（文本内容，通常是 JSON）
    pub request_body: Option<String>,
    /// 响应 headers（请求未完成时为空）
    pub response_headers: HashMap<String, String>,
    /// 响应 body（文本内容，可能很大；SSE 流会拼接所有事件）
    pub response_body: Option<String>,
    /// 错误信息（请求失败时）
    pub error_message: Option<String>,
}

/// 拦截决策
///
/// 前端用户在拦截模式下对暂停的请求做出的决策。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum InterceptAction {
    /// 放行原样：不修改请求内容，直接转发到上游
    Forward,
    /// 修改后放行：使用修改后的 headers 和 body 转发
    ForwardModified {
        /// 修改后的请求 headers
        headers: Option<HashMap<String, String>>,
        /// 修改后的请求 body
        body: Option<String>,
    },
    /// 丢弃请求：不转发，返回指定状态码给 Claude Code
    #[serde(rename_all = "camelCase")]
    Drop {
        /// 返回给客户端的 HTTP 状态码（默认 503）
        status_code: u16,
    },
    /// 伪造响应：不转发到上游，直接返回自定义响应
    #[serde(rename_all = "camelCase")]
    MockResponse {
        /// 伪造响应的 HTTP 状态码
        status_code: u16,
        /// 伪造响应的 headers
        headers: HashMap<String, String>,
        /// 伪造响应的 body
        body: String,
    },
}

/// 代理状态文件
///
/// 存储在 `~/.mo/CCR/proxy-state.json`，用于崩溃恢复。
/// 当代理启动时写入，关闭时清除 active 标记。
/// 如果 CCR 异常退出，下次启动时检测到 active=true 则自动恢复。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStateFile {
    /// 代理是否处于激活状态（正常关闭后设为 false）
    pub active: bool,
    /// 代理启动前 settings.json 中的原始 ANTHROPIC_BASE_URL
    /// 为 None 表示原始 settings.json 中没有设置此变量
    pub original_url: Option<String>,
    /// 代理启动时间（ISO 8601 格式）
    pub started_at: String,
    /// 代理监听的端口号
    pub port: u16,
}

/// 拦截响应决策
///
/// 前端用户对拦截到的上游响应做出的决策。
/// 在拦截模式下，请求转发到上游后收到响应，暂停等待用户决策。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum InterceptResponseAction {
    /// 放行原样：不修改响应内容，直接返回给 Claude Code
    Forward,
    /// 修改后放行：使用修改后的 headers 和 body 返回
    ForwardModified {
        /// 修改后的响应 headers
        headers: Option<HashMap<String, String>>,
        /// 修改后的响应 body
        body: Option<String>,
    },
    /// 丢弃响应：不返回上游响应，给 Claude Code 返回错误
    #[serde(rename_all = "camelCase")]
    Drop {
        /// 返回给客户端的 HTTP 状态码
        status_code: u16,
    },
}
