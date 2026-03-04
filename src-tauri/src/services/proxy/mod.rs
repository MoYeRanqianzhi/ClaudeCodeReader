//! # 中转抓包代理服务
//!
//! 提供 HTTP→HTTPS 反向代理功能，拦截 Claude Code CLI 的 API 请求。
//!
//! ## 模块结构
//! - `config_guard` - settings.json 的 ANTHROPIC_BASE_URL 备份/恢复/崩溃恢复
//! - `recorder` - 请求/响应的内存记录、分页查询和导出
//! - `interceptor` - 拦截模式的 oneshot channel 管理和超时控制
//! - `forwarder` - reqwest HTTPS 转发逻辑和 SSE 流式处理
//! - `server` - hyper HTTP 服务器和请求路由
//!
//! ## 数据流
//! ```text
//! Claude Code CLI (HTTP)
//!   → hyper server (127.0.0.1:PORT)
//!     → 根据模式: recorder 记录 / interceptor 拦截等待
//!       → forwarder 通过 reqwest 转发 (HTTPS)
//!         → 上游 Anthropic API
//! ```

pub mod config_guard;
pub mod forwarder;
pub mod interceptor;
pub mod recorder;
pub mod server;
