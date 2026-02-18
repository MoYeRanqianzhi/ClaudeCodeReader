//! # 消息读写 Tauri Commands
//!
//! 提供会话消息的读取、编辑、删除等 Tauri command 处理函数：
//! - `read_session_messages` - 读取会话的所有消息
//! - `delete_message` - 删除单条消息
//! - `delete_messages` - 批量删除消息
//! - `edit_message_content` - 编辑消息文本内容
//! - `delete_session` - 删除整个会话文件
//!
//! 集成了内存缓存层，避免重复解析 JSONL 文件。

use std::collections::HashSet;

use serde_json::Value;
use tauri::State;

use crate::models::message::SessionMessage;
use crate::services::cache::AppCache;
use crate::services::parser;

/// 读取指定会话的所有消息
///
/// 高性能读取 JSONL 文件并解析为消息数组。
/// 优先从缓存获取，缓存未命中时从文件系统读取并存入缓存。
///
/// # 参数
/// - `session_file_path` - 会话 JSONL 文件的绝对路径
/// - `cache` - Tauri managed state，内存缓存
///
/// # 返回值
/// 返回按文件顺序排列的消息数组
///
/// # 错误
/// 文件读取失败时返回错误
#[tauri::command]
pub async fn read_session_messages(
    session_file_path: String,
    cache: State<'_, AppCache>,
) -> Result<Vec<SessionMessage>, String> {
    // 优先尝试从缓存获取
    if let Some(cached) = cache.get_messages(&session_file_path) {
        return Ok(cached);
    }

    // 缓存未命中，从文件系统读取
    let messages = parser::read_messages(&session_file_path).await?;

    // 存入缓存
    cache.set_messages(&session_file_path, messages.clone());

    Ok(messages)
}

/// 删除指定的单条消息
///
/// 根据消息 UUID 从会话文件中移除一条消息，然后将剩余消息重新保存到文件。
/// 操作完成后更新缓存。
///
/// # 参数
/// - `session_file_path` - 会话 JSONL 文件的绝对路径
/// - `message_uuid` - 要删除的消息的 UUID
/// - `cache` - Tauri managed state，内存缓存
///
/// # 返回值
/// 返回删除后的剩余消息列表
///
/// # 错误
/// 文件读写失败时返回错误
#[tauri::command]
pub async fn delete_message(
    session_file_path: String,
    message_uuid: String,
    cache: State<'_, AppCache>,
) -> Result<Vec<SessionMessage>, String> {
    let messages = parser::read_messages(&session_file_path).await?;

    // 过滤掉目标消息（通过 uuid 字段匹配）
    let filtered: Vec<SessionMessage> = messages
        .into_iter()
        .filter(|msg| {
            msg.get("uuid")
                .and_then(|v| v.as_str())
                .map(|uuid| uuid != message_uuid)
                .unwrap_or(true) // 没有 uuid 字段的消息保留
        })
        .collect();

    parser::write_messages(&session_file_path, &filtered).await?;

    // 更新缓存（写入后文件 mtime 已变化，旧缓存自动失效）
    cache.set_messages(&session_file_path, filtered.clone());

    Ok(filtered)
}

/// 批量删除多条消息
///
/// 根据消息 UUID 列表从会话文件中移除多条消息。
/// 内部使用 HashSet 进行 O(1) 查找，保证批量删除的性能。
///
/// # 参数
/// - `session_file_path` - 会话 JSONL 文件的绝对路径
/// - `message_uuids` - 要删除的消息 UUID 列表
/// - `cache` - Tauri managed state，内存缓存
///
/// # 返回值
/// 返回删除后的剩余消息列表
///
/// # 错误
/// 文件读写失败时返回错误
///
/// # 注意
/// 前端传入的是 `Set<string>`，Tauri IPC 会将其序列化为 `string[]`，
/// Rust 端接收为 `Vec<String>` 后转换为 `HashSet` 进行高效查找。
#[tauri::command]
pub async fn delete_messages(
    session_file_path: String,
    message_uuids: Vec<String>,
    cache: State<'_, AppCache>,
) -> Result<Vec<SessionMessage>, String> {
    let messages = parser::read_messages(&session_file_path).await?;

    // 将 UUID 列表转换为 HashSet，实现 O(1) 查找
    let uuid_set: HashSet<&str> = message_uuids.iter().map(|s| s.as_str()).collect();

    let filtered: Vec<SessionMessage> = messages
        .into_iter()
        .filter(|msg| {
            msg.get("uuid")
                .and_then(|v| v.as_str())
                .map(|uuid| !uuid_set.contains(uuid))
                .unwrap_or(true)
        })
        .collect();

    parser::write_messages(&session_file_path, &filtered).await?;

    // 更新缓存
    cache.set_messages(&session_file_path, filtered.clone());

    Ok(filtered)
}

