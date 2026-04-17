//! # 修复项：清理会话图片数据，解决 Request too large 错误
//!
//! ## 修复信息
//!
//! - **修复者（Author）**：MoYeRanQianZhi（CCR 项目维护者）
//! - **修复模型（Model）**：Claude Opus 4.6
//! - **修复时间（Date）**：2026-04-18
//! - **修复设备（Device）**：Windows 11 PC
//! - **档位（Level）**：Entry（条目修复）
//!
//! ## 问题描述
//!
//! Claude Code 长会话中，图片以 base64 编码嵌入 JSONL 消息，导致文件
//! 膨胀超过 API 的 20MB/32MB 请求大小限制。
//!
//! 错误信息：
//! ```
//! Request too large (max 20MB). Double press esc to go back and try with a smaller file.
//! ```
//!
//! 图片来源包括：用户粘贴/拖拽的截图、MCP 工具返回的截图等。
//! 每张图片经 base64 编码后体积约为原始大小的 1.37 倍。
//!
//! 参见 GitHub issue: https://github.com/anthropics/claude-code/issues/34751
//!
//! ## 修复方式
//!
//! 遍历消息列表，将 `type: "image"` 的内容块替换为 `{"type": "text", "text": "[image]"}`。
//! 同时处理 `type: "document"` 块（替换为 `[document]`）。
//!
//! 图片可能出现在两个位置：
//! 1. 用户消息的 `message.content[]` 顶层
//! 2. `tool_result` 内容块的 `content[]` 嵌套层
//!
//! 支持可选参数 `keep_last`（保留最后 N 张图片），默认为 0（全部清理）。
//! 清理策略参考 Claude Code 源码 `compact.ts` 的 `stripImagesFromMessages`。

use std::future::Future;
use std::pin::Pin;

use serde_json::Value;

use crate::models::message::SessionMessage;
use crate::services::fixers::{
    FixDefinition, FixLevel, FixOptionDef, FixOptionType, FixResult,
};

/// 返回该修复项的元数据定义
///
/// 包含一个可配置参数 `keep_last`，允许用户选择保留最后几张图片。
pub fn definition() -> FixDefinition {
    FixDefinition {
        id: "strip_images".to_string(),
        name: "Request too large (图片膨胀) 错误".to_string(),
        description: concat!(
            "Request too large (max 20MB). Double press esc to go back and try with a smaller file.\n\n",
            "该错误发生在长会话中累积了大量图片（粘贴截图、MCP 截图等），\n",
            "图片以 base64 编码嵌入消息中，导致整个请求载荷超过 API 大小限制。\n",
            "重启会话、/clear、/compact 均无法解决，因为图片已持久化在 JSONL 文件中。\n\n",
            "参见 GitHub issue: anthropics/claude-code#34751"
        )
        .to_string(),
        fix_method: concat!(
            "将会话文件中所有图片内容块替换为 [image] 文本占位符，\n",
            "同时处理 document 类型块（替换为 [document]）。\n",
            "可通过「保留最后 N 张图片」参数保留最近的几张截图。"
        )
        .to_string(),
        tags: vec![
            "image".to_string(),
            "图片".to_string(),
            "request_too_large".to_string(),
            "20MB".to_string(),
            "32MB".to_string(),
            "base64".to_string(),
            "screenshot".to_string(),
            "截图".to_string(),
            "too large".to_string(),
        ],
        level: FixLevel::Entry,
        options: vec![FixOptionDef {
            key: "keep_last".to_string(),
            label: "保留最后 N 张图片".to_string(),
            option_type: FixOptionType::Number,
            default_value: Value::Number(0.into()),
            description: Some(
                "设为 0 表示清理所有图片；设为正整数 N 表示保留消息中最后出现的 N 张图片"
                    .to_string(),
            ),
        }],
    }
}

/// 执行修复：清理图片/document 内容块（Entry 档位）
///
/// 接收框架已解析好的消息列表和可选参数，在原地替换图片块为文本占位符。
///
/// # 参数
/// - `messages` — 解析后的消息列表（可变引用），由框架提供
/// - `options` — 可选参数 JSON，可包含 `keep_last` 字段
pub fn execute<'a>(
    messages: &'a mut Vec<SessionMessage>,
    options: &'a Value,
) -> Pin<Box<dyn Future<Output = Result<FixResult, String>> + Send + 'a>> {
    Box::pin(execute_inner(messages, options))
}

// ============ 图片位置索引 ============

/// 标记一张图片在消息列表中的精确位置
///
/// 用于第一轮扫描收集所有图片位置后，决定哪些需要保留。
#[derive(Debug)]
struct ImageLocation {
    /// 图片所在的消息索引（在 messages 数组中）
    msg_index: usize,
    /// 在 message.content 数组中的索引
    content_index: usize,
    /// 如果图片嵌套在 tool_result 内，这是 tool_result.content 中的索引；
    /// None 表示图片在顶层 content 中
    nested_index: Option<usize>,
}

// ============ 内部实现 ============

