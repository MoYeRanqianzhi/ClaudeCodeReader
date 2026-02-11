//! # ClaudeCodeReader - Tauri 桌面应用原生入口点
//!
//! 本文件是整个 Tauri 桌面应用程序的原生入口点（native entry point）。
//! Rust 编译器从此处的 `main()` 函数开始执行，随后调用 `app_lib::run()`
//! 完成 Tauri 引擎的初始化与事件循环启动。
//!
//! 在 Tauri 架构中，`main.rs` 仅负责启动应用，核心逻辑位于 `lib.rs` 中，
//! 以便在桌面端和移动端之间共享代码。

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
// 在 Windows 平台的 Release 构建中隐藏控制台窗口，请勿移除此属性！
// 该属性通过条件编译（`cfg_attr`）仅在非调试模式下生效，
// 将 Windows 子系统设置为 "windows"（GUI 模式）而非默认的 "console"。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// 应用程序主入口函数
///
/// 调用 `app_lib::run()` 启动 Tauri 应用引擎。
/// 所有的插件注册、窗口创建、事件循环等逻辑均在 `app_lib`（即 `lib.rs`）中完成。
fn main() {
  app_lib::run();
}
