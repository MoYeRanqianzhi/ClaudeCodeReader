//! # ClaudeCodeReader - Tauri Cargo 构建脚本
//!
//! 本文件是 Cargo 的构建脚本（build script），在 `cargo build` 编译主项目之前自动执行。
//! Tauri 利用此脚本完成以下构建准备工作：
//! - 生成 Tauri 运行时所需的资源绑定代码
//! - 处理应用图标、权限清单等静态资源
//! - 在 Windows 平台上生成应用程序清单（manifest）和资源文件（.rc）
//!
//! 详见 Cargo 构建脚本文档：https://doc.rust-lang.org/cargo/reference/build-scripts.html

/// 构建脚本入口函数
///
/// 调用 `tauri_build::build()` 执行 Tauri 框架所需的全部构建前处理步骤。
/// 该函数会根据 `tauri.conf.json` 中的配置自动生成相应的编译产物。
fn main() {
  tauri_build::build()
}
