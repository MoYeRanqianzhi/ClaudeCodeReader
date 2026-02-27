//! # 一键修复框架（Fixers Framework）
//!
//! 提供可扩展的会话修复注册表和执行引擎，支持四级权限分档。
//!
//! ## 档位设计
//!
//! | 档位 | 名称 | 权限 | 参数 | 写回 |
//! |------|------|------|------|------|
//! | Entry | 条目修复 | 只能操作解析后的消息条目 | `&mut Vec<SessionMessage>` | 框架自动覆写 |
//! | Content | 内容修复 | 只能操作文件原始文本 | `&str`（原始内容） | 框架自动覆写 |
//! | File | 文件修复 | 仅限操作该会话文件 | 文件路径 + AppCache | 修复自行操作 |
//! | Full | 特殊修复 | 完全权限，无任何限制 | 文件路径 + AppCache | 修复自行操作 |
//!
//! Entry 和 Content 档位由框架统一负责文件读取、备份和覆写，
//! 修复逻辑只操作内存中的数据，无法直接接触文件系统。
//!
//! ## 如何添加新修复
//!
//! 1. 在 `services/fixers/` 目录下创建新文件（如 `my_fix.rs`）
//! 2. 实现 `pub fn definition() -> FixDefinition`（含 `level` 字段指定档位）
//! 3. 实现对应档位签名的 `pub fn execute(...)` 函数
//! 4. 在本文件中 `mod my_fix;` 引入模块
//! 5. 在 `all_fixers()` 的返回数组中用对应的 `FixerExecutor` 变体注册
//!
//! 详细指南请参考 `docs/development/fixers-guide.md`。

pub mod strip_thinking;

use std::future::Future;
use std::pin::Pin;

use serde::Serialize;

use crate::models::message::SessionMessage;
use crate::services::cache::AppCache;
use crate::services::file_guard;
use crate::services::parser;

// ============ 数据结构 ============

/// 修复档位级别
///
/// 四个档位从低到高，权限逐渐递增。
/// 前端根据此值展示不同颜色的标注徽章。
///
/// 对应前端 TypeScript 类型：`FixLevel`
// Content / File / Full 变体当前尚无具体实现，但属于四级分档设计的一部分，
// 供后续新增修复项使用，因此保留并允许 dead_code。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FixLevel {
    /// 条目修复：只能增删改查解析后的消息条目，不可操作文件系统
    Entry,
    /// 内容修复：可读写文件的原始文本内容，修改后由框架自动覆写
    Content,
    /// 文件修复：拥有文件操作权限，但仅限该会话文件（路径验证）
    File,
    /// 特殊修复：完全权限，不进行任何限制
    Full,
}

/// 修复定义元数据
///
/// 描述一个修复项的完整信息，通过 Tauri IPC 传递给前端展示。
/// 前端使用这些字段渲染列表、搜索过滤、详情页面和档位标注。
///
/// 对应前端 TypeScript 接口：`FixDefinition`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixDefinition {
    /// 唯一标识符（如 "strip_thinking"），用于 execute_fixer 命令定位修复项
    pub id: String,
    /// 问题名称（如 "400 (thinking block) 错误"），显示在列表和详情标题
    pub name: String,
    /// 问题详细描述，可以是多行文本，包含错误信息示例等
    pub description: String,
    /// 修复方式说明（如 "去除会话文件中包含 thinking 的内容块"）
    pub fix_method: String,
    /// 搜索标签，扩展搜索范围（如 ["thinking", "400", "invalid_request_error"]）
    pub tags: Vec<String>,
    /// 修复档位级别，决定该修复项的权限范围和 UI 标注样式
    pub level: FixLevel,
}

/// 修复执行结果
///
/// 修复完成后返回给前端，展示修复是否成功以及影响范围。
///
/// 对应前端 TypeScript 接口：`FixResult`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixResult {
    /// 修复是否成功完成
    pub success: bool,
    /// 结果消息（成功提示或错误原因）
    pub message: String,
    /// 受影响的消息行数（即被修改的 JSONL 行数）
    pub affected_lines: usize,
}

// ============ 注册表类型定义 ============

/// 修复定义函数的签名
///
/// 返回该修复项的元数据，用于列表展示和搜索。
pub type DefinitionFn = fn() -> FixDefinition;

/// Entry 档位执行函数签名
///
/// 接收可变消息列表引用，在原地修改消息条目。
/// 修复逻辑只负责操作数据，文件读写和备份由框架统一处理。
///
/// # 参数
/// - `messages` — 解析后的消息列表（可变引用）
pub type EntryExecuteFn = for<'a> fn(
    &'a mut Vec<SessionMessage>,
) -> Pin<Box<dyn Future<Output = Result<FixResult, String>> + Send + 'a>>;

/// Content 档位执行函数签名
///
/// 接收文件原始文本内容，返回修复结果和修改后的新内容。
/// 文件读取和覆写由框架统一处理。
///
/// # 参数
/// - `content` — 文件的原始文本内容
///
/// # 返回值
/// 元组 `(FixResult, String)`：修复结果 + 修改后的完整文件内容
pub type ContentExecuteFn = for<'a> fn(
    &'a str,
) -> Pin<Box<dyn Future<Output = Result<(FixResult, String), String>> + Send + 'a>>;

