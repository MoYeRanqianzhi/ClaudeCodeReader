//! # Plugin 数据模型
//!
//! 定义了 Claude Code Plugins 系统的 Rust 数据结构。
//! Plugins 是 Claude Code 的扩展系统，通过 marketplace 机制安装和管理。
//!
//! ## Plugins 存储结构
//! ```text
//! ~/.claude/
//!   settings.json                     # enabledPlugins 字段记录启用/禁用状态
//!   plugins/                          # 插件根目录
//!     installed_plugins.json          # 安装元数据（V2 格式）
//!     known_marketplaces.json         # 已注册的 marketplace 列表
//!     cache/                          # 插件安装缓存
//!       <marketplace>/               # marketplace 名称
//!         <plugin>/                   # 插件名称
//!           <version>/               # 版本号
//!             .claude-plugin/        # 插件清单目录
//!               plugin.json          # 插件清单文件
//!               marketplace.json     # marketplace 信息
//!             commands/              # 自定义斜杠命令
//!             agents/                # 自定义 agents
//!             hooks/                 # 钩子配置
//!             skills/                # 自定义 skills
//! ```
//!
//! ## 与 Claude Code 源码的对应关系
//! - `PluginInfo` 对应 `src/utils/plugins/schemas.ts` 中的 `PluginManifest` + `InstalledPlugin`
//! - `PluginScope` 对应 `schemas.ts` 中的 `PluginScope`
//! - `PluginInstallation` 对应 `schemas.ts` 中的 `PluginInstallationEntry`
//! - `KnownMarketplace` 对应 `schemas.ts` 中的 `KnownMarketplace`
//! - 启用/禁用状态存储在 `settings.json` 的 `enabledPlugins` 字段

use serde::{Deserialize, Serialize};

/// 插件安装作用域
///
/// 插件可以在不同层级安装：
/// - `managed`：企业/系统级（只读，平台特定路径）
/// - `user`：用户全局（`~/.claude/settings.json`）
/// - `project`：项目级共享（`$project/.claude/settings.json`）
/// - `local`：项目级私有（`$project/.claude/settings.local.json`）
///
/// 对应 Claude Code 源码 `schemas.ts` 中的 `PluginScope`
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PluginScope {
    /// 企业/系统级管理（只读）
    Managed,
    /// 用户全局安装
    User,
    /// 项目级共享安装
    Project,
    /// 项目级私有安装
    Local,
}

/// 插件来源类型
///
/// 描述插件的安装来源，用于前端展示和后续操作。
/// 对应 Claude Code 源码 `schemas.ts` 中的 `PluginSource`
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // 前端通过 serde 序列化使用，Rust 侧暂未直接引用
pub enum PluginSourceType {
    /// 本地路径（marketplace 内的相对路径）
    Local,
    /// npm 包
    Npm,
    /// pip 包
    Pip,
    /// git URL
    Url,
    /// GitHub 仓库
    Github,
    /// Git 子目录
    GitSubdir,
}

/// 插件作者信息
///
/// 对应 Claude Code 源码 `schemas.ts` 中的 `PluginAuthor`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAuthor {
    /// 作者/组织的显示名称
    pub name: String,
    /// 联系邮箱（可选）
    pub email: Option<String>,
    /// 网站 URL（可选）
    pub url: Option<String>,
}

/// 单个插件的安装条目（V2 格式）
///
/// 每个插件可在多个 scope 下安装（如同时在 user 和 project 级别安装不同版本）。
/// 对应 Claude Code 源码 `schemas.ts` 中的 `PluginInstallationEntry`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallation {
    /// 安装作用域
    pub scope: PluginScope,
    /// 项目路径（仅 project/local 作用域需要）
    pub project_path: Option<String>,
    /// 插件安装的绝对路径
    pub install_path: String,
    /// 当前安装版本
    pub version: Option<String>,
    /// 安装时间（ISO 8601）
    pub installed_at: Option<String>,
    /// 最后更新时间（ISO 8601）
    pub last_updated: Option<String>,
    /// Git commit SHA（git 来源插件的版本追踪）
    pub git_commit_sha: Option<String>,
}

