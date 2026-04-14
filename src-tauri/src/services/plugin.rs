//! # Plugin 服务模块
//!
//! 提供 Claude Code Plugins 系统的核心业务逻辑：
//! - 扫描已安装的插件（从 `installed_plugins.json` + `settings.json`）
//! - 读取插件清单（`plugin.json`）
//! - 切换插件的启用/禁用状态（修改 `settings.json` 的 `enabledPlugins`）
//! - 列出已知的 marketplaces
//!
//! ## 数据流
//! 1. 从 `~/.claude/plugins/installed_plugins.json` 读取安装元数据
//! 2. 从 `~/.claude/settings.json` 的 `enabledPlugins` 读取启用状态
//! 3. 从每个插件的 `.claude-plugin/plugin.json` 读取清单元数据
//! 4. 聚合为 `PluginInfo` 列表返回给前端
//!
//! ## 与 Claude Code 源码的对应关系
//! - 安装元数据读取：`installedPluginsManager.ts` → `loadInstalledPluginsV2()`
//! - 启用状态管理：`settings.json` → `enabledPlugins` 字段
//! - 清单解析：`pluginLoader.ts` → `createPluginFromPath()`
//! - marketplace 列表：`known_marketplaces.json`

use std::path::{Path, PathBuf};
use crate::models::plugin::{
    InstalledPluginsFile, KnownMarketplace, MarketplaceInfo,
    PluginActionResult, PluginInfo, PluginManifest, PluginScope,
};

/// 获取 plugins 根目录路径
///
/// 默认为 `~/.claude/plugins/`，对应 Claude Code 源码中的
/// `pluginDirectories.ts` → `getPluginsDirectory()`
fn get_plugins_directory() -> Result<PathBuf, String> {
    // 获取用户主目录下的 .claude 目录
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    Ok(home.join(".claude").join("plugins"))
}

/// 获取 Claude 数据目录路径
///
/// 即 `~/.claude/`
fn get_claude_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    Ok(home.join(".claude"))
}

/// 读取并解析 installed_plugins.json 文件
///
/// 对应 Claude Code 源码 `installedPluginsManager.ts` → `loadInstalledPluginsV2()`。
/// 如果文件不存在，返回空的 V2 结构。
async fn load_installed_plugins() -> Result<InstalledPluginsFile, String> {
    let plugins_dir = get_plugins_directory()?;
    let file_path = plugins_dir.join("installed_plugins.json");

    // 文件不存在时返回空结构
    if !file_path.exists() {
        return Ok(InstalledPluginsFile {
            version: 2,
            plugins: std::collections::HashMap::new(),
        });
    }

    // 读取并解析 JSON
    let content = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("读取 installed_plugins.json 失败: {}", e))?;

    let data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析 installed_plugins.json 失败: {}", e))?;

    // 检查版本号
    let version = data.get("version")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32;

    if version == 2 {
        // V2 格式：直接反序列化
        serde_json::from_value(data)
            .map_err(|e| format!("解析 installed_plugins.json V2 格式失败: {}", e))
    } else {
        // V1 格式：转换为 V2
        // V1 的 plugins 是 Record<string, InstalledPlugin>，需要包装成数组
        let v1_plugins = data.get("plugins")
            .and_then(|p| p.as_object())
            .cloned()
            .unwrap_or_default();

        let mut v2_plugins = std::collections::HashMap::new();
        for (plugin_id, v1_entry) in v1_plugins {
            // 将 V1 单条目转为 V2 数组格式，默认 scope 为 user
            let installation = crate::models::plugin::PluginInstallation {
                scope: PluginScope::User,
                project_path: None,
                install_path: v1_entry.get("installPath")
                    .and_then(|p| p.as_str())
                    .unwrap_or("")
                    .to_string(),
                version: v1_entry.get("version")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                installed_at: v1_entry.get("installedAt")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                last_updated: v1_entry.get("lastUpdated")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                git_commit_sha: v1_entry.get("gitCommitSha")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            };
            v2_plugins.insert(plugin_id, vec![installation]);
        }

        Ok(InstalledPluginsFile {
            version: 2,
            plugins: v2_plugins,
        })
    }
}

/// 从 settings.json 读取 enabledPlugins 字段
///
/// 返回 HashMap<pluginId, 是否启用>。
/// enabledPlugins 的值可以是 boolean 或 string[]，我们统一处理为 bool：
/// - `true` / `["tool1"]`（非空数组）→ 启用
/// - `false` / `undefined` → 禁用
///
/// 对应 Claude Code 源码中 `settings.json` 的 `enabledPlugins` 字段。
async fn load_enabled_plugins() -> Result<std::collections::HashMap<String, bool>, String> {
    let claude_dir = get_claude_dir()?;
    let settings_path = claude_dir.join("settings.json");

    if !settings_path.exists() {
        return Ok(std::collections::HashMap::new());
    }

    let content = tokio::fs::read_to_string(&settings_path)
        .await
        .map_err(|e| format!("读取 settings.json 失败: {}", e))?;

    let settings: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析 settings.json 失败: {}", e))?;

    let enabled_plugins = settings.get("enabledPlugins")
        .and_then(|ep| ep.as_object())
        .cloned()
        .unwrap_or_default();

    let mut result = std::collections::HashMap::new();
    for (plugin_id, value) in enabled_plugins {
        // 判断启用状态：
        // - boolean true → 启用
        // - 非空数组 → 启用（限制工具列表）
        // - boolean false / null / undefined → 禁用
        let enabled = match &value {
            serde_json::Value::Bool(b) => *b,
            serde_json::Value::Array(arr) => !arr.is_empty(),
            _ => false,
        };
        result.insert(plugin_id, enabled);
    }

    Ok(result)
}

