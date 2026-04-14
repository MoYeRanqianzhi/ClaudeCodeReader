//! # Skill 数据模型
//!
//! 定义了 Claude Code Skills 系统的 Rust 数据结构。
//! Skills 是 Claude Code 的可扩展命令系统，用户可以通过 `/skill-name` 调用。
//!
//! ## Skills 存储结构
//! Skills 以目录形式存储，每个 skill 是一个包含 `SKILL.md` 的目录：
//! ```text
//! ~/.claude/skills/           # 用户级 skills
//!   my-skill/
//!     SKILL.md                # skill 定义文件（YAML frontmatter + Markdown 内容）
//! <project>/.claude/skills/   # 项目级 skills
//!   project-skill/
//!     SKILL.md
//! ```
//!
//! ## SKILL.md 格式
//! ```markdown
//! ---
//! description: Skill 的描述
//! allowed-tools: Bash, Read, Write
//! model: sonnet
//! user-invocable: true
//! when_to_use: 当需要做某事时使用
//! context: inline
//! ---
//!
//! Skill 的 Markdown 内容（prompt）...
//! ```
//!
//! ## 与 Claude Code 源码的对应关系
//! - `SkillInfo` 对应 `src/types/command.ts` 中的 `CommandBase + PromptCommand`
//! - `SkillSource` 对应 `loadSkillsDir.ts` 中的 `SettingSource`
//! - `SkillFrontmatter` 对应 `frontmatterParser.ts` 中的 `FrontmatterData`
//! - 扫描逻辑对应 `loadSkillsDir.ts` 中的 `getSkillDirCommands`

use serde::{Deserialize, Serialize};

/// Skill 的来源类型
///
/// 标识 skill 从哪个目录层级加载，与 Claude Code 源码中的
/// `SettingSource` 和 `LoadedFrom` 类型对应。
///
/// 优先级（高到低）：managed > user > project > legacy_commands
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SkillSource {
    /// 用户级：`~/.claude/skills/`
    User,
    /// 项目级：`<project>/.claude/skills/`
    Project,
    /// 旧版命令目录：`~/.claude/commands/` 或 `<project>/.claude/commands/`
    LegacyCommands,
    /// 策略管理级（企业部署）：`<managed_path>/.claude/skills/`
    Managed,
    /// 内置 bundled skills（编译到 CLI 中的）
    Bundled,
}

/// Skill 的执行上下文
///
/// 对应 Claude Code 源码中 `PromptCommand.context` 字段。
/// - `inline`：skill 内容展开到当前对话中（默认）
/// - `fork`：skill 在独立的子 agent 中运行，有独立的 token 预算
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // 前端通过 serde 序列化使用，Rust 侧暂未直接引用
pub enum SkillContext {
    /// 内联执行：skill 内容直接展开到当前对话
    Inline,
    /// 分叉执行：skill 在子 agent 中独立运行
    Fork,
}

/// Skill 的 frontmatter 元数据
///
/// 从 SKILL.md 文件的 YAML frontmatter 中解析出的结构化元数据。
/// 对应 Claude Code 源码 `frontmatterParser.ts` 中的 `FrontmatterData`。
///
/// 注意：所有字段均为 Option，因为 frontmatter 中的任何字段都可能缺失。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillFrontmatter {
    /// Skill 的显示名称（可选，默认使用目录名）
    pub name: Option<String>,

    /// Skill 的描述文本
    pub description: Option<String>,

    /// 允许使用的工具列表（逗号分隔字符串或数组）
    #[serde(rename = "allowed-tools")]
    pub allowed_tools: Option<serde_json::Value>,

    /// 使用场景说明：告诉模型何时应该使用此 skill
    pub when_to_use: Option<String>,

    /// 模型覆盖：指定此 skill 使用的模型（如 "haiku", "sonnet", "opus"）
    pub model: Option<String>,

    /// 是否允许用户通过 /skill-name 直接调用
    #[serde(rename = "user-invocable")]
    pub user_invocable: Option<serde_json::Value>,

    /// 是否禁止模型自动调用此 skill
    #[serde(rename = "disable-model-invocation")]
    pub disable_model_invocation: Option<serde_json::Value>,

    /// 执行上下文：inline（默认）或 fork
    pub context: Option<String>,

    /// fork 模式下使用的 agent 类型
    pub agent: Option<String>,

    /// 参数提示文本
    #[serde(rename = "argument-hint")]
    pub argument_hint: Option<String>,

    /// 版本号
    pub version: Option<String>,

    /// 路径过滤模式（glob 模式列表）
    pub paths: Option<serde_json::Value>,

    /// Shell 类型：bash 或 powershell
    pub shell: Option<String>,

    /// effort 级别
    pub effort: Option<String>,
}

/// Skill 信息摘要
///
/// 用于前端列表展示的 skill 信息。不包含完整的 markdown 内容，
/// 仅包含元数据和路径信息，以减少 IPC 传输量。
///
/// 对应前端 TypeScript 接口：
/// ```typescript
/// interface SkillInfo {
///   name: string;
///   displayName?: string;
///   description: string;
///   source: SkillSource;
///   sourcePath: string;
///   userInvocable: boolean;
///   model?: string;
///   context?: string;
///   allowedTools: string[];
///   whenToUse?: string;
///   version?: string;
///   argumentHint?: string;
///   paths?: string[];
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    /// Skill 名称（目录名，用作调用标识符）
    pub name: String,

    /// 显示名称（frontmatter 中的 name 字段，可能与目录名不同）
    pub display_name: Option<String>,

    /// 描述文本（来自 frontmatter 或 markdown 首段）
    pub description: String,

    /// 来源类型
    pub source: SkillSource,

    /// 来源文件的完整路径（SKILL.md 的绝对路径）
    pub source_path: String,

    /// 是否允许用户直接调用
    pub user_invocable: bool,

    /// 模型覆盖
    pub model: Option<String>,

    /// 执行上下文
    pub context: Option<String>,

    /// 允许的工具列表
    pub allowed_tools: Vec<String>,

    /// 使用场景说明
    pub when_to_use: Option<String>,

    /// 版本号
    pub version: Option<String>,

    /// 参数提示
    pub argument_hint: Option<String>,

    /// 路径过滤模式
    pub paths: Option<Vec<String>>,
}

/// Skill 详情
///
/// 包含完整 markdown 内容的 skill 信息，用于前端查看 skill 全文。
/// 仅在用户点击查看详情时按需加载。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDetail {
    /// 基本信息（复用 SkillInfo）
    #[serde(flatten)]
    pub info: SkillInfo,

    /// SKILL.md 的完整原始内容（包含 frontmatter）
    pub raw_content: String,

    /// 去除 frontmatter 后的纯 markdown 内容（skill 的 prompt 部分）
    pub markdown_content: String,
}
