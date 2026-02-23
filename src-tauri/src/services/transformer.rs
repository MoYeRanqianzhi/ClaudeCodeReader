//! # 消息转换器
//!
//! 将原始 `Vec<serde_json::Value>` 消息列表转换为前端可直接渲染的 `TransformedSession`。
//!
//! ## 转换流程
//! 1. **并行 map**：使用 rayon 对每条消息独立执行分类、提取 tool_use 信息、提取 usage
//! 2. **顺序 reduce**：按消息顺序合并 tool_use_map 和 token_stats，构建 DisplayMessage 列表
//! 3. **搜索文本提取**：并行提取每条 DisplayMessage 的原始大小写文本（`original_texts`），
//!    再从原始文本生成小写化版本（`search_texts`），避免二次遍历 content 块
//!
//! 消息保持原始时间顺序（旧→新），前端通过渐进式渲染实现视口优先加载。
//!
//! ## 设计原则
//! - 零注入：不修改原始 `serde_json::Value`
//! - 完全分离：`DisplayMessage` 是独立 struct
//! - 搜索文本双版本缓存：
//!   - `search_texts`：小写化版本，用于大小写不敏感搜索
//!   - `original_texts`：原始大小写版本，用于大小写敏感搜索和正则搜索

use std::collections::HashMap;

use rayon::prelude::*;
use serde_json::Value;

use crate::models::display::{
    DisplayMessage, TokenStats, ToolUseInfo, TransformedSession,
};
use crate::services::classifier::{self, Classification};

/// 单条消息的并行处理中间结果
///
/// 在 rayon 并行 map 阶段生成，包含该消息的分类结果、
/// 提取的 tool_use 信息和 usage 统计数据。
struct PerMessageResult {
    /// 消息分类结果
    classification: Classification,
    /// 从 assistant 消息 content 中提取的 tool_use 块信息
    /// key = tool_use id, value = ToolUseInfo { name, input }
    tool_uses: Vec<(String, ToolUseInfo)>,
    /// 从 assistant 消息中提取的 usage 统计（可能为 None）
    usage: Option<Value>,
}

/// 转换入口：将原始消息列表转换为前端可渲染的 TransformedSession
///
/// 返回 `(TransformedSession, Vec<String>, Vec<String>)` 三元组：
/// - `TransformedSession`：通过 IPC 返回给前端
/// - `Vec<String>`（search_texts）：小写化搜索文本，`search_texts[i]` 对应
///   `display_messages[i]` 的小写化文本，用于大小写不敏感搜索
/// - `Vec<String>`（original_texts）：原始大小写搜索文本，用于大小写敏感搜索和正则搜索
///
/// 两个搜索文本向量均仅缓存在 Rust 端，不传给前端。
///
/// # 参数
/// - `messages` - 原始消息 `Vec<Value>` 列表（从 JSONL 解析）
///
/// # 返回值
/// `(TransformedSession, Vec<String>, Vec<String>)` 三元组：
/// `(session, lowercase_texts, original_texts)`
pub fn transform_session(messages: &[Value]) -> (TransformedSession, Vec<String>, Vec<String>) {
    // ---- 阶段 1：并行 map，每条消息独立处理（分类 + tool_use 提取 + usage 提取）----
    let per_msg: Vec<PerMessageResult> = messages
        .par_iter()
        .map(|msg| PerMessageResult {
            classification: classifier::classify(msg),
            tool_uses: extract_tool_uses(msg),
            usage: extract_usage(msg),
        })
        .collect();

    // ---- 阶段 2：顺序 reduce，保持消息顺序 ----
    let mut tool_use_map = HashMap::new();
    let mut token_stats = TokenStats::default();
    let mut display_messages = Vec::with_capacity(messages.len());

    for (result, msg) in per_msg.into_iter().zip(messages.iter()) {
        // 合并 tool_use_map
        for (id, info) in result.tool_uses {
            tool_use_map.insert(id, info);
        }
        // 累加 token_stats
        token_stats.accumulate(&result.usage);
        // 构建 DisplayMessage（User 消息拆分 tool_result）
        build_display_messages(&mut display_messages, result.classification, msg);
    }

    // ---- 阶段 3：并行提取原始大小写搜索文本 ----
    // 先提取 original_texts（保留原始大小写），再从 original_texts 直接小写化生成
    // search_texts，避免两次遍历 content 块，提高性能
    let original_texts: Vec<String> = display_messages
        .par_iter()
        .map(|dm| extract_search_text_original(&dm.content))
        .collect();

    // ---- 阶段 4：从 original_texts 生成小写化版本 ----
    // 直接调用 to_lowercase()，无需再次遍历 content 块
    let search_texts: Vec<String> = original_texts
        .par_iter()
        .map(|t| t.to_lowercase())
        .collect();

    (
        TransformedSession {
            display_messages,
            tool_use_map,
            token_stats,
        },
        search_texts,
        original_texts,
    )
}

