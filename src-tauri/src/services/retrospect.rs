//! # 项目回溯引擎
//!
//! 核心服务模块，实现「项目回溯」功能的所有后端逻辑。
//!
//! ## 功能概述
//! 通过解析项目下所有 Claude Code 会话 JSONL 文件中的文件操作（Write/Edit/Bash），
//! 重建项目在任意时间点的文件状态。用户可以在时间轴上自由移动，
//! 查看每一步操作后的文件树和文件内容。
//!
//! ## 架构设计
//! - **RetrospectState**：Tauri managed state，使用 Mutex 保证线程安全
//! - **RetrospectInner**：内部状态，包含操作列表、项目根路径和 LRU 缓存
//! - **VirtualFileSystem**：虚拟文件系统快照，表示某一时间点的完整文件状态
//!
//! ## 性能优化
//! - LRU 缓存（容量 16）：缓存已计算的 VFS 快照，避免重复回放
//! - 增量回放：从最近的缓存快照开始回放，而非每次从头开始
//! - 异步 I/O：初始化阶段使用 tokio 并行读取多个 JSONL 文件

use std::collections::{BTreeMap, HashMap, HashSet};
use std::num::NonZeroUsize;
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use lru::LruCache;
use regex::Regex;

// ============================================================================
// 预编译正则表达式（线程安全，全局唯一实例）
// ============================================================================

/// rm 命令匹配正则（预编译，线程安全）
///
/// 匹配模式：`rm [选项...] 路径`
/// 使用 LazyLock 保证只在首次访问时编译一次。
static RE_RM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^rm\s+((?:-\S+\s+)*)(.+)$"#).unwrap()
});

/// mv 命令匹配正则（预编译，线程安全）
///
/// 匹配模式：`mv [选项...] 源 目标`
static RE_MV: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^mv\s+((?:-\S+\s+)*)(\S+)\s+(\S+)$"#).unwrap()
});

/// cp 命令匹配正则（预编译，线程安全）
///
/// 匹配模式：`cp [选项...] 源 目标`
static RE_CP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^cp\s+((?:-\S+\s+)*)(\S+)\s+(\S+)$"#).unwrap()
});

/// mkdir 命令匹配正则（预编译，线程安全）
///
/// 匹配模式：`mkdir [选项...] 路径`
static RE_MKDIR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^mkdir\s+((?:-\S+\s+)*)(.+)$"#).unwrap()
});

use crate::models::retrospect::{
    FileOpRecord, FileOpSummary, FileOperation, FileTreeNode, RetrospectTimeline,
};

// ============================================================================
// 常量定义
// ============================================================================

/// LRU 缓存容量：最多缓存 16 个 VFS 快照
///
/// 16 是一个经验值：
/// - 用户通常在时间轴附近来回拖动，16 个缓存足以覆盖常见的浏览模式
/// - 每个 VFS 快照的内存占用取决于项目大小，16 个不会过度消耗内存
const CACHE_CAPACITY: usize = 16;

// ============================================================================
// 核心数据结构
// ============================================================================

/// 回溯引擎全局状态（Tauri managed state）
///
/// 使用 `Mutex<Option<RetrospectInner>>` 实现：
/// - `Mutex`：保证多个前端并发调用时的线程安全
/// - `Option`：表示初始化/未初始化状态（None = 未初始化）
///
/// # 生命周期
/// 1. 应用启动时创建为 `None`
/// 2. 前端调用 `retrospect_init` 后变为 `Some(RetrospectInner)`
/// 3. 前端调用 `retrospect_cleanup` 后重置为 `None`
pub struct RetrospectState {
    /// 内部状态，使用 Mutex 包裹确保线程安全
    inner: Mutex<Option<RetrospectInner>>,
}

/// 回溯引擎内部状态
///
/// 包含回溯功能运行时所需的所有数据：
/// - 完整的操作列表（按时间排序）
/// - 项目根目录路径（用于路径转换）
/// - LRU 缓存（加速重复查询）
pub struct RetrospectInner {
    /// 所有文件操作记录（按 timestamp 排序，index 从 0 递增）
    operations: Vec<FileOpRecord>,
    /// 项目根目录的绝对路径
    ///
    /// 用于将 JSONL 中的绝对路径转为相对路径。
    /// 例如：project_root = "G:\ClaudeProjects\Test"
    /// 则 "G:\ClaudeProjects\Test\src\App.tsx" → "src/App.tsx"
    /// 当前在初始化阶段使用，后续可能用于动态路径转换。
    #[allow(dead_code)]
    project_root: String,
    /// LRU 缓存：index → VirtualFileSystem 快照
    ///
    /// 缓存已计算的 VFS 快照，避免重复回放。
    /// 当用户在时间轴上来回拖动时，可以直接从缓存获取快照。
    cache: LruCache<usize, VirtualFileSystem>,
}

impl RetrospectInner {
    /// 获取操作记录总数
    ///
    /// 返回已提取的文件操作记录数量（= 时间轴刻度总数）。
    pub fn operations_count(&self) -> usize {
        self.operations.len()
    }
}

/// 虚拟文件系统快照
///
/// 表示项目在某一时间点（即某个 operation index）的完整文件状态。
/// 通过从头（或从某个缓存点）逐条回放操作来构建。
///
/// # 字段说明
/// - `files`：当前存在的文件及其内容
/// - `deleted`：已被删除的文件路径集合（用于防止对已删除文件进行操作）
#[derive(Debug, Clone)]
struct VirtualFileSystem {
    /// 文件映射：相对路径 → 文件内容
    ///
    /// 存储当前快照中所有存在的文件。
    /// 路径使用 `/` 分隔符，相对于项目根目录。
    files: HashMap<String, String>,
    /// 已删除文件路径集合
    ///
    /// 记录被 rm 命令删除的文件路径。
    /// 当文件被重新 Write 时，会从此集合中移除。
    deleted: HashSet<String>,
}