/// 修复逻辑的内部实现
///
/// 两轮遍历策略：
/// 1. 第一轮收集所有图片/document 位置
/// 2. 根据 keep_last 参数确定保留集合
/// 3. 第二轮替换不保留的图片/document 为文本占位符
async fn execute_inner(
    messages: &mut Vec<SessionMessage>,
    options: &Value,
) -> Result<FixResult, String> {
    if messages.is_empty() {
        return Ok(FixResult {
            success: true,
            message: "会话文件为空，无需修复".to_string(),
            affected_lines: 0,
        });
    }

    // 从 options 解析 keep_last 参数（默认 0 = 全部清理）
    let keep_last = options
        .get("keep_last")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;

    // ---- 第一轮：收集所有图片/document 位置 ----
    let mut image_locations: Vec<ImageLocation> = Vec::new();

    for (msg_idx, msg) in messages.iter().enumerate() {
        let content = match msg
            .pointer("/message/content")
            .and_then(|v| v.as_array())
        {
            Some(arr) => arr,
            None => continue,
        };

        for (block_idx, block) in content.iter().enumerate() {
            let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");

            if block_type == "image" || block_type == "document" {
                // 顶层的图片/document
                image_locations.push(ImageLocation {
                    msg_index: msg_idx,
                    content_index: block_idx,
                    nested_index: None,
                });
            } else if block_type == "tool_result" {
                // 检查 tool_result 嵌套的 content 数组
                if let Some(nested_content) =
                    block.get("content").and_then(|c| c.as_array())
                {
                    for (nested_idx, nested_block) in nested_content.iter().enumerate() {
                        let nested_type = nested_block
                            .get("type")
                            .and_then(|t| t.as_str())
                            .unwrap_or("");
                        if nested_type == "image" || nested_type == "document" {
                            image_locations.push(ImageLocation {
                                msg_index: msg_idx,
                                content_index: block_idx,
                                nested_index: Some(nested_idx),
                            });
                        }
                    }
                }
            }
        }
    }

    if image_locations.is_empty() {
        return Ok(FixResult {
            success: true,
            message: "未发现图片或文档内容块，无需修复".to_string(),
            affected_lines: 0,
        });
    }

    let total_images = image_locations.len();

    // ---- 确定保留集合 ----
    // 保留最后 keep_last 张图片（按在消息中出现的顺序，越靠后越新）
    let skip_count = if keep_last > 0 && keep_last < total_images {
        total_images - keep_last
    } else if keep_last >= total_images {
        // keep_last 大于等于总数，全部保留
        return Ok(FixResult {
            success: true,
            message: format!(
                "会话中共有 {} 张图片/文档，保留数量 {} 已覆盖全部，无需清理",
                total_images, keep_last
            ),
            affected_lines: 0,
        });
    } else {
        // keep_last == 0，全部清理
        total_images
    };

    // 前 skip_count 张需要被清理（它们是最早的）
    let to_strip: std::collections::HashSet<usize> =
        (0..skip_count).collect();

    // ---- 第二轮：替换图片/document 块为文本占位符 ----
    let mut affected_messages: std::collections::HashSet<usize> =
        std::collections::HashSet::new();

    for (loc_idx, loc) in image_locations.iter().enumerate() {
        if !to_strip.contains(&loc_idx) {
            continue; // 保留此图片
        }

        let msg = &mut messages[loc.msg_index];

        // 获取该图片块的原始类型，决定替换文本
        let replacement_text = get_replacement_text(msg, loc);

        // 执行替换
        let replaced = replace_block(msg, loc, &replacement_text);
        if replaced {
            affected_messages.insert(loc.msg_index);
        }
    }

    let affected_count = affected_messages.len();
    let stripped_count = skip_count;

    if affected_count == 0 {
        return Ok(FixResult {
            success: true,
            message: "替换操作未产生实际变更".to_string(),
            affected_lines: 0,
        });
    }

    let kept_msg = if keep_last > 0 {
        format!("（保留了最后 {} 张）", total_images - stripped_count)
    } else {
        String::new()
    };

    Ok(FixResult {
        success: true,
        message: format!(
            "成功清理：从 {} 条消息中移除了 {} 张图片/文档{}",
            affected_count, stripped_count, kept_msg
        ),
        affected_lines: affected_count,
    })
}

/// 获取图片/document 块的替换文本
///
/// 根据原始块的 type 字段返回 "[image]" 或 "[document]"。
fn get_replacement_text(msg: &Value, loc: &ImageLocation) -> String {
    let block_type = if let Some(nested_idx) = loc.nested_index {
        // 嵌套在 tool_result 内
        msg.pointer(&format!(
            "/message/content/{}/content/{}/type",
            loc.content_index, nested_idx
        ))
        .and_then(|t| t.as_str())
        .unwrap_or("image")
    } else {
        // 顶层 content
        msg.pointer(&format!(
            "/message/content/{}/type",
            loc.content_index
        ))
        .and_then(|t| t.as_str())
        .unwrap_or("image")
    };

    if block_type == "document" {
        "[document]".to_string()
    } else {
        "[image]".to_string()
    }
}

/// 将指定位置的图片/document 块替换为文本占位符
///
/// 构造 `{"type": "text", "text": "[image]"}` 或 `[document]` 替换原始块。
///
/// # 返回值
/// 替换成功返回 true，路径不存在返回 false
fn replace_block(msg: &mut Value, loc: &ImageLocation, replacement_text: &str) -> bool {
    let replacement = serde_json::json!({
        "type": "text",
        "text": replacement_text
    });

    if let Some(nested_idx) = loc.nested_index {
        // 替换 tool_result 嵌套内容
        if let Some(nested_block) = msg.pointer_mut(&format!(
            "/message/content/{}/content/{}",
            loc.content_index, nested_idx
        )) {
            *nested_block = replacement;
            return true;
        }
    } else {
        // 替换顶层 content 块
        if let Some(block) = msg.pointer_mut(&format!(
            "/message/content/{}",
            loc.content_index
        )) {
            *block = replacement;
            return true;
        }
    }

    false
}
