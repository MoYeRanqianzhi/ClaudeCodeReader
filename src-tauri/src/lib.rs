//! # ClaudeCodeReader - Tauri 应用核心初始化模块
//!
//! 本模块负责 Tauri 应用的完整初始化流程，包括：
//! - 注册 Tauri 官方插件（文件系统、对话框、Shell、日志）
//! - 注册自定义 Tauri commands（项目扫描、消息读写、设置管理）
//! - 初始化应用全局状态（内存缓存）
//! - 生成应用上下文并启动事件循环
//!
//! ## 架构说明
//! 通过将核心逻辑放在 `lib.rs` 而非 `main.rs` 中，
//! Tauri 可以在桌面端（`main.rs`）和移动端入口之间共享此初始化代码。
//!
//! ## 模块结构
//! - `commands/` - Tauri command 处理函数（IPC 接口层）
//! - `models/` - 数据模型（对应前端 TypeScript 类型）
//! - `services/` - 核心业务逻辑（扫描、解析、缓存）
//! - `utils/` - 通用工具函数

mod commands;
mod models;
mod services;
mod utils;

use services::cache::AppCache;

// `#[cfg_attr(mobile, tauri::mobile_entry_point)]`：条件编译属性
// 当目标平台为移动端（Android/iOS）时，此属性将 `run()` 函数标记为
// Tauri 移动端入口点，使移动端运行时能够正确定位并调用该函数。
// 在桌面端编译时，此属性不生效，`run()` 由 `main.rs` 直接调用。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Tauri 应用启动函数
///
/// 构建并运行 Tauri 应用实例。该函数完成以下工作：
/// 1. 创建 `tauri::Builder` 默认实例
/// 2. 注册所需的 Tauri 插件（文件系统、对话框、Shell）
/// 3. 初始化应用全局状态（AppCache 内存缓存）
/// 4. 注册所有自定义 Tauri commands
/// 5. 在 `setup` 钩子中按需注册调试专用插件（日志）
/// 6. 生成应用上下文并启动主事件循环
///
/// # Panics
/// 如果 Tauri 应用启动失败（例如配置文件缺失或窗口创建失败），
/// 将通过 `.expect()` 触发 panic 并输出错误信息。
pub fn run() {
    tauri::Builder::default()
        // === 官方插件注册 ===
        // 文件系统插件：允许前端通过 Tauri API 安全地读写本地文件
        // 注意：数据加载已迁移到 Rust 后端，此插件主要供导出功能使用
        .plugin(tauri_plugin_fs::init())
        // 对话框插件：提供原生的文件选择器、消息框等系统对话框功能
        .plugin(tauri_plugin_dialog::init())
        // Shell 插件：允许前端调用系统命令、打开外部链接等 Shell 操作
        .plugin(tauri_plugin_shell::init())
        // Opener 插件：在系统文件管理器中定位文件
        // 使用 OS 原生 API，避免手动拼接 shell 命令
        .plugin(tauri_plugin_opener::init())
        // === 应用全局状态初始化 ===
        // 注册 AppCache 为 Tauri managed state，所有 command 函数可通过
        // `State<AppCache>` 参数注入访问。AppCache 包含：
        // - 项目列表缓存（TTL 30 秒）
        // - 会话消息 LRU 缓存（最多 20 个会话）
        .manage(AppCache::new())
        // === 自定义 Tauri Commands 注册 ===
        // 所有 command 函数通过 `invoke_handler` 注册，前端通过 `invoke()` 调用
        .invoke_handler(tauri::generate_handler![
            // 设置和配置 commands
            commands::settings::get_claude_data_path,
            commands::settings::read_settings,
            commands::settings::save_settings,
            commands::settings::read_env_config,
            commands::settings::save_env_config,
            commands::settings::read_history,
            // 项目扫描 commands
            commands::projects::scan_projects,
            // 消息读写 commands
            commands::messages::read_session_messages,
            commands::messages::delete_message,
            commands::messages::delete_messages,
            commands::messages::edit_message_content,
            commands::messages::delete_session,
            // 搜索和导出 commands
            commands::messages::search_session,
            commands::messages::export_session,
            // 文件系统辅助 commands
            commands::settings::check_file_exists,
            // 实用工具 commands
            commands::tools::read_resume_config,
            commands::tools::save_resume_config,
            commands::tools::open_resume_terminal,
            commands::tools::read_backup_config,
            commands::tools::save_backup_config,
            commands::tools::get_temp_backups,
            // 一键修复 commands
            commands::tools::list_fixers,
            commands::tools::execute_fixer,
        ])
        // `setup` 闭包：在应用窗口创建之前执行的初始化钩子
        .setup(|app| {
            // 仅在开发调试模式下启用日志插件
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        // `tauri::generate_context!()` 宏：在编译时读取 `tauri.conf.json` 配置文件，
        // 生成包含应用名称、窗口配置、安全策略等信息的上下文对象。
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