// ============================================================================
// RetrospectState 实现
// ============================================================================

impl RetrospectState {
    /// 创建新的回溯引擎状态（未初始化）
    ///
    /// 应用启动时调用，将 inner 设为 None。
    /// 直到前端调用 `retrospect_init` 后才会包含实际数据。
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// 获取内部 Mutex 的可变引用
    ///
    /// 供 commands 层使用，获取锁后进行操作。
    pub fn lock_inner(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Option<RetrospectInner>>, String> {
        self.inner
            .lock()
            .map_err(|e| format!("获取回溯状态锁失败: {}", e))
    }
}

// ============================================================================
// VirtualFileSystem 实现
// ============================================================================

impl VirtualFileSystem {
    /// 创建空的虚拟文件系统
    fn new() -> Self {
        Self {
            files: HashMap::new(),
            deleted: HashSet::new(),
        }
    }

    /// 应用一条文件操作到当前 VFS
    ///
    /// 根据操作类型修改 files 和 deleted 集合：
    /// - Write：插入文件内容，从 deleted 中移除
    /// - Edit：在已有文件中执行字符串替换
    /// - BashMove：移动文件（删除源路径，插入目标路径）
    /// - BashCopy：复制文件（在目标路径插入源文件的内容副本）
    /// - BashDelete：删除文件
    /// - BashMkdir：无操作（目录在 VFS 中隐式存在）
    fn apply(&mut self, op: &FileOperation) {
        match op {
            FileOperation::Write { file_path, content } => {
                // Write 操作：创建或覆写文件
                // 同时从 deleted 集合中移除（文件被重新创建）
                self.files.insert(file_path.clone(), content.clone());
                self.deleted.remove(file_path);
            }
            FileOperation::Edit {
                file_path,
                old_string,
                new_string,
                replace_all,
            } => {
                // Edit 操作：仅在文件存在时执行替换
                // 文件不存在（未被 Write 创建过）则静默跳过
                if let Some(content) = self.files.get(file_path) {
                    let new_content = if *replace_all {
                        // 全局替换：替换所有匹配的子串
                        content.replace(old_string, new_string)
                    } else {
                        // 单次替换：仅替换第一个匹配的子串
                        content.replacen(old_string, new_string, 1)
                    };
                    self.files.insert(file_path.clone(), new_content);
                }
            }
            FileOperation::BashMove { from, to } => {
                // Move 操作：从源路径移除，插入到目标路径
                if let Some(content) = self.files.remove(from) {
                    self.files.insert(to.clone(), content);
                    // 标记源路径为已删除
                    self.deleted.insert(from.clone());
                }
            }
            FileOperation::BashCopy { from, to } => {
                // Copy 操作：保留源文件，在目标路径创建副本
                if let Some(content) = self.files.get(from).cloned() {
                    self.files.insert(to.clone(), content);
                }
            }
            FileOperation::BashDelete { file_path } => {
                // Delete 操作：从 files 中移除，加入 deleted 集合
                self.files.remove(file_path);
                self.deleted.insert(file_path.clone());
            }
            FileOperation::BashMkdir { .. } => {
                // Mkdir 操作：VFS 中目录是隐式的（由文件路径推断），无需操作
            }
        }
    }
}

// ============================================================================
// 初始化函数
// ============================================================================

/// 初始化回溯引擎
///
/// 扫描指定项目的所有会话 JSONL 文件，提取文件操作，构建时间轴。
///
/// # 处理流程
/// 1. 解码项目名称获取真实路径（project_root）
/// 2. 扫描 `{claude_data_path}/projects/{project_name}/` 下所有 `.jsonl` 文件
/// 3. 逐文件读取消息，提取 assistant 消息中的 tool_use 块
/// 4. 解析 Write/Edit/Bash 操作，将绝对路径转为相对路径
/// 5. 按 timestamp 全局排序，分配连续 index
/// 6. 构建 RetrospectTimeline 返回给前端
///
/// # 参数
/// - `claude_data_path` - Claude 数据目录路径（如 `~/.claude`）
/// - `project_name` - 编码后的项目目录名（如 "G--ClaudeProjects-Test"）
///
/// # 返回值
/// 成功返回 RetrospectTimeline（包含操作总数和摘要列表）
///
/// # 错误
/// - 会话目录不存在或不可读
/// - 所有 JSONL 文件解析失败
pub async fn init(claude_data_path: &str, project_name: &str) -> Result<(RetrospectTimeline, RetrospectInner), String> {
    // 第 1 步：解码项目名称获取真实路径
    let project_root = crate::utils::path::decode_project_path(project_name);
    log::info!("回溯初始化: 项目根目录 = {}", project_root);

    // 第 2 步：构建会话目录路径并扫描 JSONL 文件
    let session_dir = Path::new(claude_data_path)
        .join("projects")
        .join(project_name);

    // 检查目录是否存在
    if !session_dir.exists() {
        return Err(format!(
            "会话目录不存在: {}",
            session_dir.display()
        ));
    }

    // 扫描目录下所有 .jsonl 文件
    let mut jsonl_files: Vec<String> = Vec::new();
    let mut dir = tokio::fs::read_dir(&session_dir)
        .await
        .map_err(|e| format!("读取会话目录失败: {}", e))?;

    while let Some(entry) = dir
        .next_entry()
        .await
        .map_err(|e| format!("读取目录条目失败: {}", e))?
    {
        let path = entry.path();
        // 只处理 .jsonl 扩展名的文件
        if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            if let Some(path_str) = path.to_str() {
                jsonl_files.push(path_str.to_string());
            }
        }
    }

