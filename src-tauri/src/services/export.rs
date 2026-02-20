//! # 会话导出服务
//!
//! 将原始 `Vec<serde_json::Value>` 消息导出为 Markdown 或 JSON 格式的字符串。
//! 从前端 `claudeData.ts` 的 `exportAsMarkdown`/`exportAsJson` 逻辑平移而来。
//!
//! ## 导出策略
//! - **Markdown**：仅导出 user 和 assistant 类型的消息，提取文本内容
//! - **JSON**：保留所有消息的原始完整结构，美化输出

use serde_json::Value;

/// 将消息列表导出为 Markdown 格式字符串
///
/// 生成结构化的 Markdown 文档，包含会话标题和每条消息的角色、时间戳和内容。
/// 仅导出 user 和 assistant 类型的消息，忽略其他类型（如 file-history-snapshot）。
///
/// # 参数
/// - `messages` - 原始消息 Value 列表
/// - `session_name` - 会话名称，用作文档标题
///
/// # 返回值
/// Markdown 格式的字符串
pub fn to_markdown(messages: &[Value], session_name: &str) -> String {
    let mut lines: Vec<String> = Vec::new();

    // 文档标题
    lines.push(format!("# {}", session_name));
    lines.push(String::new());

    // 导出时间：使用 SystemTime 计算 UTC 时间，避免依赖 chrono
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // 简单格式化为 Unix 时间戳（前端可进一步格式化）
    lines.push(format!("导出时间: (UTC epoch: {})", now));
    lines.push(String::new());
    lines.push("---".into());
    lines.push(String::new());

    for msg in messages {
        let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");
        // 仅导出用户和助手消息
        if msg_type != "user" && msg_type != "assistant" {
            continue;
        }

        let role = if msg_type == "user" { "用户" } else { "助手" };
        let time = msg
            .get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or("未知时间");

        lines.push(format!("## {} ({})", role, time));
        lines.push(String::new());

        // 提取消息文本内容
        let text = extract_message_text(msg);
        if !text.is_empty() {
            lines.push(text);
        }
        lines.push(String::new());
        lines.push("---".into());
        lines.push(String::new());
    }

    lines.join("\n")
}

/// 将消息列表导出为 JSON 格式字符串
///
/// 直接将原始消息数组序列化为美化的 JSON 字符串（2 空格缩进），保留所有字段。
///
/// # 参数
/// - `messages` - 原始消息 Value 列表
///
/// # 返回值
/// 美化后的 JSON 字符串
pub fn to_json(messages: &[Value]) -> String {
    serde_json::to_string_pretty(messages).unwrap_or_else(|_| "[]".to_string())
}

/// 从消息 Value 中提取纯文本内容
///
/// 处理 `message.content` 的两种格式：
/// - 字符串：直接返回
/// - 数组：提取所有 `type === "text"` 块的 text 字段，用换行符拼接
///
/// # 参数
/// - `msg` - 原始消息 Value
///
/// # 返回值
/// 消息的纯文本内容
fn extract_message_text(msg: &Value) -> String {
    let content = msg.get("message").and_then(|m| m.get("content"));

    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(arr)) => {
            let texts: Vec<&str> = arr
                .iter()
                .filter(|b| b.get("type").and_then(|v| v.as_str()) == Some("text"))
                .filter_map(|b| b.get("text").and_then(|v| v.as_str()))
                .collect();
            texts.join("\n")
        }
        _ => String::new(),
    }
}