/// 从 assistant 消息的 content 数组中提取所有 tool_use 块的信息
///
/// 遍历 `message.content` 数组，对每个 `type === "tool_use"` 的块，
/// 提取其 `id`、`name`、`input` 字段。
///
/// # 参数
/// - `msg` - 原始消息 Value
///
/// # 返回值
/// `Vec<(tool_use_id, ToolUseInfo)>` 列表；非 assistant 消息返回空 Vec
fn extract_tool_uses(msg: &Value) -> Vec<(String, ToolUseInfo)> {
    // 仅 assistant 消息包含 tool_use 块
    if msg.get("type").and_then(|v| v.as_str()) != Some("assistant") {
        return vec![];
    }
    let content = msg
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array());

    let Some(arr) = content else {
        return vec![];
    };

    let mut result = Vec::new();
    for block in arr {
        if block.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
            if let Some(id) = block.get("id").and_then(|v| v.as_str()) {
                let name = block
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("未知工具")
                    .to_string();
                let input = block
                    .get("input")
                    .cloned()
                    .unwrap_or(Value::Object(Default::default()));
                result.push((id.to_string(), ToolUseInfo { name, input }));
            }
        }
    }
    result
}

/// 从消息中提取 usage 统计数据
///
/// # 参数
/// - `msg` - 原始消息 Value
///
/// # 返回值
/// `Some(usage_value)` 或 `None`
fn extract_usage(msg: &Value) -> Option<Value> {
    msg.get("message")
        .and_then(|m| m.get("usage"))
        .cloned()
}