    log::info!("回溯初始化: 发现 {} 个 JSONL 文件", jsonl_files.len());

    // 第 3 步：逐文件读取消息并提取文件操作
    // 使用临时结构收集所有操作（带时间戳，待排序）
    let mut raw_ops: Vec<(String, FileOperation, String, String)> = Vec::new();
    // 元组: (timestamp, operation, session_file, source_uuid)

    for file_path in &jsonl_files {
        // 提取会话文件名（不含路径）
        let session_file = Path::new(file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown.jsonl")
            .to_string();

        // 使用现有的 parser 读取消息
        let messages = crate::services::parser::read_messages(file_path).await?;

        // 遍历每条消息，提取文件操作
        for msg in &messages {
            // 只处理 assistant 类型的消息
            if msg.get("type").and_then(|v| v.as_str()) != Some("assistant") {
                continue;
            }

            // 获取消息的时间戳
            let timestamp = msg
                .get("timestamp")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // 获取消息的 UUID
            let source_uuid = msg
                .get("uuid")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // 获取 message.content 数组
            let content_blocks = msg
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array());

            // 如果没有 content 数组，跳过这条消息
            let Some(blocks) = content_blocks else {
                continue;
            };

            // 遍历 content 块，查找 tool_use 类型
            for block in blocks {
                if block.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
                    continue;
                }

                let tool_name = block.get("name").and_then(|v| v.as_str());
                let input = block.get("input");

                // 根据工具名称解析操作
                match tool_name {
                    Some("Write") => {
                        // 提取 Write 工具的 file_path 和 content
                        if let Some(input) = input {
                            let file_path = input
                                .get("file_path")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let content = input
                                .get("content")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");

                            if !file_path.is_empty() {
                                // 将绝对路径转为安全的相对路径
                                // 如果路径包含 .. 等不安全组件，跳过该操作
                                if let Some(rel_path) =
                                    to_relative_path(file_path, &project_root)
                                {
                                    raw_ops.push((
                                        timestamp.clone(),
                                        FileOperation::Write {
                                            file_path: rel_path,
                                            content: content.to_string(),
                                        },
                                        session_file.clone(),
                                        source_uuid.clone(),
                                    ));
                                } else {
                                    log::warn!(
                                        "跳过不安全的 Write 路径: {}",
                                        file_path
                                    );
                                }
                            }
                        }
                    }
                    Some("Edit") => {
                        // 提取 Edit 工具的 file_path、old_string、new_string、replace_all
                        if let Some(input) = input {
                            let file_path = input
                                .get("file_path")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let old_string = input
                                .get("old_string")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let new_string = input
                                .get("new_string")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let replace_all = input
                                .get("replace_all")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);

                            if !file_path.is_empty() {
                                // 将绝对路径转为安全的相对路径
                                // 如果路径包含 .. 等不安全组件，跳过该操作
                                if let Some(rel_path) =
                                    to_relative_path(file_path, &project_root)
                                {
                                    raw_ops.push((
                                        timestamp.clone(),
                                        FileOperation::Edit {
                                            file_path: rel_path,
                                            old_string: old_string.to_string(),
                                            new_string: new_string.to_string(),
                                            replace_all,
                                        },
                                        session_file.clone(),
                                        source_uuid.clone(),
                                    ));
                                } else {
                                    log::warn!(
                                        "跳过不安全的 Edit 路径: {}",
                                        file_path
                                    );
                                }
                            }
                        }
                    }
                    Some("Bash") => {
                        // 提取 Bash 工具的 command 字段，解析文件操作
                        if let Some(input) = input {
                            let command = input
                                .get("command")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");

                            if !command.is_empty() {
                                let ops = parse_bash_command(command, &project_root);
                                for op in ops {
                                    raw_ops.push((
                                        timestamp.clone(),
                                        op,
                                        session_file.clone(),
                                        source_uuid.clone(),
                                    ));
                                }
                            }
                        }
                    }
                    _ => {
                        // 其他工具（如 Read、Search 等）不涉及文件修改，跳过
                    }
                }
            }
        }
    }

    // 第 5 步：按 timestamp 排序
    raw_ops.sort_by(|a, b| a.0.cmp(&b.0));

    // 第 6 步：分配全局递增 index，构建 FileOpRecord 和 FileOpSummary
    let mut operations: Vec<FileOpRecord> = Vec::with_capacity(raw_ops.len());
    let mut summaries: Vec<FileOpSummary> = Vec::with_capacity(raw_ops.len());

    for (index, (timestamp, operation, session_file, source_uuid)) in
        raw_ops.into_iter().enumerate()
    {
        // 从操作中提取摘要信息
        let (op_type, file_path) = extract_op_summary(&operation);

        summaries.push(FileOpSummary {
            index,
            timestamp: timestamp.clone(),
            op_type,
            file_path,
            session_file: session_file.clone(),
        });

        operations.push(FileOpRecord {
            index,
            timestamp,
            operation,
            session_file,
            source_uuid,
        });
    }

    let total_operations = operations.len();
    log::info!("回溯初始化完成: 共 {} 条文件操作", total_operations);

    // 构建内部状态
    let inner = RetrospectInner {
        operations,
        project_root,
        cache: LruCache::new(
            NonZeroUsize::new(CACHE_CAPACITY).expect("CACHE_CAPACITY 不能为 0"),
        ),
    };

    // 构建时间轴
    let timeline = RetrospectTimeline {
        total_operations,
        operations: summaries,
    };

    Ok((timeline, inner))
}

