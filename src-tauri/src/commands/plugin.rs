//! # Plugins 管理 Tauri Commands
//!
//! 提供 Plugins 相关的 Tauri command 处理函数：
//! - `list_plugins` - 列出所有已安装的插件
//! - `toggle_plugin` - 切换插件的启用/禁用状态
//! - `list_marketplaces` - 列出已知的 marketplaces
//!
//! 这些 commands 是前端 PluginsManager 组件的数据来源，
//! 通过 Tauri IPC 调用 `services::plugin` 中的业务逻辑。

use crate::models::plugin::{MarketplaceInfo, PluginActionResult, PluginInfo};
use crate::services::plugin;

/// 列出所有已安装的插件
///
/// 扫描 `installed_plugins.json` 和 `settings.json`，
/// 聚合插件安装元数据、启用状态和清单信息，
/// 返回完整的 `PluginInfo` 列表。
///
/// # 前端调用示例
/// ```typescript
/// const plugins = await invoke<PluginInfo[]>('list_plugins');
/// ```
#[tauri::command]
pub async fn list_plugins() -> Result<Vec<PluginInfo>, String> {
    plugin::list_plugins().await
}

/// 切换插件的启用/禁用状态
///
/// 修改 `~/.claude/settings.json` 中的 `enabledPlugins` 字段。
/// 这是 Claude Code 原生的启用/禁用机制，
/// 与 CLI 中的 `claude plugin enable/disable` 命令效果一致。
///
/// # 参数（通过 Tauri invoke 传入）
/// - `plugin_id` - 插件 ID（格式："plugin-name@marketplace-name"）
/// - `enabled` - 是否启用
///
/// # 前端调用示例
/// ```typescript
/// await invoke('toggle_plugin', { pluginId: 'my-plugin@marketplace', enabled: true });
/// ```
#[tauri::command]
pub async fn toggle_plugin(plugin_id: String, enabled: bool) -> Result<PluginActionResult, String> {
    plugin::toggle_plugin(&plugin_id, enabled).await
}

/// 列出已知的 marketplaces
///
/// 从 `~/.claude/plugins/known_marketplaces.json` 读取已注册的 marketplace 列表。
/// 用于前端展示 marketplace 信息和辅助安装操作。
///
/// # 前端调用示例
/// ```typescript
/// const marketplaces = await invoke<MarketplaceInfo[]>('list_marketplaces');
/// ```
#[tauri::command]
pub async fn list_marketplaces() -> Result<Vec<MarketplaceInfo>, String> {
    plugin::list_marketplaces().await
}