/// installed_plugins.json 文件结构（V2 格式）
///
/// 存储所有已安装插件的元数据。
/// 对应 Claude Code 源码 `schemas.ts` 中的 `InstalledPluginsFileV2`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPluginsFile {
    /// 文件格式版本号（当前为 2）
    pub version: u32,
    /// 插件 ID → 安装条目数组的映射
    pub plugins: std::collections::HashMap<String, Vec<PluginInstallation>>,
}

/// 插件清单（plugin.json）
///
/// 从 `.claude-plugin/plugin.json` 中解析的插件元数据。
/// 对应 Claude Code 源码 `schemas.ts` 中的 `PluginManifest`
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    /// 插件名称（kebab-case，唯一标识符）
    pub name: String,
    /// 语义化版本号（如 "1.2.3"）
    pub version: Option<String>,
    /// 插件描述
    pub description: Option<String>,
    /// 作者信息
    pub author: Option<PluginAuthor>,
    /// 主页 URL
    pub homepage: Option<String>,
    /// 源码仓库 URL
    pub repository: Option<String>,
    /// 许可证标识（SPDX，如 "MIT"）
    pub license: Option<String>,
    /// 关键词标签
    pub keywords: Option<Vec<String>>,
}

/// known_marketplaces.json 中单个 marketplace 的条目
///
/// 对应 Claude Code 源码 `schemas.ts` 中的 `KnownMarketplace`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownMarketplace {
    /// marketplace 来源配置（JSON value，因为来源类型多样）
    pub source: serde_json::Value,
    /// 本地缓存路径
    pub install_location: String,
    /// 最后更新时间（ISO 8601）
    pub last_updated: String,
    /// 是否自动更新
    pub auto_update: Option<bool>,
}

/// 前端展示用的插件信息摘要
///
/// 聚合了来自多个数据源的插件信息：
/// - `installed_plugins.json`：安装状态、版本、路径
/// - `.claude-plugin/plugin.json`：清单元数据（名称、描述、作者等）
/// - `settings.json` → `enabledPlugins`：启用/禁用状态
///
/// 这是前端 PluginsManager 组件的主要数据结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    /// 插件 ID（格式："plugin-name@marketplace-name"）
    pub id: String,
    /// 插件名称（从 ID 中提取的 plugin-name 部分）
    pub name: String,
    /// 所属 marketplace 名称（从 ID 中提取的 marketplace-name 部分）
    pub marketplace: String,
    /// 插件描述（优先使用 manifest 中的，fallback 到 marketplace entry 中的）
    pub description: Option<String>,
    /// 当前安装版本
    pub version: Option<String>,
    /// 作者信息
    pub author: Option<PluginAuthor>,
    /// 主页 URL
    pub homepage: Option<String>,
    /// 源码仓库 URL
    pub repository: Option<String>,
    /// 许可证
    pub license: Option<String>,
    /// 关键词标签
    pub keywords: Option<Vec<String>>,
    /// 是否已启用（来自 settings.json 的 enabledPlugins）
    pub enabled: bool,
    /// 安装作用域
    pub scope: PluginScope,
    /// 安装路径
    pub install_path: String,
    /// 安装时间（ISO 8601）
    pub installed_at: Option<String>,
    /// 最后更新时间（ISO 8601）
    pub last_updated: Option<String>,
}

/// 已知 marketplaces 信息
///
/// 前端展示用的 marketplace 摘要，用于安装新插件时选择来源。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceInfo {
    /// marketplace 名称
    pub name: String,
    /// 来源类型描述（如 "github", "npm", "local" 等）
    pub source_type: String,
    /// 来源详情（如 "anthropics/claude-plugins"）
    pub source_detail: String,
    /// 本地缓存路径
    pub install_location: String,
    /// 最后更新时间
    pub last_updated: String,
    /// 是否自动更新
    pub auto_update: bool,
}

/// 插件操作结果
///
/// 用于启用/禁用等操作的统一返回类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginActionResult {
    /// 操作是否成功
    pub success: bool,
    /// 结果消息
    pub message: String,
}