/// 将初始化结果存入 RetrospectState
///
/// 此函数在 command 层调用，将 init 的结果写入全局状态。
pub fn store_inner(state: &RetrospectState, inner: RetrospectInner) -> Result<(), String> {
    let mut guard = state.lock_inner()?;
    *guard = Some(inner);
    Ok(())
}

// ============================================================================
// 回放函数
// ============================================================================

/// 回放操作到指定 index，返回该时间点的 VFS 快照引用
///
/// 使用 LRU 缓存优化：
/// 1. 查找缓存中 <= target_index 的最近快照作为起点
/// 2. 如果没有缓存，从空 VFS 开始
/// 3. 逐条应用 operations[start..=target_index]
/// 4. 将结果放入 LRU 缓存
///
/// # 参数
/// - `inner` - 回溯引擎内部状态的可变引用
/// - `target_index` - 目标操作序号（0-based）
///
/// # 返回值
/// 返回目标时间点的 VFS 快照的不可变引用
///
/// # Panics
/// target_index 超出 operations 范围时会 panic（调用方需先校验）
fn replay_to_index(inner: &mut RetrospectInner, target_index: usize) -> VirtualFileSystem {
    // 首先检查缓存中是否已有目标 index 的快照
    if let Some(cached) = inner.cache.get(&target_index) {
        return cached.clone();
    }

    // 查找缓存中 <= target_index 的最近快照作为起点
    // 遍历缓存中所有 key，找最大的 <= target_index
    let mut best_start: Option<(usize, VirtualFileSystem)> = None;
    // 收集所有 key 避免借用冲突
    let keys: Vec<usize> = inner.cache.iter().map(|(k, _)| *k).collect();
    for key in keys {
        if key <= target_index {
            match &best_start {
                Some((best_key, _)) if key > *best_key => {
                    if let Some(vfs) = inner.cache.get(&key) {
                        best_start = Some((key, vfs.clone()));
                    }
                }
                None => {
                    if let Some(vfs) = inner.cache.get(&key) {
                        best_start = Some((key, vfs.clone()));
                    }
                }
                _ => {}
            }
        }
    }

    // 确定起始 VFS 和起始 index
    let (start_index, mut vfs) = match best_start {
        Some((cached_index, cached_vfs)) => {
            // 从缓存快照之后的下一条操作开始
            (cached_index + 1, cached_vfs)
        }
        None => {
            // 没有缓存，从空 VFS 开始，从第 0 条操作开始
            (0, VirtualFileSystem::new())
        }
    };

    // 逐条应用操作
    for i in start_index..=target_index {
        if i < inner.operations.len() {
            vfs.apply(&inner.operations[i].operation);
        }
    }

    // 将结果放入 LRU 缓存
    let result = vfs.clone();
    inner.cache.put(target_index, vfs);

    result
}

// ============================================================================
// 文件树构建
// ============================================================================

/// 将 VFS 的 files HashMap 转为嵌套的 FileTreeNode 树
///
/// # 算法
/// 1. 将所有文件路径按 `/` 拆分为路径段
/// 2. 使用 BTreeMap 构建中间树结构（自动排序）
/// 3. 递归转换为 FileTreeNode
///
/// # 排序规则
/// - 目录在前，文件在后
/// - 同类型内按名称字母序排列（BTreeMap 保证）
///
/// # 参数
/// - `vfs` - 虚拟文件系统快照
///
/// # 返回值
/// 根级别的 FileTreeNode 列表
fn build_file_tree(vfs: &VirtualFileSystem) -> Vec<FileTreeNode> {
    /// 中间树节点：用于构建过程
    ///
    /// 使用 BTreeMap 存储子节点，保证按名称排序
    struct TreeBuilder {
        /// 子目录映射：目录名 → 子树
        dirs: BTreeMap<String, TreeBuilder>,
        /// 文件列表：当前目录下的文件名集合
        files: BTreeMap<String, ()>,
    }

    impl TreeBuilder {
        /// 创建空的树构建器
        fn new() -> Self {
            Self {
                dirs: BTreeMap::new(),
                files: BTreeMap::new(),
            }
        }

        /// 向树中插入一个文件路径
        ///
        /// 递归地创建中间目录节点，最终在叶子位置插入文件。
        fn insert(&mut self, parts: &[&str]) {
            match parts.len() {
                0 => {
                    // 空路径，忽略
                }
                1 => {
                    // 最后一段 = 文件名
                    self.files.insert(parts[0].to_string(), ());
                }
                _ => {
                    // 中间段 = 目录名，递归进入子目录
                    let dir = self
                        .dirs
                        .entry(parts[0].to_string())
                        .or_insert_with(TreeBuilder::new);
                    dir.insert(&parts[1..]);
                }
            }
        }

        /// 将 TreeBuilder 转换为 FileTreeNode 列表
        ///
        /// 递归转换，目录在前、文件在后。
        fn to_nodes(&self, prefix: &str) -> Vec<FileTreeNode> {
            let mut nodes = Vec::new();

            // 先添加目录（BTreeMap 已按名称排序）
            for (name, builder) in &self.dirs {
                let path = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{}/{}", prefix, name)
                };
                let children = builder.to_nodes(&path);
                nodes.push(FileTreeNode {
                    name: name.clone(),
                    path,
                    node_type: "directory".to_string(),
                    children: Some(children),
                });
            }

            // 再添加文件（BTreeMap 已按名称排序）
            for (name, _) in &self.files {
                let path = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{}/{}", prefix, name)
                };
                nodes.push(FileTreeNode {
                    name: name.clone(),
                    path,
                    node_type: "file".to_string(),
                    children: None,
                });
            }

            nodes
        }
    }

    // 构建中间树
    let mut root = TreeBuilder::new();
    for file_path in vfs.files.keys() {
        let parts: Vec<&str> = file_path.split('/').collect();
        root.insert(&parts);
    }

    // 转换为 FileTreeNode 列表
    root.to_nodes("")
}

