//! # 项目和会话数据模型
//!
//! 定义了项目（Project）和会话（Session）的 Rust 结构体，
//! 对应前端 TypeScript 中的 `Project` 和 `Session` 接口。
//!
//! 这些结构体通过 `serde` 的 Serialize/Deserialize 特征实现：
//! - Tauri IPC 序列化（Rust → JS）：通过 `Serialize` 将数据传输到前端
//! - 文件系统读写：部分用于 JSON 文件的读写

use serde::{Deserialize, Serialize};

/// 项目数据结构
///
/// 表示一个 Claude Code 项目，对应 `~/.claude/projects/` 下的一个子目录。
/// 每个项目包含多个会话（Session），按最新会话时间排序。
///
/// 对应前端 TypeScript 接口：
/// ```typescript
/// interface Project {
///   name: string;
///   path: string;
///   sessions: Session[];
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    /// 项目名称：编码后的目录名（如 "G--ClaudeProjects-Test"）
    /// 同时也是 `~/.claude/projects/` 下的子目录名
    pub name: String,

    /// 项目路径：解码还原后的完整文件系统路径（如 "G:\ClaudeProjects\Test"）
    pub path: String,

    /// 会话列表：该项目下的所有聊天会话，按时间戳降序排列
    pub sessions: Vec<Session>,
}

/// 会话数据结构
///
/// 表示一次独立的 Claude Code 对话会话，对应一个 `.jsonl` 文件。
/// 前端通过 `filePath` 加载会话的完整消息内容。
///
/// 对应前端 TypeScript 接口：
/// ```typescript
/// interface Session {
///   id: string;
///   name?: string;
///   timestamp: Date;
///   messageCount: number;
///   filePath: string;
/// }
/// ```
///
/// 注意：前端的 `timestamp` 是 `Date` 类型，在 Tauri IPC 传输时
/// 序列化为 ISO 8601 字符串，前端接收后需要转换为 `Date` 对象。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// 会话 ID：从 JSONL 文件名中提取（去掉 `.jsonl` 扩展名），通常是 UUID 格式
    pub id: String,

    /// 会话名称：用户自定义的显示名称（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// 会话时间戳：基于 JSONL 文件的最后修改时间（ISO 8601 格式字符串）
    /// 前端接收后需要通过 `new Date(timestamp)` 转换为 Date 对象
    pub timestamp: String,

    /// 消息数量：该会话中包含的消息条数
    /// 扫描时设为 0，读取会话内容后更新
    pub message_count: u32,

    /// 文件路径：JSONL 文件的完整绝对路径，用于后续读取会话内容
    pub file_path: String,
}
