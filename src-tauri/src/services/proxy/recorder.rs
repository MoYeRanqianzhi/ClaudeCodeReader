//! # 请求记录器
//!
//! 管理代理拦截到的请求/响应的内存存储。
//! 线程安全，使用 `Arc<Mutex<...>>` 保护内部状态。
//! 支持分页查询、单条详情获取、清空和 JSON 导出。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::models::proxy::{ProxyRecord, ProxyRecordDetail, RecordStatus};

/// 内部记录条目（包含完整请求/响应数据）
#[derive(Debug, Clone)]
struct RecordEntry {
    /// 摘要信息
    summary: ProxyRecord,
    /// 请求 headers
    request_headers: HashMap<String, String>,
    /// 请求 body
    request_body: Option<String>,
    /// 响应 headers
    response_headers: HashMap<String, String>,
    /// 响应 body（SSE 流拼接后的完整内容）
    response_body: Option<String>,
    /// 错误信息
    error_message: Option<String>,
}

/// 请求记录器
///
/// 线程安全的请求/响应记录存储。
/// 由代理服务器在处理每个请求时调用，记录请求和响应的完整内容。
#[derive(Debug, Clone)]
pub struct Recorder {
    /// 内部存储（Arc<Mutex> 保证线程安全）
    entries: Arc<Mutex<Vec<RecordEntry>>>,
    /// 下一个记录 ID（原子自增）
    next_id: Arc<std::sync::atomic::AtomicU64>,
}

impl Recorder {
    /// 创建新的记录器实例
    pub fn new() -> Self {
        Self {
            entries: Arc::new(Mutex::new(Vec::new())),
            next_id: Arc::new(std::sync::atomic::AtomicU64::new(1)),
        }
    }

    /// 记录一个新请求（请求到达时调用）
    ///
    /// 返回分配的记录 ID，后续用于更新响应数据。
    pub fn record_request(
        &self,
        method: &str,
        url: &str,
        headers: HashMap<String, String>,
        body: Option<String>,
    ) -> u64 {
        let id = self
            .next_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        let entry = RecordEntry {
            summary: ProxyRecord {
                id,
                method: method.to_string(),
                url: url.to_string(),
                status: RecordStatus::Pending,
                status_code: None,
                duration_ms: None,
                response_size: None,
                timestamp: now_iso(),
            },
            request_headers: headers,
            request_body: body,
            response_headers: HashMap::new(),
            response_body: None,
            error_message: None,
        };

        let mut entries = self.entries.lock().unwrap();
        entries.push(entry);

        id
    }

    /// 更新记录的请求状态为"拦截中"
    pub fn mark_intercepted(&self, id: u64) {
        let mut entries = self.entries.lock().unwrap();
        if let Some(entry) = entries.iter_mut().find(|e| e.summary.id == id) {
            entry.summary.status = RecordStatus::Intercepted;
        }
    }

    /// 记录响应完成
    pub fn record_response(
        &self,
        id: u64,
        status_code: u16,
        duration_ms: u64,
        headers: HashMap<String, String>,
        body: Option<String>,
    ) {
        let mut entries = self.entries.lock().unwrap();
        if let Some(entry) = entries.iter_mut().find(|e| e.summary.id == id) {
            let response_size = body.as_ref().map(|b| b.len() as u64);
            entry.summary.status = RecordStatus::Completed;
            entry.summary.status_code = Some(status_code);
            entry.summary.duration_ms = Some(duration_ms);
            entry.summary.response_size = response_size;
            entry.response_headers = headers;
            entry.response_body = body;
        }
    }

    /// 记录请求错误
    pub fn record_error(&self, id: u64, duration_ms: u64, error: &str) {
        let mut entries = self.entries.lock().unwrap();
        if let Some(entry) = entries.iter_mut().find(|e| e.summary.id == id) {
            entry.summary.status = RecordStatus::Error;
            entry.summary.duration_ms = Some(duration_ms);
            entry.error_message = Some(error.to_string());
        }
    }

    /// 记录请求被丢弃
    pub fn mark_dropped(&self, id: u64) {
        let mut entries = self.entries.lock().unwrap();
        if let Some(entry) = entries.iter_mut().find(|e| e.summary.id == id) {
            entry.summary.status = RecordStatus::Dropped;
        }
    }

    /// 分页获取记录摘要列表
    ///
    /// 按 ID 降序排列（最新在前）。
    pub fn get_records(&self, offset: usize, limit: usize) -> Vec<ProxyRecord> {
        let entries = self.entries.lock().unwrap();
        entries
            .iter()
            .rev() // 最新在前
            .skip(offset)
            .take(limit)
            .map(|e| e.summary.clone())
            .collect()
    }

    /// 获取单条记录详情
    pub fn get_detail(&self, id: u64) -> Option<ProxyRecordDetail> {
        let entries = self.entries.lock().unwrap();
        entries.iter().find(|e| e.summary.id == id).map(|e| {
            ProxyRecordDetail {
                summary: e.summary.clone(),
                request_headers: e.request_headers.clone(),
                request_body: e.request_body.clone(),
                response_headers: e.response_headers.clone(),
                response_body: e.response_body.clone(),
                error_message: e.error_message.clone(),
            }
        })
    }

    /// 获取记录总数
    #[allow(dead_code)]
    pub fn count(&self) -> usize {
        self.entries.lock().unwrap().len()
    }

    /// 清空所有记录
    pub fn clear(&self) {
        let mut entries = self.entries.lock().unwrap();
        entries.clear();
    }

    /// 导出所有记录为 JSON 字符串
    pub fn export_json(&self) -> Result<String, String> {
        let entries = self.entries.lock().unwrap();
        let details: Vec<ProxyRecordDetail> = entries
            .iter()
            .map(|e| ProxyRecordDetail {
                summary: e.summary.clone(),
                request_headers: e.request_headers.clone(),
                request_body: e.request_body.clone(),
                response_headers: e.response_headers.clone(),
                response_body: e.response_body.clone(),
                error_message: e.error_message.clone(),
            })
            .collect();

        serde_json::to_string_pretty(&details).map_err(|e| format!("导出 JSON 失败: {}", e))
    }
}

/// 获取当前时间 ISO 8601 格式
fn now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", now.as_secs())
}
