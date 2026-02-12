//! # 业务逻辑服务模块
//!
//! 包含核心业务逻辑的实现，与 Tauri command 层解耦：
//! - `scanner` - 文件系统扫描，支持并行 I/O
//! - `parser` - JSONL 文件的高性能解析和写入
//! - `cache` - 内存缓存管理（项目列表缓存和会话消息 LRU 缓存）

pub mod cache;
pub mod parser;
pub mod scanner;