// ============================================================================
// 文件内容获取
// ============================================================================

/// 获取指定时间点的指定文件内容
///
/// # 参数
/// - `inner` - 回溯引擎内部状态
/// - `index` - 目标操作序号
/// - `file_path` - 文件相对路径（使用 `/` 分隔符）
///
/// # 返回值
/// 成功返回文件内容字符串
///
/// # 错误
/// - 文件在该时间点不存在
pub fn get_file_content(
    inner: &mut RetrospectInner,
    index: usize,
    file_path: &str,
) -> Result<String, String> {
    // 回放到目标 index
    let vfs = replay_to_index(inner, index);

    // 查找文件内容
    vfs.files
        .get(file_path)
        .cloned()
        .ok_or_else(|| format!("文件不存在: {}", file_path))
}

// ============================================================================
// 文件树和内容获取（供 commands 层调用）
// ============================================================================

/// 获取指定时间点的文件树
///
/// 供 command 层调用。先回放到目标 index，再构建文件树。
///
/// # 参数
/// - `inner` - 回溯引擎内部状态
/// - `index` - 目标操作序号
///
/// # 返回值
/// FileTreeNode 列表（根级别节点）
pub fn get_file_tree(inner: &mut RetrospectInner, index: usize) -> Vec<FileTreeNode> {
    let vfs = replay_to_index(inner, index);
    build_file_tree(&vfs)
}

// ============================================================================
// ZIP 导出
// ============================================================================

/// 收集指定时间点的文件快照（同步，在 Mutex 锁内调用）
///
/// 回放到目标 index，返回所有文件的 (路径, 内容) 列表。
/// 此函数不执行任何 I/O，只在内存中回放操作。
///
/// # 参数
/// - `inner` - 回溯引擎内部状态
/// - `index` - 目标操作序号
///
/// # 返回值
/// (相对路径, 文件内容) 的列表
pub fn collect_snapshot_files(
    inner: &mut RetrospectInner,
    index: usize,
) -> Vec<(String, String)> {
    let vfs = replay_to_index(inner, index);
    vfs.files
        .iter()
        .map(|(path, content)| (path.clone(), content.clone()))
        .collect()
}

/// 将文件列表导出为 ZIP 文件（异步，在 Mutex 锁外调用）
///
/// 使用 `zip` crate 创建 ZIP 文件，包含提供的所有文件。
/// 此函数应在释放 Mutex 锁之后调用，避免持锁执行 I/O。
///
/// # 参数
/// - `files` - (相对路径, 文件内容) 的列表
/// - `save_to` - ZIP 文件保存路径（绝对路径）
///
/// # 错误
/// - 无法创建 ZIP 文件
/// - 写入 ZIP 条目失败
pub async fn export_zip_from_files(
    files: Vec<(String, String)>,
    save_to: &str,
) -> Result<(), String> {
    // 创建 ZIP 文件（同步操作，使用 spawn_blocking 避免阻塞 async runtime）
    let save_path = save_to.to_string();
    tokio::task::spawn_blocking(move || write_zip_file(&save_path, &files))
        .await
        .map_err(|e| format!("ZIP 导出任务失败: {}", e))?
}

/// 写入 ZIP 文件的同步函数（带错误清理）
///
/// 封装 `write_zip_file_inner`，在写入失败时自动清理残留的 ZIP 文件。
///
/// # 参数
/// - `save_path` - ZIP 文件保存路径
/// - `files` - (相对路径, 文件内容) 的列表
fn write_zip_file(save_path: &str, files: &[(String, String)]) -> Result<(), String> {
    let result = write_zip_file_inner(save_path, files);
    if result.is_err() {
        // 尽力清理残留的不完整 ZIP 文件，忽略清理错误
        let _ = std::fs::remove_file(save_path);
    }
    result
}

/// 实际写入 ZIP 文件的内部同步函数
///
/// # 参数
/// - `save_path` - ZIP 文件保存路径
/// - `files` - (相对路径, 文件内容) 的列表
fn write_zip_file_inner(save_path: &str, files: &[(String, String)]) -> Result<(), String> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    // 创建输出文件
    let file = std::fs::File::create(save_path)
        .map_err(|e| format!("创建 ZIP 文件失败: {}", e))?;

    let mut zip = ZipWriter::new(file);

    // ZIP 压缩选项：使用 Deflate 算法
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // 按路径排序，确保 ZIP 内容有序
    let mut sorted_files: Vec<&(String, String)> = files.iter().collect();
    sorted_files.sort_by_key(|(path, _)| path.clone());

    // 逐个写入文件
    for (path, content) in sorted_files {
        // 安全检查：跳过包含路径遍历组件或绝对路径的条目
        if path.contains("..") || path.starts_with('/') {
            log::warn!("跳过不安全的 ZIP 路径: {}", path);
            continue;
        }

        zip.start_file(path, options)
            .map_err(|e| format!("ZIP 写入文件头失败 [{}]: {}", path, e))?;
        zip.write_all(content.as_bytes())
            .map_err(|e| format!("ZIP 写入文件内容失败 [{}]: {}", path, e))?;
    }

    // 完成 ZIP 文件
    zip.finish()
        .map_err(|e| format!("ZIP 文件结束失败: {}", e))?;

    Ok(())
}

// ============================================================================
// 清理函数
// ============================================================================

/// 清理回溯状态，释放内存
///
/// 将 inner 重置为 None，释放所有操作记录和 VFS 缓存。
pub fn cleanup(state: &RetrospectState) -> Result<(), String> {
    let mut guard = state.lock_inner()?;
    *guard = None;
    log::info!("回溯状态已清理");
    Ok(())
}

