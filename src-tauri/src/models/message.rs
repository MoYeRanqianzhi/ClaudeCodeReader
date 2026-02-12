//! # 消息数据模型
//!
//! 定义了会话消息（SessionMessage）和内容块（MessageContent）等 Rust 结构体，
//! 对应前端 TypeScript 中的 `SessionMessage`、`MessageContent`、`ToolUseResult` 等接口。
//!
//! 这些结构体采用 `serde_json::Value` 处理 Claude Code JSONL 文件中的动态字段，
//! 避免因 Claude Code 版本升级添加新字段而导致反序列化失败。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 会话消息数据结构
///
/// 对应 Claude Code 会话 JSONL 文件中的每一行记录。
/// 这是整个应用最核心的数据结构，表示用户与 AI 之间的一次交互。
///
/// 设计决策：
/// - 使用 `serde_json::Value` 而非强类型处理整条消息，
///   因为 Claude Code 的 JSONL 格式可能在不同版本间有差异，
///   使用 Value 可以完美保留原始数据，避免序列化/反序列化过程中丢失未知字段。
/// - 在需要读取特定字段时（如 uuid、type），使用 Value 的下标访问方法。
///
/// 对应前端 TypeScript 接口：`SessionMessage`
///
/// 注意：前端传入的 `SessionMessage` 包含 type、uuid、message、timestamp 等字段，
/// Rust 端将整条消息作为 `serde_json::Value` 处理，保留所有原始字段。
pub type SessionMessage = Value;

/// 消息内容块数据结构
///
/// 表示结构化消息中的单个内容块。一条消息可以包含多个不同类型的内容块，
/// 例如文本、工具调用、工具结果、图片、思考过程等。
///
/// 对应前端 TypeScript 接口：`MessageContent`
///
/// 同样使用 `serde_json::Value` 以保留所有字段。
#[allow(dead_code)]
pub type MessageContent = Value;

/// 历史记录条目
///
/// 对应 `~/.claude/history.jsonl` 文件中的每一行记录。
/// Claude Code 会将用户的每次交互输入记录到此文件中。
///
/// 对应前端 TypeScript 接口：
/// ```typescript
/// interface HistoryEntry {
///   display: string;
///   pastedContents: Record<string, PastedContent>;
///   timestamp: number;
///   project: string;
///   sessionId: string;
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    /// 显示文本：用户输入的命令或提示词内容
    pub display: String,

    /// 粘贴内容集合：用户在输入中粘贴的文本或图片内容，以 ID 为键
    #[serde(default)]
    pub pasted_contents: serde_json::Map<String, Value>,

    /// 时间戳：Unix 毫秒时间戳
    pub timestamp: u64,

    /// 项目路径：该历史记录关联的项目目录路径
    pub project: String,

    /// 会话 ID：该历史记录所属的会话标识符
    pub session_id: String,
}
