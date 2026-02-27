//! # 修复项：去除 thinking/redacted_thinking 内容块
//!
//! ## 档位：Entry（条目修复）
//!
//! 该修复只操作解析后的消息条目，不直接访问文件系统。
//! 框架自动负责文件读取和覆写。
//!
//! ## 问题描述
//! Claude API 返回的 400 错误：
//! ```
//! API Error: 400 {"type":"error","error":{"type":"invalid_request_error",
//! "message":"messages.7.content.0: Invalid `signature` in `thinking` block"}}
//! ```
//!
//! 该错误发生在会话文件中存在过期或无效签名的 thinking 块时，
//! Claude Code 尝试 resume 时因签名校验失败而报 400 错误。
//!
//! ## 修复方式
//! 遍历消息列表中的每条消息，移除 `message.content` 数组中
//! `type` 为 `"thinking"` 或 `"redacted_thinking"` 的内容块。
//! 仅修改包含这些内容块的消息，其他消息保持原样。

use std::future::Future;
use std::pin::Pin;

use crate::models::message::SessionMessage;
use crate::services::fixers::{FixDefinition, FixLevel, FixResult};

/// 返回该修复项的元数据定义
///
/// 提供问题名称、描述、修复方式、搜索标签和档位级别，
/// 供前端列表展示和搜索过滤使用。
pub fn definition() -> FixDefinition {
    FixDefinition {
        id: "strip_thinking".to_string(),
        name: "400 (thinking block) 错误".to_string(),
        description: concat!(
            "API Error: 400 {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",",
            "\"message\":\"messages.N.content.0: Invalid `signature` in `thinking` block\"}}",
            "\n\n",
            "该错误发生在会话文件中存在过期或无效签名的 thinking 块时，",
            "Claude Code 尝试 resume 时因签名校验失败而报 400 错误。"
        )
        .to_string(),
        fix_method: "去除会话文件中所有 thinking 和 redacted_thinking 类型的内容块，\
                     保留其余消息内容不变。"
            .to_string(),
        tags: vec![
            "thinking".to_string(),
            "redacted_thinking".to_string(),
            "400".to_string(),
            "invalid_request_error".to_string(),
            "signature".to_string(),
            "resume".to_string(),
        ],
        level: FixLevel::Entry,
    }
}

/// 执行修复：移除 thinking/redacted_thinking 内容块（Entry 档位）
///
/// 接收框架已解析好的消息列表，在原地移除 thinking 类型的内容块。
/// 修复完成后框架会根据 `affected_lines` 判断是否需要覆写文件。
///
/// # 参数
/// - `messages` — 解析后的消息列表（可变引用），由框架提供
///
/// # 返回值
/// 成功时返回 FixResult，包含受影响的消息行数；
/// 失败时返回错误描述字符串。
pub fn execute<'a>(
    messages: &'a mut Vec<SessionMessage>,
) -> Pin<Box<dyn Future<Output = Result<FixResult, String>> + Send + 'a>> {
    Box::pin(execute_inner(messages))
}

/// 修复逻辑的内部实现
///
/// 遍历每条消息，检查 `message.content` 数组中是否包含
/// thinking 或 redacted_thinking 类型的内容块，如有则移除。
async fn execute_inner(
    messages: &mut Vec<SessionMessage>,
) -> Result<FixResult, String> {
    if messages.is_empty() {
        return Ok(FixResult {
            success: true,
            message: "会话文件为空，无需修复".to_string(),
            affected_lines: 0,
        });
    }

    // 遍历每条消息，移除 thinking/redacted_thinking 内容块
    let mut affected_count = 0;

    for msg in messages.iter_mut() {
        // SessionMessage 是 serde_json::Value
        // 结构：{ "message": { "content": [ { "type": "thinking", ... }, ... ] }, ... }
        let content_modified = remove_thinking_blocks(msg, &["message", "content"]);
        if content_modified {
            affected_count += 1;
        }
    }

    if affected_count == 0 {
        return Ok(FixResult {
            success: true,
            message: "未发现 thinking 内容块，无需修复".to_string(),
            affected_lines: 0,
        });
    }

    Ok(FixResult {
        success: true,
        message: format!(
            "成功修复：已从 {} 条消息中移除 thinking/redacted_thinking 内容块",
            affected_count
        ),
        affected_lines: affected_count,
    })
}

/// 从指定路径的 JSON 值中移除 thinking 类型的内容块
///
/// 沿着 `path` 指定的键路径深入 JSON 结构，找到 content 数组后，
/// 过滤掉 `type` 为 `"thinking"` 或 `"redacted_thinking"` 的元素。
///
/// # 参数
/// - `value` — 可变的 serde_json::Value 引用（整条消息）
/// - `path` — 键路径数组（如 `["message", "content"]`）
///
/// # 返回值
/// 如果确实移除了至少一个内容块，返回 true；否则返回 false
fn remove_thinking_blocks(value: &mut serde_json::Value, path: &[&str]) -> bool {
    // 沿路径深入到目标节点
    let mut current = value as &mut serde_json::Value;
    for &key in path {
        match current.get_mut(key) {
            Some(next) => current = next,
            None => return false, // 路径不存在，跳过
        }
    }

    // 目标节点必须是数组
    let arr = match current.as_array() {
        Some(arr) => arr,
        None => return false,
    };

    // 检查是否存在 thinking 类型的内容块
    let original_len = arr.len();
    let filtered: Vec<serde_json::Value> = arr
        .iter()
        .filter(|item| {
            // 保留 type 不是 thinking/redacted_thinking 的项
            match item.get("type").and_then(|t| t.as_str()) {
                Some("thinking") | Some("redacted_thinking") => false,
                _ => true,
            }
        })
        .cloned()
        .collect();

    // 如果长度没变化，说明没有 thinking 块
    if filtered.len() == original_len {
        return false;
    }

    // 用过滤后的数组替换原数组
    *current = serde_json::Value::Array(filtered);
    true
}