/// 单个内容块的编辑数据
///
/// 前端按块编辑时，每个被修改的内容块通过此结构体描述：
/// - `index`：内容块在 `message.content` 数组中的位置索引
/// - `text`：用户编辑后的新文本内容
///
/// 后端根据索引定位到原始内容块，仅更新其文本字段，
/// 保留内容块的 `type` 和其他所有字段不变。
#[derive(serde::Deserialize)]
pub struct BlockEdit {
    /// 内容块在 message.content 数组中的索引位置
    pub index: usize,
    /// 用户编辑后的新文本内容
    pub text: String,
}

/// 编辑指定消息的内容块
///
/// 根据消息 UUID 定位目标消息，按内容块索引逐个更新文本字段。
/// 每个内容块的 `type` 和其他元数据字段保持不变，仅修改文本：
/// - `text` 类型块：更新 `text` 字段
/// - `thinking` 类型块：更新 `thinking` 字段（若不存在则更新 `text` 字段）
/// - 字符串格式 content：整体替换为第一个编辑项的文本
///
/// # 参数
/// - `session_file_path` - 会话 JSONL 文件的绝对路径
/// - `message_uuid` - 要编辑的消息的 UUID
/// - `block_edits` - 按块索引的编辑列表，每项包含 (index, text)
/// - `cache` - Tauri managed state，内存缓存
///
/// # 返回值
/// 返回更新后的完整消息列表
///
/// # 错误
/// 文件读写失败时返回错误
#[tauri::command]
pub async fn edit_message_content(
    session_file_path: String,
    message_uuid: String,
    block_edits: Vec<BlockEdit>,
    cache: State<'_, AppCache>,
) -> Result<Vec<SessionMessage>, String> {
    let messages = parser::read_messages(&session_file_path).await?;

    let updated: Vec<SessionMessage> = messages
        .into_iter()
        .map(|mut msg| {
            // 检查是否为目标消息
            let is_target = msg
                .get("uuid")
                .and_then(|v| v.as_str())
                .map(|uuid| uuid == message_uuid)
                .unwrap_or(false);

            if !is_target {
                return msg;
            }

            // 检查是否有 message 字段
            if let Some(message) = msg.get_mut("message") {
                if let Some(content) = message.get_mut("content") {
                    match content {
                        // 字符串格式：使用第一个编辑项的文本直接替换
                        Value::String(_) => {
                            if let Some(first_edit) = block_edits.first() {
                                *content = Value::String(first_edit.text.clone());
                            }
                        }
                        // 数组格式：按索引逐个更新对应内容块的文本字段
                        Value::Array(arr) => {
                            for edit in &block_edits {
                                if edit.index >= arr.len() {
                                    continue;
                                }
                                if let Some(block) = arr[edit.index].as_object_mut() {
                                    let block_type = block
                                        .get("type")
                                        .and_then(|t| t.as_str())
                                        .unwrap_or("");

                                    match block_type {
                                        // text 块：更新 text 字段
                                        "text" => {
                                            block.insert(
                                                "text".to_string(),
                                                Value::String(edit.text.clone()),
                                            );
                                        }
                                        // thinking 块：优先更新 thinking 字段，
                                        // 若不存在则更新 text 字段
                                        "thinking" => {
                                            if block.contains_key("thinking") {
                                                block.insert(
                                                    "thinking".to_string(),
                                                    Value::String(edit.text.clone()),
                                                );
                                            } else {
                                                block.insert(
                                                    "text".to_string(),
                                                    Value::String(edit.text.clone()),
                                                );
                                            }
                                        }
                                        // 其他类型块（如 tool_use/tool_result）：
                                        // 尝试更新 text 字段（如果存在的话）
                                        _ => {
                                            if block.contains_key("text") {
                                                block.insert(
                                                    "text".to_string(),
                                                    Value::String(edit.text.clone()),
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }

            msg
        })
        .collect();

    parser::write_messages(&session_file_path, &updated).await?;

    // 更新缓存
    cache.set_messages(&session_file_path, updated.clone());

    Ok(updated)
}

/// 删除指定的会话文件
///
/// 从文件系统中永久移除会话的 JSONL 文件。此操作不可撤销。
/// 同时清除该会话的消息缓存和项目列表缓存。
///
/// # 参数
/// - `session_file_path` - 要删除的会话 JSONL 文件的绝对路径
/// - `cache` - Tauri managed state，内存缓存
///
/// # 错误
/// 文件删除失败时返回错误
#[tauri::command]
pub async fn delete_session(
    session_file_path: String,
    cache: State<'_, AppCache>,
) -> Result<(), String> {
    tokio::fs::remove_file(&session_file_path)
        .await
        .map_err(|e| format!("删除会话文件失败: {}", e))?;

    // 清除相关缓存
    cache.invalidate_messages(&session_file_path);
    cache.invalidate_projects();

    Ok(())
}