// ============================================================================
// 辅助函数：路径处理
// ============================================================================

/// 将绝对路径转为相对于项目根目录的路径
///
/// # 路径规范化规则
/// 1. 将 Windows 反斜杠 `\` 统一转为正斜杠 `/`
/// 2. 尝试去掉 project_root 前缀
/// 3. 如果路径不以 project_root 开头，保留原始路径（但仍做反斜杠转换）
/// 4. 最终通过 `sanitize_relative_path` 验证路径安全性
///
/// # 返回值
/// - `Some(relative_path)` - 安全的相对路径
/// - `None` - 路径包含 `..` 等不安全组件，应跳过该操作
///
/// # 示例
/// ```text
/// to_relative_path(r"G:\Projects\Test\src\App.tsx", r"G:\Projects\Test") → Some("src/App.tsx")
/// to_relative_path(r"../../../etc/passwd", r"G:\Projects\Test") → None
/// ```
fn to_relative_path(abs_path: &str, project_root: &str) -> Option<String> {
    // 统一将反斜杠转为正斜杠
    let normalized_path = abs_path.replace('\\', "/");
    let normalized_root = project_root.replace('\\', "/");

    // 尝试去掉 project_root 前缀
    let raw_relative = if let Some(rel) = normalized_path.strip_prefix(&normalized_root) {
        // 去掉开头的 `/`
        let rel = rel.strip_prefix('/').unwrap_or(rel);
        if rel.is_empty() {
            // 路径就是项目根目录本身
            normalized_path
        } else {
            rel.to_string()
        }
    } else {
        // 路径不在项目根目录下，保留原始路径（已规范化）
        normalized_path
    };

    // 使用 sanitize_relative_path 验证路径安全性
    sanitize_relative_path(&raw_relative)
}

/// 清洗相对路径：拒绝包含 `..` 路径组件的路径
///
/// 防止路径遍历攻击：恶意 JSONL 中可能包含 `../../../etc/passwd` 等路径。
/// 如果路径包含 `..` 组件，返回 None（该操作将被跳过）。
///
/// # 处理规则
/// - 空段（连续的 `/`）和 `.`（当前目录）被忽略
/// - `..`（父目录）导致整个路径被拒绝
/// - 其他路径段正常保留
///
/// # 参数
/// - `path` - 待清洗的相对路径字符串
///
/// # 返回值
/// - `Some(clean_path)` - 清洗后的安全路径
/// - `None` - 路径包含不安全组件
fn sanitize_relative_path(path: &str) -> Option<String> {
    let parts: Vec<&str> = path.split('/').collect();
    let mut clean = Vec::new();
    for part in parts {
        match part {
            "" | "." => continue,       // 跳过空段和当前目录引用
            ".." => return None,        // 拒绝包含 .. 的路径
            _ => clean.push(part),      // 保留正常路径段
        }
    }
    if clean.is_empty() {
        None
    } else {
        Some(clean.join("/"))
    }
}

/// 从 FileOperation 中提取摘要信息（操作类型和主文件路径）
///
/// # 返回值
/// (op_type, file_path) 元组
fn extract_op_summary(op: &FileOperation) -> (String, String) {
    match op {
        FileOperation::Write { file_path, .. } => ("write".to_string(), file_path.clone()),
        FileOperation::Edit { file_path, .. } => ("edit".to_string(), file_path.clone()),
        FileOperation::BashMove { from, .. } => ("bash_move".to_string(), from.clone()),
        FileOperation::BashCopy { from, .. } => ("bash_copy".to_string(), from.clone()),
        FileOperation::BashDelete { file_path } => {
            ("bash_delete".to_string(), file_path.clone())
        }
        FileOperation::BashMkdir { dir_path } => ("bash_mkdir".to_string(), dir_path.clone()),
    }
}

// ============================================================================
// Bash 命令解析
// ============================================================================

/// 解析 Bash 命令中的文件操作
///
/// 尽力解析简单的文件操作命令。对于复杂的管道、条件、循环等不做处理。
///
/// # 支持的命令模式
/// - `rm [-rf] <path>`：删除文件/目录
/// - `mv <source> <dest>`：移动文件
/// - `cp [-r] <source> <dest>`：复制文件
/// - `mkdir [-p] <path>`：创建目录
///
/// # 命令拆分
/// 支持 `&&`、`||`、`;` 分隔的多命令行，逐个解析。
///
/// # 参数
/// - `command` - Bash 命令字符串
/// - `project_root` - 项目根目录路径
///
/// # 返回值
/// 解析出的 FileOperation 列表（可能为空）
fn parse_bash_command(command: &str, project_root: &str) -> Vec<FileOperation> {
    let mut ops = Vec::new();

    // 用 &&、||、; 拆分多命令行
    // 注意：这是简化处理，不会正确处理引号内的分隔符
    let sub_commands = split_bash_commands(command);

    for cmd in sub_commands {
        let cmd = cmd.trim();
        if cmd.is_empty() {
            continue;
        }

        // 解析各种文件操作命令
        if let Some(op) = parse_rm_command(cmd, project_root) {
            ops.push(op);
        } else if let Some(op) = parse_mv_command(cmd, project_root) {
            ops.push(op);
        } else if let Some(op) = parse_cp_command(cmd, project_root) {
            ops.push(op);
        } else if let Some(op) = parse_mkdir_command(cmd, project_root) {
            ops.push(op);
        }
    }

    ops
}

