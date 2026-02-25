//! # Tauri Command 处理模块
//!
//! 本模块包含所有注册到 Tauri 的 command 处理函数。
//! 每个子模块对应一个功能域：
//! - `projects` - 项目扫描和会话列表相关 commands
//! - `messages` - 消息的读取、编辑、删除相关 commands
//! - `settings` - 设置和环境配置的读写 commands
//! - `tools` - 实用工具相关 commands（一键 Resume 等）

pub mod messages;
pub mod projects;
pub mod settings;
pub mod tools;