/// 尝试读取插件的 plugin.json 清单文件
///
/// 从插件安装路径中查找 `.claude-plugin/plugin.json`，
/// 解析出 `PluginManifest` 结构。
///
/// 对应 Claude Code 源码 `pluginLoader.ts` 中的清单读取逻辑。
fn read_plugin_manifest(install_path: &Path) -> Option<PluginManifest> {
    let manifest_path = install_path.join(".claude-plugin").join("plugin.json");

    if !manifest_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&manifest_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// 从插件 ID 中解析出插件名和 marketplace 名
///
/// 格式："plugin-name@marketplace-name"
/// 对应 Claude Code 源码 `pluginIdentifier.ts` → `parsePluginIdentifier()`
fn parse_plugin_id(plugin_id: &str) -> (String, String) {
    // 使用 find('@') 从左查找第一个 '@'，与 Claude Code 源码 `pluginIdentifier.ts`
    // 中 `split('@')` 取前两项的行为一致。
    // 注意：之前用 rfind('@') 从右查找是错误的，当 marketplace 名中包含 '@' 时
    // 会导致解析不一致。
    if let Some(at_pos) = plugin_id.find('@') {
        let name = plugin_id[..at_pos].to_string();
        let marketplace = plugin_id[at_pos + 1..].to_string();
        (name, marketplace)
    } else {
        // 非标准格式，整个 ID 作为名称
        (plugin_id.to_string(), "unknown".to_string())
    }
}

/// 列出所有已安装的插件
///
/// 聚合 `installed_plugins.json`、`settings.json` 和 `plugin.json` 的信息，
/// 返回完整的 `PluginInfo` 列表。
///
/// ## 数据聚合流程
/// 1. 从 `installed_plugins.json` 获取安装元数据（路径、版本、scope 等）
/// 2. 从 `settings.json` 的 `enabledPlugins` 获取启用状态
/// 3. 从每个插件的 `plugin.json` 获取清单元数据（描述、作者等）
/// 4. 合并为统一的 `PluginInfo` 结构
pub async fn list_plugins() -> Result<Vec<PluginInfo>, String> {
    // 并行读取安装数据和启用状态
    let (installed, enabled) = tokio::join!(
        load_installed_plugins(),
        load_enabled_plugins()
    );

    let installed = installed?;
    let enabled = enabled?;

    let mut plugins = Vec::new();

    for (plugin_id, installations) in &installed.plugins {
        // 取第一个安装条目（通常只有一个）
        let installation = match installations.first() {
            Some(inst) => inst,
            None => continue,
        };

        // 解析插件 ID
        let (name, marketplace) = parse_plugin_id(plugin_id);

        // 查询启用状态（在 enabledPlugins 中存在且值为 true/非空数组 → 启用）
        let is_enabled = enabled.get(plugin_id).copied().unwrap_or(false);

        // 尝试读取清单
        let manifest = read_plugin_manifest(Path::new(&installation.install_path));

        // 构建 PluginInfo
        let info = PluginInfo {
            id: plugin_id.clone(),
            name: manifest.as_ref()
                .and_then(|m| if m.name.is_empty() { None } else { Some(m.name.clone()) })
                .unwrap_or(name),
            marketplace,
            description: manifest.as_ref().and_then(|m| m.description.clone()),
            version: installation.version.clone()
                .or_else(|| manifest.as_ref().and_then(|m| m.version.clone())),
            author: manifest.as_ref().and_then(|m| m.author.clone()),
            homepage: manifest.as_ref().and_then(|m| m.homepage.clone()),
            repository: manifest.as_ref().and_then(|m| m.repository.clone()),
            license: manifest.as_ref().and_then(|m| m.license.clone()),
            keywords: manifest.as_ref().and_then(|m| m.keywords.clone()),
            enabled: is_enabled,
            scope: installation.scope.clone(),
            install_path: installation.install_path.clone(),
            installed_at: installation.installed_at.clone(),
            last_updated: installation.last_updated.clone(),
        };

        plugins.push(info);
    }

    // 按名称排序
    plugins.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(plugins)
}

/// 切换插件的启用/禁用状态
///
/// 修改 `~/.claude/settings.json` 中的 `enabledPlugins` 字段。
/// - 启用：设置 `enabledPlugins[pluginId] = true`
/// - 禁用：设置 `enabledPlugins[pluginId] = false`
///
/// 这与 Claude Code 源码中的启用/禁用逻辑一致：
/// `enabledPlugins` 字段的 key 为 plugin ID（`name@marketplace`），
/// value 为 `true`（全部工具启用）、`false`（禁用）或 `string[]`（限制工具列表）。
pub async fn toggle_plugin(plugin_id: &str, enabled: bool) -> Result<PluginActionResult, String> {
    let claude_dir = get_claude_dir()?;
    let settings_path = claude_dir.join("settings.json");

    // 读取当前 settings
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = tokio::fs::read_to_string(&settings_path)
            .await
            .map_err(|e| format!("读取 settings.json 失败: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("解析 settings.json 失败: {}", e))?
    } else {
        serde_json::json!({})
    };

    // 确保 enabledPlugins 字段存在
    if settings.get("enabledPlugins").is_none() {
        settings["enabledPlugins"] = serde_json::json!({});
    }

    // 设置插件状态
    // 重要：enabledPlugins 的值有三种类型：
    //   - `true`：启用所有工具
    //   - `false`：禁用
    //   - `string[]`（如 `["tool1", "tool2"]`）：启用但限制可用工具列表
    //
    // 为避免丢失原有的工具限制列表（string[]），采用以下策略：
    //   - 禁用时：直接设为 false
    //   - 启用时：如果当前值为 false，设为 true；
    //             如果当前值已经是 true 或 array（已启用），不做改变
    let current_value = settings["enabledPlugins"]
        .get(plugin_id)
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    if enabled {
        // 启用：仅当当前值为 false 或 null（未设置/已禁用）时才设为 true
        // 如果当前值已经是 true 或 array，保持不变以保留工具限制列表
        match &current_value {
            serde_json::Value::Bool(false) | serde_json::Value::Null => {
                settings["enabledPlugins"][plugin_id] = serde_json::Value::Bool(true);
            }
            // true 或 array（已启用）→ 不做改变
            _ => {}
        }
    } else {
        // 禁用：直接设为 false
        settings["enabledPlugins"][plugin_id] = serde_json::Value::Bool(false);
    }

    // 原子写入 settings.json：先写入临时文件，再 rename 覆盖原文件。
    // 这样即使写入过程中崩溃，原文件也不会被截断/损坏。
    // 在 NTFS（Windows）上 rename 是原子操作。
    let formatted = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("序列化 settings.json 失败: {}", e))?;

    // 临时文件放在同目录下，确保与目标文件在同一文件系统（rename 的前提）
    let tmp_path = claude_dir.join("settings.json.tmp");

    // 步骤 1：写入临时文件
    tokio::fs::write(&tmp_path, &formatted)
        .await
        .map_err(|e| format!("写入临时文件 settings.json.tmp 失败: {}", e))?;

    // 步骤 2：原子 rename 覆盖原文件
    tokio::fs::rename(&tmp_path, &settings_path)
        .await
        .map_err(|e| {
            // rename 失败时尝试清理临时文件（best-effort）
            let tmp_clone = tmp_path.clone();
            tokio::spawn(async move {
                let _ = tokio::fs::remove_file(&tmp_clone).await;
            });
            format!("原子替换 settings.json 失败: {}", e)
        })?;

    let action = if enabled { "启用" } else { "禁用" };
    Ok(PluginActionResult {
        success: true,
        message: format!("已{}插件 {}", action, plugin_id),
    })
}

/// 列出已知的 marketplaces
///
/// 从 `~/.claude/plugins/known_marketplaces.json` 读取已注册的 marketplace 列表。
/// 对应 Claude Code 源码 `schemas.ts` 中的 `KnownMarketplacesFile`。
pub async fn list_marketplaces() -> Result<Vec<MarketplaceInfo>, String> {
    let plugins_dir = get_plugins_directory()?;
    let file_path = plugins_dir.join("known_marketplaces.json");

    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let content = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("读取 known_marketplaces.json 失败: {}", e))?;

    let marketplaces: std::collections::HashMap<String, KnownMarketplace> =
        serde_json::from_str(&content)
            .map_err(|e| format!("解析 known_marketplaces.json 失败: {}", e))?;

    let mut result = Vec::new();
    for (name, entry) in marketplaces {
        // 从 source JSON 中提取来源类型和详情
        let source_type = entry.source.get("source")
            .and_then(|s| s.as_str())
            .unwrap_or("unknown")
            .to_string();

        let source_detail = match source_type.as_str() {
            "github" => entry.source.get("repo")
                .and_then(|r| r.as_str())
                .unwrap_or("")
                .to_string(),
            "git" | "url" => entry.source.get("url")
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string(),
            "npm" => entry.source.get("package")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string(),
            "file" | "directory" => entry.source.get("path")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string(),
            "settings" => format!("(内联定义 in settings.json)"),
            _ => String::new(),
        };

        result.push(MarketplaceInfo {
            name,
            source_type,
            source_detail,
            install_location: entry.install_location,
            last_updated: entry.last_updated,
            auto_update: entry.auto_update.unwrap_or(false),
        });
    }

    // 按名称排序
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(result)
}
