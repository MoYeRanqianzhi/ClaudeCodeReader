//! # 拦截器
//!
//! 拦截模式下通过 `tokio::sync::oneshot` channel 暂停请求，
//! 等待前端用户决策（放行/修改/丢弃/伪造），支持超时自动放行。
//!
//! ## 工作流程
//! 1. 代理 handler 调用 `create_intercept()` 创建一个 pending 拦截
//! 2. handler 通过 `await receiver` 暂停等待
//! 3. 前端通过 Tauri command 调用 `resolve_intercept()` 发送决策
//! 4. handler 收到决策后继续执行

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::oneshot;

use crate::models::proxy::InterceptAction;

/// 默认拦截超时时间（秒）
const DEFAULT_TIMEOUT_SECS: u64 = 60;

/// 一个待处理的拦截请求
struct PendingIntercept {
    /// 决策发送端（发送后 handler 端继续执行）
    sender: oneshot::Sender<InterceptAction>,
}

/// 拦截器管理器
///
/// 管理所有待处理的拦截请求。线程安全。
#[derive(Clone)]
pub struct Interceptor {
    /// 待处理的拦截：record_id → PendingIntercept
    pending: Arc<Mutex<HashMap<u64, PendingIntercept>>>,
    /// 超时时间（秒）
    timeout_secs: u64,
}

impl Interceptor {
    /// 创建新的拦截器实例
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            timeout_secs: DEFAULT_TIMEOUT_SECS,
        }
    }

    /// 创建一个新的拦截等待
    ///
    /// 返回一个 receiver，handler 通过 `await` 等待用户决策。
    /// 如果超时无响应，自动返回 `InterceptAction::Forward`（放行原样）。
    ///
    /// # 参数
    /// - `record_id` - 关联的记录 ID
    pub fn create_intercept(&self, record_id: u64) -> oneshot::Receiver<InterceptAction> {
        let (sender, receiver) = oneshot::channel();
        let mut pending = self.pending.lock().unwrap();
        pending.insert(record_id, PendingIntercept { sender });
        receiver
    }

    /// 解决一个拦截请求（前端调用）
    ///
    /// 将用户的决策发送给等待中的 handler。
    /// 如果对应的拦截已超时或不存在，返回 false。
    pub fn resolve(&self, record_id: u64, action: InterceptAction) -> bool {
        let mut pending = self.pending.lock().unwrap();
        if let Some(intercept) = pending.remove(&record_id) {
            // send 失败说明 receiver 已被 drop（handler 已超时），忽略
            let _ = intercept.sender.send(action);
            true
        } else {
            false
        }
    }

    /// 等待拦截决策（带超时）
    ///
    /// handler 调用此函数等待用户决策。
    /// 超时后自动放行（返回 `InterceptAction::Forward`）。
    pub async fn wait_for_decision(
        &self,
        record_id: u64,
        receiver: oneshot::Receiver<InterceptAction>,
    ) -> InterceptAction {
        let timeout = Duration::from_secs(self.timeout_secs);

        match tokio::time::timeout(timeout, receiver).await {
            // 正常收到决策
            Ok(Ok(action)) => action,
            // sender 被 drop（不应该发生）
            Ok(Err(_)) => {
                self.cleanup(record_id);
                InterceptAction::Forward
            }
            // 超时：自动放行
            Err(_) => {
                log::warn!("拦截请求 {} 超时（{}s），自动放行", record_id, self.timeout_secs);
                self.cleanup(record_id);
                InterceptAction::Forward
            }
        }
    }

    /// 获取当前待处理的拦截数量
    pub fn pending_count(&self) -> usize {
        self.pending.lock().unwrap().len()
    }

    /// 清理指定 ID 的待处理拦截
    fn cleanup(&self, record_id: u64) {
        let mut pending = self.pending.lock().unwrap();
        pending.remove(&record_id);
    }

    /// 清空所有待处理拦截（代理关闭时调用）
    ///
    /// 向所有等待中的 handler 发送 Forward（放行）决策，
    /// 避免 handler 永久阻塞。
    pub fn clear_all(&self) {
        let mut pending = self.pending.lock().unwrap();
        for (_, intercept) in pending.drain() {
            let _ = intercept.sender.send(InterceptAction::Forward);
        }
    }
}
