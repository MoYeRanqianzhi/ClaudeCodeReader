//! # 显示层数据模型
//!
//! 定义了前端渲染所需的独立数据结构，与原始 `serde_json::Value` 完全解耦。
//!
//! ## 设计原则
//! - **零注入**：绝不向原始 `serde_json::Value` 添加任何字段。原始数据只用于文件写入。
//! - **完全分离**：`DisplayMessage` 是独立 Rust struct，与原始 Value 无引用关系。
//! - **前端纯渲染**：前端仅做 `displayType` 集合筛选 + 搜索结果集合交叉，零文本处理。
//!
//! ## 数据流
//! ```text
//! JSONL → parser::read_messages → Vec<Value>
//!      → transformer::transform_session → (TransformedSession, Vec<String> 搜索文本)
//!      → 缓存 SessionCacheEntry { transformed, search_texts, mtime }
//!      → IPC 返回 TransformedSession（search_texts 不传前端）
//!      → 前端直接渲染
//! ```

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;

/// 单条显示消息（独立 struct，与 serde_json::Value 无关联）
///
/// 由 `transformer::transform_session` 生成，是原始 `SessionMessage`（`serde_json::Value`）
/// 经过分类、拆分和重组后的显示层数据结构。
///
/// ## 核心变化
/// - 将 user 消息中的 `tool_result` 内容块拆分为独立的 DisplayMessage
/// - 系统消息（isMeta、caller 等）单独分类，附加 `system_label`
/// - 所有字段从原始 Value 中提取，不持有对原始数据的引用
///
/// ## 字段说明
/// - `display_type`：决定前端渲染样式（"user" | "assistant" | "tool_result" | "compact_summary" | "system"）
/// - `block_index_map`：`content[i]` 对应原始消息 `content[block_index_map[i]]`，编辑时用于精确回写
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMessage {
    /// 原始消息的 UUID，用于编辑/删除操作时映射回原始数据
    pub source_uuid: String,
    /// 显示用唯一标识符，用作 React key：
    /// - 原始消息：直接使用 uuid
    /// - 拆分出的工具结果：使用 "{uuid}-tool-{N}" 格式（N 为序号）
    pub display_id: String,
    /// 显示类型：决定消息气泡的视觉样式
    /// "user" | "assistant" | "tool_result" | "compact_summary" | "system"
    pub display_type: String,
    /// ISO 8601 时间戳，继承自原始消息
    pub timestamp: String,
    /// 该 DisplayMessage 对应的内容块列表（从原始 content 中提取/拆分）
    pub content: Vec<Value>,
    /// 是否可编辑
    pub editable: bool,
    /// 块索引映射：`content[i]` 在原始消息 `content` 数组中的索引
    /// 编辑操作时通过此映射将修改精确回写到原始消息的正确位置
    pub block_index_map: Vec<usize>,

    // ---- assistant 专属字段 ----
    /// AI 模型标识符（仅 assistant 消息）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Token 使用量统计（仅 assistant 消息）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Value>,
    /// 子 agent 执行结果（仅包含 toolUseResult 的消息）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_result: Option<Value>,
    /// 待办事项列表（仅包含 todos 的消息）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub todos: Option<Vec<Value>>,

    // ---- system 专属字段 ----
    /// 系统消息子类型标签：'技能' | '计划' | '系统'
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_label: Option<String>,
    /// 计划消息引用的源会话 JSONL 文件路径
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_source_path: Option<String>,

    // ---- 通用元数据 ----
    /// 当前工作目录（该消息发送时 Claude Code 的工作目录路径）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

/// tool_use 块摘要信息
///
/// 供 tool_result 渲染时查询关联的工具名称和参数。
/// 前端通过 `toolUseMap[tool_use_id]` 获取对应工具调用的名称和输入。
#[derive(Serialize, Clone, Debug)]
pub struct ToolUseInfo {
    /// 工具名称，如 "Read"、"Bash"、"Edit"
    pub name: String,
    /// 工具输入参数（保留原始 JSON 结构）
    pub input: Value,
}

/// Token 统计汇总
///
/// 累加整个会话中所有 assistant 消息的 token 使用量，
/// 供前端在会话头部一次性展示总计数据。
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TokenStats {
    /// 输入 token 总数
    pub input_tokens: u64,
    /// 输出 token 总数
    pub output_tokens: u64,
    /// 缓存创建 token 总数
    pub cache_creation_input_tokens: u64,
    /// 缓存读取 token 总数
    pub cache_read_input_tokens: u64,
}

impl TokenStats {
    /// 累加一条消息的 usage 数据到统计汇总中
    ///
    /// # 参数
    /// - `usage` - 单条消息的 usage Value（可能为 None）
    pub fn accumulate(&mut self, usage: &Option<Value>) {
        if let Some(u) = usage {
            self.input_tokens += u
                .get("input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            self.output_tokens += u
                .get("output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            self.cache_creation_input_tokens += u
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            self.cache_read_input_tokens += u
                .get("cache_read_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
        }
    }
}

/// IPC 返回的完整转换结果（前端唯一数据源）
///
/// 包含了前端渲染所需的所有数据：
/// - `display_messages`：倒序排列（最新在前），配合 CSS `column-reverse` 实现优先渲染最新消息
/// - `tool_use_map`：tool_use_id → ToolUseInfo 映射，供工具结果渲染器查询工具名称
/// - `token_stats`：整个会话的 Token 使用量汇总
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TransformedSession {
    /// 倒序排列的显示消息列表（最新在前），配合 CSS `column-reverse`
    pub display_messages: Vec<DisplayMessage>,
    /// tool_use_id → ToolUseInfo 映射
    pub tool_use_map: HashMap<String, ToolUseInfo>,
    /// Token 统计汇总
    pub token_stats: TokenStats,
}
