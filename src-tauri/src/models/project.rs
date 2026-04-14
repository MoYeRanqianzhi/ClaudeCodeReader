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
/// ## 字段来源
/// - **基础字段**（id, timestamp, file_path）：来自文件系统 stat 元数据
/// - **轻量读取字段**（summary, first_prompt, git_branch, cwd, tag 等）：
///   来自 scanner 的 head+tail 轻量读取策略，读取 JSONL 文件的前 64KB 和后 64KB
/// - **message_count**：扫描时设为 0，读取完整会话内容后更新
///
/// ## 标题优先级（对应 Claude Code 源码 `parseSessionInfoFromLite`）
/// `name` 字段按以下优先级填充：
/// 1. `custom-title` 条目中的 `customTitle`（用户手动设置的标题）
/// 2. `ai-title` 条目中的 `aiTitle`（AI 自动生成的标题）
/// 3. `last-prompt` 条目中的 `lastPrompt`（最后一条用户输入）
///
/// 如果以上都不存在，前端可回退使用 `summary` 或 `first_prompt` 作为显示文本。
///
/// 对应前端 TypeScript 接口：
/// ```typescript
/// interface Session {
///   id: string;
///   name?: string;
///   timestamp: Date;
///   messageCount: number;
///   filePath: string;
///   summary?: string;
///   firstPrompt?: string;
///   gitBranch?: string;
///   cwd?: string;
///   tag?: string;
///   createdAt?: string;
///   fileSize?: number;
///   isSidechain: boolean;
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
    /// 优先级：customTitle > aiTitle > lastPrompt
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

    // ---- 以下为 v0.4.0 新增的轻量读取字段 ----
    // 来源：scanner 的 head+tail 策略从 JSONL 文件中提取的元数据

    /// 会话摘要：从 JSONL 尾部的 `summary` 类型条目中提取
    /// 对应源码 `SessionInfo.summary`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,

    /// 首条用户消息：从 JSONL 头部第一条 `type: "user"` 消息中提取的文本
    /// 当没有 customTitle/aiTitle/lastPrompt 时，可作为会话标题的回退显示
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_prompt: Option<String>,

    /// Git 分支名：从 JSONL 头部或尾部消息的 `gitBranch` 字段中提取
    /// 尾部的值优先（反映会话结束时的分支状态）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,

    /// 工作目录：从 JSONL 头部消息的 `cwd` 字段中提取
    /// 表示会话启动时 Claude Code 的工作目录
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,

    /// 会话标签：从 JSONL 尾部的 `tag` 类型条目中提取
    /// 用户可通过 Claude Code CLI 为会话添加标签
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,

    /// 创建时间：从 JSONL 头部第一条消息的 `timestamp` 字段中提取（ISO 8601 格式）
    /// 与 `timestamp`（文件修改时间）不同，`created_at` 反映会话的首次创建时间
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,

    /// 文件大小：JSONL 文件的字节数
    /// 用于前端显示文件大小信息，帮助用户了解会话规模
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,

    /// 是否为侧链会话：从 JSONL 头部第一条消息的 `isSidechain` 字段中判断
    /// 侧链会话来自子 agent 或分支对话，在列表中通常需要特殊标记或过滤
    /// 默认为 false（向后兼容：旧数据中无此信息时视为主链会话）
    #[serde(default)]
    pub is_sidechain: bool,
}