/// 将 Bash 命令按 &&、||、; 拆分为子命令
///
/// # 注意事项
/// 简化实现，不处理引号内的分隔符。
/// 对于绝大多数 Claude Code 生成的命令，这足够准确。
fn split_bash_commands(command: &str) -> Vec<&str> {
    // 先按 && 拆分
    let mut parts: Vec<&str> = Vec::new();
    for part in command.split("&&") {
        // 再按 || 拆分
        for part2 in part.split("||") {
            // 再按 ; 拆分
            for part3 in part2.split(';') {
                let trimmed = part3.trim();
                if !trimmed.is_empty() {
                    parts.push(trimmed);
                }
            }
        }
    }
    parts
}

/// 清理路径：去掉引号、处理转义、转换路径分隔符
///
/// # 处理规则
/// 1. 去掉首尾的单引号或双引号
/// 2. 统一反斜杠为正斜杠
/// 3. 转为相对路径并进行安全性验证
///
/// # 返回值
/// - `Some(clean_path)` - 清理后的安全相对路径
/// - `None` - 路径包含不安全组件（如 `..`），应跳过
fn clean_path(raw: &str, project_root: &str) -> Option<String> {
    let mut path = raw.trim().to_string();

    // 去掉首尾引号
    if (path.starts_with('"') && path.ends_with('"'))
        || (path.starts_with('\'') && path.ends_with('\''))
    {
        path = path[1..path.len() - 1].to_string();
    }

    // 转为相对路径（内部会进行路径安全性验证）
    to_relative_path(&path, project_root)
}

/// 解析 rm 命令
///
/// 匹配模式：`rm [-rfv]* <path>`
/// 使用预编译的 `RE_RM` 正则进行匹配。
///
/// # 返回值
/// 成功解析返回 `Some(FileOperation::BashDelete)`，否则 `None`
fn parse_rm_command(cmd: &str, project_root: &str) -> Option<FileOperation> {
    // 使用预编译正则匹配 rm 命令
    let caps = RE_RM.captures(cmd)?;

    // 提取路径（caps[2]）
    let path_str = caps.get(2)?.as_str().trim();

    // 如果路径包含通配符 *，跳过（太复杂）
    if path_str.contains('*') {
        return None;
    }

    // 清理路径并验证安全性（包含 .. 的路径会返回 None）
    let file_path = clean_path(path_str, project_root)?;
    Some(FileOperation::BashDelete { file_path })
}

/// 解析 mv 命令
///
/// 匹配模式：`mv [-fv]* <source> <dest>`
/// 使用预编译的 `RE_MV` 正则进行匹配。
///
/// # 返回值
/// 成功解析返回 `Some(FileOperation::BashMove)`，否则 `None`
fn parse_mv_command(cmd: &str, project_root: &str) -> Option<FileOperation> {
    // 使用预编译正则匹配 mv 命令
    let caps = RE_MV.captures(cmd)?;

    // 清理源路径和目标路径（包含 .. 的路径会导致整个操作被跳过）
    let from = clean_path(caps.get(2)?.as_str(), project_root)?;
    let to = clean_path(caps.get(3)?.as_str(), project_root)?;

    Some(FileOperation::BashMove { from, to })
}

/// 解析 cp 命令
///
/// 匹配模式：`cp [-rfv]* <source> <dest>`
/// 使用预编译的 `RE_CP` 正则进行匹配。
///
/// # 返回值
/// 成功解析返回 `Some(FileOperation::BashCopy)`，否则 `None`
fn parse_cp_command(cmd: &str, project_root: &str) -> Option<FileOperation> {
    // 使用预编译正则匹配 cp 命令
    let caps = RE_CP.captures(cmd)?;

    // 清理源路径和目标路径（包含 .. 的路径会导致整个操作被跳过）
    let from = clean_path(caps.get(2)?.as_str(), project_root)?;
    let to = clean_path(caps.get(3)?.as_str(), project_root)?;

    Some(FileOperation::BashCopy { from, to })
}