/// 根据分类结果构建 DisplayMessage 并添加到列表中
///
/// 处理逻辑与前端 `transformForDisplay` 完全一致：
/// - Skip → 不生成任何 DisplayMessage
/// - Assistant → 直接映射为一条 DisplayMessage
/// - CompactSummary → 提取文本后作为 compact_summary
/// - SlashCommand → 提取命令名后作为 user
/// - System → 保留所有内容块 + 附加 system_label / plan_source_path
/// - User → 拆分 tool_result 块为独立 DisplayMessage
///
/// # 参数
/// - `out` - 输出 DisplayMessage 列表
/// - `classification` - 分类结果
/// - `msg` - 原始消息 Value
fn build_display_messages(
    out: &mut Vec<DisplayMessage>,
    classification: Classification,
    msg: &Value,
) {
    // 提取公共字段
    let uuid = msg
        .get("uuid")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let timestamp = msg
        .get("timestamp")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let cwd = msg
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // 提取 assistant 专属字段（model, usage, toolUseResult, todos）
    let model = msg
        .get("message")
        .and_then(|m| m.get("model"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let usage = msg
        .get("message")
        .and_then(|m| m.get("usage"))
        .cloned();
    let tool_use_result = msg.get("toolUseResult").cloned();
    let todos = msg
        .get("todos")
        .and_then(|v| v.as_array())
        .cloned();

    // 获取 content 字段
    let content_val = msg.get("message").and_then(|m| m.get("content"));

    match classification {
        Classification::Skip => {
            // 非聊天消息，不生成 DisplayMessage
        }

        Classification::Assistant => {
            // assistant 消息：直接映射，保留所有内容块
            let (blocks, block_map) = content_to_blocks(content_val);
            out.push(DisplayMessage {
                source_uuid: uuid.clone(),
                display_id: uuid,
                display_type: "assistant".into(),
                timestamp,
                content: blocks,
                editable: true,
                block_index_map: block_map,
                model,
                usage,
                tool_use_result,
                todos,
                system_label: None,
                plan_source_path: None,
                cwd,
            });
        }

        Classification::CompactSummary => {
            // 压缩摘要：提取纯文本后作为单个 text 块
            let text = extract_text_from_content(content_val);
            let block = serde_json::json!({ "type": "text", "text": text });
            out.push(DisplayMessage {
                source_uuid: uuid.clone(),
                display_id: uuid,
                display_type: "compact_summary".into(),
                timestamp,
                content: vec![block],
                editable: false,
                block_index_map: vec![0],
                model: None,
                usage: None,
                tool_use_result: None,
                todos: None,
                system_label: None,
                plan_source_path: None,
                cwd,
            });
        }

        Classification::SlashCommand(cmd) => {
            // 斜杠命令：将内容替换为提取的命令名
            let block = serde_json::json!({ "type": "text", "text": cmd });
            out.push(DisplayMessage {
                source_uuid: uuid.clone(),
                display_id: uuid,
                display_type: "user".into(),
                timestamp,
                content: vec![block],
                editable: false,
                block_index_map: vec![0],
                model: None,
                usage: None,
                tool_use_result: None,
                todos: None,
                system_label: None,
                plan_source_path: None,
                cwd,
            });
        }

        Classification::System {
            label,
            plan_source_path,
        } => {
            // 系统消息：保留所有原始内容块
            let (blocks, block_map) = content_to_blocks(content_val);
            out.push(DisplayMessage {
                source_uuid: uuid.clone(),
                display_id: uuid,
                display_type: "system".into(),
                timestamp,
                content: blocks,
                editable: false,
                block_index_map: block_map,
                model: None,
                usage: None,
                tool_use_result: None,
                todos: None,
                system_label: Some(label),
                plan_source_path,
                cwd,
            });
        }

        Classification::User => {
            // 普通 user 消息：拆分 tool_result 块
            build_user_display_messages(out, &uuid, &timestamp, cwd, content_val);
        }
    }
}

/// 将 content Value 转换为 blocks Vec + blockIndexMap
///
/// 处理 content 的两种格式：
/// - 字符串：包装为 `[{ "type": "text", "text": content }]`
/// - 数组：直接使用，blockIndexMap 为 0..N
///
/// # 参数
/// - `content` - `message.content` 的 Value（可能是 String, Array, 或 None）
///
/// # 返回值
/// `(Vec<Value> blocks, Vec<usize> block_index_map)`
fn content_to_blocks(content: Option<&Value>) -> (Vec<Value>, Vec<usize>) {
    match content {
        Some(Value::String(s)) => {
            let block = serde_json::json!({ "type": "text", "text": s });
            (vec![block], vec![0])
        }
        Some(Value::Array(arr)) => {
            let map: Vec<usize> = (0..arr.len()).collect();
            (arr.clone(), map)
        }
        _ => (vec![], vec![]),
    }
}

/// 从 content 中提取纯文本（与 classifier 中的 extract_text 功能相同，但返回 String）
///
/// # 参数
/// - `content` - `message.content` 的 Value
///
/// # 返回值
/// 提取到的纯文本字符串
fn extract_text_from_content(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(arr)) => {
            let mut buf = String::new();
            for block in arr {
                if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                    if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                        if !buf.is_empty() {
                            buf.push('\n');
                        }
                        buf.push_str(t);
                    }
                }
            }
            buf
        }
        _ => String::new(),
    }
}

