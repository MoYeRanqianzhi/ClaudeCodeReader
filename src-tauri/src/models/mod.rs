//! # 数据模型模块
//!
//! 定义了与前端 TypeScript 类型一一对应的 Rust 数据结构。
//! 所有结构体均派生 `Serialize` 和 `Deserialize`，用于 Tauri IPC 传输和 JSON 文件读写。
//! - `project` - 项目和会话的数据结构
//! - `message` - 会话消息和内容块的数据结构
//! - `settings` - Claude Code 设置和环境配置的数据结构

pub mod display;
pub mod message;
pub mod project;
pub mod settings;
