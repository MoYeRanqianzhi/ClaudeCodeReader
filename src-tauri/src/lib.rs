//! # ClaudeCodeReader - Tauri 应用核心初始化模块
//!
//! 本模块负责 Tauri 应用的完整初始化流程，包括：
//! - 注册 Tauri 官方插件（文件系统、对话框、Shell、日志）
//! - 配置应用启动前的 setup 钩子
//! - 生成应用上下文并启动事件循环
//!
//! 通过将核心逻辑放在 `lib.rs` 而非 `main.rs` 中，
//! Tauri 可以在桌面端（`main.rs`）和移动端入口之间共享此初始化代码。

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
/// 3. 在 `setup` 钩子中按需注册调试专用插件（日志）
/// 4. 生成应用上下文并启动主事件循环
///
/// # Panics
/// 如果 Tauri 应用启动失败（例如配置文件缺失或窗口创建失败），
/// 将通过 `.expect()` 触发 panic 并输出错误信息。
pub fn run() {
  tauri::Builder::default()
    // 文件系统插件：允许前端通过 Tauri API 安全地读写本地文件
    .plugin(tauri_plugin_fs::init())
    // 对话框插件：提供原生的文件选择器、消息框等系统对话框功能
    .plugin(tauri_plugin_dialog::init())
    // Shell 插件：允许前端调用系统命令、打开外部链接等 Shell 操作
    .plugin(tauri_plugin_shell::init())
    // `setup` 闭包：在应用窗口创建之前执行的初始化钩子
    // 适合在此处进行仅在特定条件下需要的插件注册或资源初始化
    .setup(|app| {
      // `cfg!(debug_assertions)`：编译期条件判断宏
      // 当以 Debug 模式编译时（`cargo build`），该条件为 true；
      // 当以 Release 模式编译时（`cargo build --release`），该条件为 false。
      // 此处用于仅在开发调试时启用日志插件，避免在生产环境中产生额外开销。
      if cfg!(debug_assertions) {
        app.handle().plugin(
          // 日志插件：将应用运行时的日志信息输出到控制台或日志文件
          // `LevelFilter::Info` 表示仅记录 Info 级别及以上的日志（Info、Warn、Error）
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    // `tauri::generate_context!()` 宏：在编译时读取 `tauri.conf.json` 配置文件，
    // 生成包含应用名称、窗口配置、安全策略等信息的上下文对象。
    // `.run()` 方法使用该上下文启动 Tauri 事件循环（event loop）。
    .run(tauri::generate_context!())
    // 如果 Tauri 应用启动过程中发生不可恢复的错误，
    // `.expect()` 会触发 panic 并打印此错误消息，终止程序运行。
    .expect("error while running tauri application");
}
