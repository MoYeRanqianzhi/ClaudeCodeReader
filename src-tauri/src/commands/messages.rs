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

/// 编辑指定消息的文本内容
///
/// 根据消息 UUID 定位目标消息，更新其文本内容并保存。
/// 此函数会智能保持原始 `message.content` 字段的格式（字符串 vs 数组），
/// 以确保编辑后的消息仍然能被 Claude Code 正确解析。
///
/// ## content 格式保持逻辑
/// - 如果原始 content 是字符串格式：直接用新文本替换
/// - 如果原始 content 是 `MessageContent[]` 数组格式：
///   - 找到所有 `type='text'` 的内容块，将其 `text` 字段更新为新内容
///   - 如果数组中没有 text 类型的内容块，则创建一个新的 text 块
///
/// # 参数
/// - `session_file_path` - 会话 JSONL 文件的绝对路径
/// - `message_uuid` - 要编辑的消息的 UUID
/// - `new_content` - 新的文本内容
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
    new_content: String,
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
                        // 字符串格式：直接替换为新文本
                        Value::String(_) => {
                            *content = Value::String(new_content.clone());
                        }
                        // 数组格式：更新所有 text 类型内容块的 text 字段
                        Value::Array(arr) => {
                            let has_text = arr.iter().any(|item| {
                                item.get("type")
                                    .and_then(|t| t.as_str())
                                    .map(|t| t == "text")
                                    .unwrap_or(false)
                            });

                            if has_text {
                                // 更新所有 text 类型内容块
                                for item in arr.iter_mut() {
                                    if item
                                        .get("type")
                                        .and_then(|t| t.as_str())
                                        .map(|t| t == "text")
                                        .unwrap_or(false)
                                    {
                                        if let Some(obj) = item.as_object_mut() {
                                            obj.insert(
                                                "text".to_string(),
                                                Value::String(new_content.clone()),
                                            );
                                        }
                                    }
                                }
                            } else {
                                // 数组中没有 text 块时，创建一个新的
                                *content = Value::Array(vec![serde_json::json!({
                                    "type": "text",
                                    "text": new_content.clone()
                                })]);
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
