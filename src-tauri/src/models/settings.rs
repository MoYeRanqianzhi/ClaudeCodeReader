//! # 设置和配置数据模型
//!
//! 定义了 Claude Code 设置（ClaudeSettings）和环境配置管理
//! （EnvProfile、EnvSwitcherConfig）的 Rust 结构体。
//!
//! 对应前端 TypeScript 中的 `ClaudeSettings`、`EnvProfile`、`EnvSwitcherConfig` 接口。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Claude Code 设置数据结构
///
/// 对应 `~/.claude/settings.json` 文件内容。
/// Claude Code CLI 在启动时读取此文件以获取用户偏好设置。
///
/// 设计决策：
/// - 使用 `serde_json::Value` 表示整个设置对象，因为 Claude Code 的 settings.json
///   可能包含各种不同版本的字段，使用 Value 可以完美保留所有字段，
///   避免未知字段在读取后保存时被丢弃。
///
/// 对应前端 TypeScript 接口：
/// ```typescript
/// interface ClaudeSettings {
///   env?: Record<string, string>;
///   model?: string;
///   permissions?: { allow?: string[]; deny?: string[] };
///   apiKey?: string;
/// }
/// ```
pub type ClaudeSettings = Value;

/// 环境配置组数据结构
///
/// 表示一组命名的环境变量集合，用于在不同工作场景之间快速切换环境配置。
/// 存储在 CCR 自身的配置目录中（`~/.mo/CCR/env-profiles.json`）。
///
/// 对应前端 TypeScript 接口：
/// ```typescript
/// interface EnvProfile {
///   id: string;
///   name: string;
///   env: Record<string, string>;
///   createdAt: string;
///   updatedAt: string;
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvProfile {
    /// 唯一标识符：由时间戳和随机字符串组合生成
    pub id: String,

    /// 配置名称：用户自定义的可读名称（如 "开发环境"）
    pub name: String,

    /// 环境变量集合：该配置组包含的所有环境变量键值对
    pub env: serde_json::Map<String, Value>,

    /// 创建时间：ISO 8601 格式的时间戳
    pub created_at: String,

    /// 更新时间：ISO 8601 格式的时间戳
    pub updated_at: String,
}

/// 环境切换器配置数据结构
///
/// 管理所有环境配置组的顶层容器，存储在 `~/.mo/CCR/env-profiles.json` 文件中。
///
/// 对应前端 TypeScript 接口：
/// ```typescript
/// interface EnvSwitcherConfig {
///   profiles: EnvProfile[];
///   activeProfileId: string | null;
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvSwitcherConfig {
    /// 所有已保存的环境配置组列表
    pub profiles: Vec<EnvProfile>,

    /// 当前激活的配置组 ID：为 `null`（None）表示没有激活任何配置组
    pub active_profile_id: Option<String>,
}
