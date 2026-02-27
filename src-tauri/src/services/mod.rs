//! # 业务逻辑服务模块
//!
//! 包含核心业务逻辑的实现，与 Tauri command 层解耦：
//! - `scanner` - 文件系统扫描，支持并行 I/O
//! - `parser` - JSONL 文件的高性能解析和写入
//! - `cache` - 内存缓存管理（项目列表缓存和会话消息 LRU 缓存）
//! - `classifier` - 消息分类器：将原始消息分类为 user/assistant/system 等类型
//! - `transformer` - 消息转换器：将原始消息转换为前端可渲染的 DisplayMessage
//! - `export` - 会话导出服务：Markdown/JSON 格式导出
//! - `file_guard` - 文件写入守卫：统一文件修改入口 + 双重备份机制
//! - `fixers` - 一键修复框架：可扩展的会话修复注册表和执行引擎

pub mod cache;
pub mod classifier;
pub mod export;
pub mod file_guard;
pub mod fixers;
pub mod parser;
pub mod scanner;
pub mod transformer;