/// 为普通 user 消息构建 DisplayMessage，拆分 tool_result 块
///
/// 逻辑与前端 `transformForDisplay` 中的 user 消息处理完全一致：
/// 1. 遍历 content 数组
/// 2. `tool_result` 块 → 独立 DisplayMessage（displayId = `{uuid}-tool-{seqIdx}`）
/// 3. 非 `tool_result` 块 → 合并为一条 user DisplayMessage
/// 4. `blockIndexMap` 记录每个块在原始数组中的索引
///
/// # 参数
/// - `out` - 输出 DisplayMessage 列表
/// - `uuid` - 原始消息 UUID
/// - `timestamp` - 原始消息时间戳
/// - `cwd` - 当前工作目录
/// - `content` - `message.content` 的 Value
fn build_user_display_messages(
    out: &mut Vec<DisplayMessage>,
    uuid: &str,
    timestamp: &str,
    cwd: Option<String>,
    content: Option<&Value>,
) {
    match content {
        // 字符串格式：直接作为一条 user 消息
        Some(Value::String(s)) => {
            let block = serde_json::json!({ "type": "text", "text": s });
            out.push(DisplayMessage {
                source_uuid: uuid.to_string(),
                display_id: uuid.to_string(),
                display_type: "user".into(),
                timestamp: timestamp.to_string(),
                content: vec![block],
                editable: true,
                block_index_map: vec![0],
                model: None,
                usage: None,
                tool_use_result: None,
                todos: None,
                system_label: None,
                plan_source_path: None,
                cwd,
            });
        }

        // 数组格式：分离 tool_result 块和非 tool_result 块
        Some(Value::Array(arr)) => {
            // 收集用户内容块和 tool_result 块
            let mut user_blocks: Vec<(Value, usize)> = Vec::new();
            let mut tool_result_blocks: Vec<(Value, usize)> = Vec::new();

            for (index, block) in arr.iter().enumerate() {
                if block.get("type").and_then(|v| v.as_str()) == Some("tool_result") {
                    tool_result_blocks.push((block.clone(), index));
                } else {
                    user_blocks.push((block.clone(), index));
                }
            }

            // 生成用户消息部分（如果有非 tool_result 的内容块）
            if !user_blocks.is_empty() {
                let blocks: Vec<Value> = user_blocks.iter().map(|(b, _)| b.clone()).collect();
                let map: Vec<usize> = user_blocks.iter().map(|(_, i)| *i).collect();
                out.push(DisplayMessage {
                    source_uuid: uuid.to_string(),
                    display_id: uuid.to_string(),
                    display_type: "user".into(),
                    timestamp: timestamp.to_string(),
                    content: blocks,
                    editable: true,
                    block_index_map: map,
                    model: None,
                    usage: None,
                    tool_use_result: None,
                    todos: None,
                    system_label: None,
                    plan_source_path: None,
                    cwd: cwd.clone(),
                });
            }

            // 生成工具结果消息（每个 tool_result 块一条独立消息）
            for (seq_idx, (block, original_index)) in tool_result_blocks.into_iter().enumerate() {
                out.push(DisplayMessage {
                    source_uuid: uuid.to_string(),
                    display_id: format!("{}-tool-{}", uuid, seq_idx),
                    display_type: "tool_result".into(),
                    timestamp: timestamp.to_string(),
                    content: vec![block],
                    editable: true,
                    block_index_map: vec![original_index],
                    model: None,
                    usage: None,
                    tool_use_result: None,
                    todos: None,
                    system_label: None,
                    plan_source_path: None,
                    cwd: cwd.clone(),
                });
            }
        }

        // content 为 None 或其他格式：不生成 DisplayMessage
        _ => {}
    }
}

/// 从内容块列表中提取所有可搜索文本，保留原始大小写
///
/// 提取策略：
/// - text 块 → text 字段
/// - thinking 块 → thinking 字段
/// - tool_result 块 → content 字段（字符串或嵌套数组）
/// - tool_use 块 → input 字段（序列化为 JSON 字符串）
///
/// 结果保留原始大小写（不做小写化），用于：
/// 1. 大小写敏感搜索模式（直接使用）
/// 2. 正则表达式搜索模式（直接使用）
/// 3. 生成小写化版本 `search_texts`（调用方在此基础上 `.to_lowercase()`）
///
/// 相比原有 `extract_search_text`，本函数去掉了末尾的 `.to_lowercase()` 调用，
/// 由 `transform_session` 统一批量小写化，减少重复的字符串分配。
///
/// # 参数
/// - `content` - DisplayMessage 的 content 块列表
///
/// # 返回值
/// 保留原始大小写的可搜索文本字符串
fn extract_search_text_original(content: &[Value]) -> String {
    let mut buf = String::new();
    for block in content {
        // text 块：提取 text 字段
        if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
            buf.push_str(t);
            buf.push('\n');
        }
        // thinking 块：提取 thinking 字段
        if let Some(t) = block.get("thinking").and_then(|v| v.as_str()) {
            buf.push_str(t);
            buf.push('\n');
        }
        // tool_result 嵌套内容：content 字段（字符串或数组）
        if let Some(c) = block.get("content") {
            if let Some(s) = c.as_str() {
                buf.push_str(s);
                buf.push('\n');
            }
            if let Some(arr) = c.as_array() {
                for item in arr {
                    if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                        buf.push_str(t);
                        buf.push('\n');
                    }
                }
            }
        }
        // tool_use 块：将 input 序列化为 JSON 字符串
        if block.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
            if let Some(input) = block.get("input") {
                buf.push_str(&input.to_string());
                buf.push('\n');
            }
        }
    }
    // 返回原始大小写文本（不做 to_lowercase()）
    buf
}