/// File 档位执行函数签名
///
/// 接收文件路径和 AppCache 引用，修复项自行进行文件操作。
/// 框架会预先验证路径在 `~/.claude/` 目录下。
///
/// # 参数
/// - `session_file_path` — 会话 JSONL 文件的绝对路径
/// - `cache` — AppCache 引用，传递给 file_guard 的安全写入函数
pub type FileExecuteFn = for<'a> fn(
    &'a str,
    &'a AppCache,
) -> Pin<Box<dyn Future<Output = Result<FixResult, String>> + Send + 'a>>;

/// Full 档位执行函数签名
///
/// 与 File 相同的参数，但框架不做任何路径限制。
/// 仅在特殊场景下使用（如跨目录修复）。
pub type FullExecuteFn = for<'a> fn(
    &'a str,
    &'a AppCache,
) -> Pin<Box<dyn Future<Output = Result<FixResult, String>> + Send + 'a>>;

/// 修复执行器枚举
///
/// 包装四种不同档位的函数指针，供 `execute_by_id` 按档位分发调用。
/// 每种变体对应不同的参数签名和权限范围。
// Content / File / Full 变体当前无具体修复项使用，属于预留扩展。
#[allow(dead_code)]
pub enum FixerExecutor {
    /// 条目修复：操作解析后的消息列表
    Entry(EntryExecuteFn),
    /// 内容修复：操作文件原始文本
    Content(ContentExecuteFn),
    /// 文件修复：自行操作文件（路径受限于 ~/.claude/）
    File(FileExecuteFn),
    /// 特殊修复：完全权限
    Full(FullExecuteFn),
}

/// 修复注册条目
///
/// 将定义函数和执行器组合为一个注册条目。
pub struct FixerEntry {
    /// 获取修复元数据的函数
    pub definition: DefinitionFn,
    /// 按档位分类的执行器
    pub executor: FixerExecutor,
}

// ============ 注册表 ============

/// 获取所有已注册的修复项列表
///
/// **添加新修复时，在此数组中追加注册条目即可。**
///
/// 返回的修复项按数组顺序展示在前端列表中。
pub fn all_fixers() -> Vec<FixerEntry> {
    vec![
        // 修复 #1：去除 thinking/redacted_thinking 内容块（Entry 档位）
        FixerEntry {
            definition: strip_thinking::definition,
            executor: FixerExecutor::Entry(strip_thinking::execute),
        },
    ]
}

/// 根据 ID 查找并执行指定的修复项
///
/// 按档位分发执行：
/// - **Entry**：框架读取消息 → 修复操作消息 → 框架自动覆写
/// - **Content**：框架读取文件内容 → 修复操作文本 → 框架自动覆写
/// - **File**：验证路径后交给修复自行操作文件
/// - **Full**：不做任何限制，直接交给修复执行
///
/// # 参数
/// - `fixer_id` — 修复项的唯一标识符
/// - `session_file_path` — 要修复的会话 JSONL 文件绝对路径
/// - `cache` — AppCache 引用
///
/// # 错误
/// 未找到指定 ID 的修复项时返回错误
pub async fn execute_by_id(
    fixer_id: &str,
    session_file_path: &str,
    cache: &AppCache,
) -> Result<FixResult, String> {
    let fixers = all_fixers();

    for fixer in &fixers {
        let def = (fixer.definition)();
        if def.id != fixer_id {
            continue;
        }

        // 根据档位构造 operation 标识（用于备份记录）
        let operation = format!("fixer_{}", fixer_id);

        return match &fixer.executor {
            // ---- Entry 档位：框架负责读写 ----
            FixerExecutor::Entry(exec_fn) => {
                // 1. 框架读取所有消息
                let mut messages = parser::read_messages(session_file_path).await?;
                // 2. 修复逻辑在内存中操作消息列表
                let result = exec_fn(&mut messages).await?;
                // 3. 仅当有实际修改时，框架自动覆写（含双重备份）
                if result.affected_lines > 0 {
                    parser::write_messages(
                        session_file_path,
                        &messages,
                        &operation,
                        cache,
                    )
                    .await?;
                }
                Ok(result)
            }

            // ---- Content 档位：框架负责读写 ----
            FixerExecutor::Content(exec_fn) => {
                // 1. 框架读取文件原始文本
                let content = tokio::fs::read_to_string(session_file_path)
                    .await
                    .map_err(|e| format!("读取文件内容失败: {}", e))?;
                // 2. 修复逻辑操作文本内容，返回新内容
                let (result, new_content) = exec_fn(&content).await?;
                // 3. 仅当有实际修改时，框架自动覆写
                if result.affected_lines > 0 {
                    file_guard::safe_write_file(
                        session_file_path,
                        new_content.as_bytes(),
                        &operation,
                        cache,
                    )
                    .await?;
                }
                Ok(result)
            }

            // ---- File 档位：验证路径后交给修复自行操作 ----
            FixerExecutor::File(exec_fn) => {
                // 框架预先验证路径在 ~/.claude/ 下
                file_guard::validate_claude_path(session_file_path)?;
                exec_fn(session_file_path, cache).await
            }

            // ---- Full 档位：完全权限，不做任何限制 ----
            FixerExecutor::Full(exec_fn) => {
                exec_fn(session_file_path, cache).await
            }
        };
    }

    Err(format!("未找到 ID 为 '{}' 的修复项", fixer_id))
}

/// 获取所有修复项的定义列表（供前端展示）
///
/// 遍历注册表，收集每个修复项的元数据。
pub fn list_definitions() -> Vec<FixDefinition> {
    all_fixers()
        .iter()
        .map(|entry| (entry.definition)())
        .collect()
}