/// 解析 mkdir 命令
///
/// 匹配模式：`mkdir [-p]* <path>`
/// 使用预编译的 `RE_MKDIR` 正则进行匹配。
///
/// # 返回值
/// 成功解析返回 `Some(FileOperation::BashMkdir)`，否则 `None`
fn parse_mkdir_command(cmd: &str, project_root: &str) -> Option<FileOperation> {
    // 使用预编译正则匹配 mkdir 命令
    let caps = RE_MKDIR.captures(cmd)?;

    // 清理路径并验证安全性（包含 .. 的路径会返回 None）
    let dir_path = clean_path(caps.get(2)?.as_str().trim(), project_root)?;

    Some(FileOperation::BashMkdir { dir_path })
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试路径转换：Windows 绝对路径 → 相对路径
    #[test]
    fn test_to_relative_path_windows() {
        let result = to_relative_path(
            r"G:\ClaudeProjects\Test\src\App.tsx",
            r"G:\ClaudeProjects\Test",
        );
        assert_eq!(result, Some("src/App.tsx".to_string()));
    }

    /// 测试路径转换：已经是相对路径（不在项目根下）
    #[test]
    fn test_to_relative_path_outside_project() {
        let result = to_relative_path(
            r"C:\Other\file.txt",
            r"G:\ClaudeProjects\Test",
        );
        assert_eq!(result, Some("C:/Other/file.txt".to_string()));
    }

    /// 测试路径清洗：拒绝包含 .. 的路径遍历攻击
    #[test]
    fn test_sanitize_relative_path_rejects_traversal() {
        // 包含 .. 的路径应该返回 None
        assert_eq!(sanitize_relative_path("../../../etc/passwd"), None);
        assert_eq!(sanitize_relative_path("src/../../../etc/passwd"), None);
        assert_eq!(sanitize_relative_path(".."), None);
    }

    /// 测试路径清洗：接受安全路径
    #[test]
    fn test_sanitize_relative_path_accepts_safe() {
        assert_eq!(
            sanitize_relative_path("src/main.rs"),
            Some("src/main.rs".to_string())
        );
        assert_eq!(
            sanitize_relative_path("./src/main.rs"),
            Some("src/main.rs".to_string())
        );
        assert_eq!(
            sanitize_relative_path("src//main.rs"),
            Some("src/main.rs".to_string())
        );
    }

    /// 测试路径清洗：空路径返回 None
    #[test]
    fn test_sanitize_relative_path_empty() {
        assert_eq!(sanitize_relative_path(""), None);
        assert_eq!(sanitize_relative_path("."), None);
        assert_eq!(sanitize_relative_path("./"), None);
    }

    /// 测试 to_relative_path 对包含 .. 的路径返回 None
    #[test]
    fn test_to_relative_path_rejects_traversal() {
        let result = to_relative_path(
            "../../../etc/passwd",
            r"G:\ClaudeProjects\Test",
        );
        assert_eq!(result, None);
    }

    /// 测试 VFS Write 操作
    #[test]
    fn test_vfs_write() {
        let mut vfs = VirtualFileSystem::new();
        vfs.apply(&FileOperation::Write {
            file_path: "src/main.rs".to_string(),
            content: "fn main() {}".to_string(),
        });
        assert_eq!(
            vfs.files.get("src/main.rs"),
            Some(&"fn main() {}".to_string())
        );
    }

    /// 测试 VFS Edit 操作（单次替换）
    #[test]
    fn test_vfs_edit_single() {
        let mut vfs = VirtualFileSystem::new();
        vfs.apply(&FileOperation::Write {
            file_path: "test.txt".to_string(),
            content: "hello hello world".to_string(),
        });
        vfs.apply(&FileOperation::Edit {
            file_path: "test.txt".to_string(),
            old_string: "hello".to_string(),
            new_string: "hi".to_string(),
            replace_all: false,
        });
        assert_eq!(
            vfs.files.get("test.txt"),
            Some(&"hi hello world".to_string())
        );
    }

    /// 测试 VFS Edit 操作（全局替换）
    #[test]
    fn test_vfs_edit_replace_all() {
        let mut vfs = VirtualFileSystem::new();
        vfs.apply(&FileOperation::Write {
            file_path: "test.txt".to_string(),
            content: "hello hello world".to_string(),
        });
        vfs.apply(&FileOperation::Edit {
            file_path: "test.txt".to_string(),
            old_string: "hello".to_string(),
            new_string: "hi".to_string(),
            replace_all: true,
        });
        assert_eq!(
            vfs.files.get("test.txt"),
            Some(&"hi hi world".to_string())
        );
    }

    /// 测试 VFS BashMove 操作
    #[test]
    fn test_vfs_move() {
        let mut vfs = VirtualFileSystem::new();
        vfs.apply(&FileOperation::Write {
            file_path: "old.txt".to_string(),
            content: "content".to_string(),
        });
        vfs.apply(&FileOperation::BashMove {
            from: "old.txt".to_string(),
            to: "new.txt".to_string(),
        });
        assert!(!vfs.files.contains_key("old.txt"));
        assert_eq!(
            vfs.files.get("new.txt"),
            Some(&"content".to_string())
        );
        assert!(vfs.deleted.contains("old.txt"));
    }

    /// 测试 VFS BashDelete 操作
    #[test]
    fn test_vfs_delete() {
        let mut vfs = VirtualFileSystem::new();
        vfs.apply(&FileOperation::Write {
            file_path: "file.txt".to_string(),
            content: "content".to_string(),
        });
        vfs.apply(&FileOperation::BashDelete {
            file_path: "file.txt".to_string(),
        });
        assert!(!vfs.files.contains_key("file.txt"));
        assert!(vfs.deleted.contains("file.txt"));
    }

    /// 测试 Bash 命令拆分
    #[test]
    fn test_split_bash_commands() {
        let parts = split_bash_commands("mkdir -p src && rm old.txt; cp a.txt b.txt");
        assert_eq!(parts.len(), 3);
    }

    /// 测试文件树构建
    #[test]
    fn test_build_file_tree() {
        let mut vfs = VirtualFileSystem::new();
        vfs.files.insert("src/main.rs".to_string(), String::new());
        vfs.files
            .insert("src/lib.rs".to_string(), String::new());
        vfs.files
            .insert("Cargo.toml".to_string(), String::new());

        let tree = build_file_tree(&vfs);
        // 根级别应该有：src（目录）和 Cargo.toml（文件）
        assert_eq!(tree.len(), 2);
        // 第一个应该是目录 src
        assert_eq!(tree[0].name, "src");
        assert_eq!(tree[0].node_type, "directory");
        // 第二个应该是文件 Cargo.toml
        assert_eq!(tree[1].name, "Cargo.toml");
        assert_eq!(tree[1].node_type, "file");
    }

    /// 测试 rm 命令解析
    #[test]
    fn test_parse_rm() {
        let op = parse_rm_command("rm -rf src/old", "/project").unwrap();
        match op {
            FileOperation::BashDelete { file_path } => {
                assert_eq!(file_path, "src/old");
            }
            _ => panic!("期望 BashDelete"),
        }
    }

    /// 测试 mv 命令解析
    #[test]
    fn test_parse_mv() {
        let op = parse_mv_command("mv src/old.txt src/new.txt", "/project").unwrap();
        match op {
            FileOperation::BashMove { from, to } => {
                assert_eq!(from, "src/old.txt");
                assert_eq!(to, "src/new.txt");
            }
            _ => panic!("期望 BashMove"),
        }
    }
}
