//! # 项目回溯数据模型
//!
//! 定义「项目回溯」功能的所有数据结构。
//! 回溯功能通过解析项目下所有会话 JSONL 文件中的文件操作（Write/Edit/Bash），
//! 重建项目在任意时间点的文件状态。
//!
//! ## 核心概念
//! - **FileOperation**：对文件的一次原子操作（写入、编辑、移动、复制、删除、创建目录）
//! - **FileOpRecord**：操作记录 = FileOperation + 时间戳 + 溯源信息（内部使用，包含完整内容）
//! - **FileOpSummary**：操作摘要 = 操作类型 + 路径 + 时间戳（传给前端，不含文件内容）
//! - **RetrospectTimeline**：时间轴 = 所有操作摘要的有序列表
//! - **FileTreeNode**：文件树节点 = 嵌套的目录/文件结构（用于前端渲染）

use serde::{Deserialize, Serialize};

/// 文件操作类型枚举
///
/// 表示 Claude Code 会话中对文件的不同操作方式。
/// 这些操作从 JSONL 消息的 tool_use 块中提取。
///
/// # 序列化格式
/// 使用 `tag = "type"` 内部标签策略，序列化为：
/// ```json
/// { "type": "write", "filePath": "...", "content": "..." }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FileOperation {
    /// Write 工具：创建或完全覆写文件
    ///
    /// 对应 Claude Code 的 Write 工具调用，将完整内容写入指定路径。
    /// 如果文件已存在则覆盖，不存在则创建。
    Write {
        /// 目标文件路径（相对于项目根目录）
        file_path: String,
        /// 文件完整内容
        content: String,
    },
    /// Edit 工具：精确字符串替换（查找并替换）
    ///
    /// 对应 Claude Code 的 Edit 工具调用，在指定文件中查找 old_string 并替换为 new_string。
    /// 支持单次替换（默认）和全局替换（replace_all = true）。
    Edit {
        /// 目标文件路径（相对于项目根目录）
        file_path: String,
        /// 要被替换的原始字符串
        old_string: String,
        /// 替换后的新字符串
        new_string: String,
        /// 是否替换所有匹配项（false = 仅替换第一个）
        replace_all: bool,
    },
    /// Bash 移动文件操作（mv）
    ///
    /// 从 Bash 命令 `mv source dest` 中解析得到。
    /// 语义：将 from 路径的文件移动到 to 路径，from 路径标记为已删除。
    BashMove {
        /// 源文件路径（相对于项目根目录）
        from: String,
        /// 目标文件路径（相对于项目根目录）
        to: String,
    },
    /// Bash 复制文件操作（cp）
    ///
    /// 从 Bash 命令 `cp source dest` 中解析得到。
    /// 语义：将 from 路径的文件复制到 to 路径，from 保持不变。
    BashCopy {
        /// 源文件路径（相对于项目根目录）
        from: String,
        /// 目标文件路径（相对于项目根目录）
        to: String,
    },
    /// Bash 删除文件操作（rm）
    ///
    /// 从 Bash 命令 `rm [-rf] path` 中解析得到。
    /// 语义：标记该路径为已删除。
    BashDelete {
        /// 被删除的文件路径（相对于项目根目录）
        file_path: String,
    },
    /// Bash 创建目录操作（mkdir）
    ///
    /// 从 Bash 命令 `mkdir [-p] path` 中解析得到。
    /// 语义：创建目录（在虚拟文件系统中无实际效果，仅记录）。
    BashMkdir {
        /// 新建目录的路径（相对于项目根目录）
        dir_path: String,
    },
}

/// 文件操作记录（内部使用）
///
/// 时间轴上的一个刻度点，包含完整的操作信息和溯源元数据。
/// 此结构体保留了文件内容等详细信息，仅在后端使用，不直接传给前端。
///
/// # 字段说明
/// - `index`：全局唯一递增序号，用于在时间轴上定位
/// - `timestamp`：ISO 8601 格式，用于时间排序和前端显示
/// - `operation`：具体的文件操作内容
/// - `session_file`：溯源到具体的会话文件
/// - `source_uuid`：溯源到具体的消息
///
/// 注意：部分字段（index, timestamp, session_file, source_uuid）当前仅在构建
/// FileOpSummary 时使用，保留在此结构体中供未来扩展功能（如操作详情查看）使用。
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct FileOpRecord {
    /// 全局递增序号（跨会话唯一，从 0 开始）
    pub index: usize,
    /// ISO 8601 时间戳（来自 JSONL 消息的 timestamp 字段）
    pub timestamp: String,
    /// 文件操作详情（包含完整的文件内容和路径信息）
    pub operation: FileOperation,
    /// 来源会话文件名（不含路径，如 "abc-def.jsonl"）
    pub session_file: String,
    /// 来源消息的 UUID（用于在原始 JSONL 中精确定位来源）
    pub source_uuid: String,
}

/// 文件操作摘要（传给前端的轻量版本）
///
/// 不包含文件内容等大体积数据，仅包含前端渲染时间轴所需的元信息。
/// 前端根据 index 请求具体的文件树或文件内容。
///
/// # 序列化
/// 使用 camelCase 命名，与前端 TypeScript 风格保持一致。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOpSummary {
    /// 全局序号（与 FileOpRecord.index 一一对应）
    pub index: usize,
    /// ISO 8601 时间戳（如 "2024-01-15T10:30:00Z"）
    pub timestamp: String,
    /// 操作类型标识字符串
    ///
    /// 可选值: "write" | "edit" | "bash_move" | "bash_copy" | "bash_delete" | "bash_mkdir"
    pub op_type: String,
    /// 被操作的主文件路径（相对于项目根目录，使用 `/` 分隔符）
    pub file_path: String,
    /// 来源会话文件名（如 "abc-def.jsonl"）
    pub session_file: String,
}

/// 回溯时间轴（初始化时返回给前端）
///
/// 包含所有操作的摘要信息，前端用这些数据渲染时间轴滑块和操作列表。
/// 操作按时间戳排序，index 从 0 递增。
///
/// # 使用流程
/// 1. 前端调用 `retrospect_init`，获得此结构体
/// 2. 前端渲染时间轴（0 到 total_operations - 1）
/// 3. 用户拖动滑块到某个 index，前端调用 `retrospect_file_tree(index)` 获取文件树
/// 4. 用户点击文件，前端调用 `retrospect_file_content(index, path)` 获取内容
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrospectTimeline {
    /// 操作总数 = 时间轴刻度总数
    pub total_operations: usize,
    /// 每个操作的摘要信息（按时间排序）
    pub operations: Vec<FileOpSummary>,
}

/// 文件树节点（传给前端渲染文件树）
///
/// 表示虚拟文件系统中的一个文件或目录。
/// 目录节点包含子节点列表，文件节点的 children 为 None。
///
/// # 排序规则
/// - 目录在前，文件在后
/// - 同类型内按名称字母序排列
///
/// # 序列化
/// - 使用 camelCase 命名
/// - `children` 为 None 时不序列化（减少 JSON 体积）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    /// 节点名称（文件名或目录名，如 "App.tsx" 或 "src"）
    pub name: String,
    /// 相对路径（从项目根目录开始，使用 `/` 分隔符，如 "src/App.tsx"）
    pub path: String,
    /// 节点类型："file" 表示文件，"directory" 表示目录
    #[serde(rename = "type")]
    pub node_type: String,
    /// 子节点列表（仅目录有，文件为 None）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileTreeNode>>,
}
