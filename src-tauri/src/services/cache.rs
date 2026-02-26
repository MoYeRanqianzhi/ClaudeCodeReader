//! # 内存缓存管理服务
//!
//! 提供基于内存的缓存层，减少重复的文件系统 I/O 操作：
//! - **项目列表缓存**：存储上次扫描结果，带时间戳用于判断有效性
//! - **会话缓存**：LRU 缓存最近查看的会话转换结果和搜索文本
//!
//! ## 缓存失效策略
//! - 项目列表缓存：基于 TTL（生存时间），超过阈值后重新扫描
//! - 会话缓存：基于文件 mtime（最后修改时间），文件变化时重新解析
//!
//! ## 线程安全
//! 使用 `std::sync::RwLock` 保证多线程安全访问。
//! Tauri 的 command 可能在不同线程上并发执行，RwLock 允许多个读操作并发进行。
//!
//! ## 搜索架构
//! 搜索文本在 transform 阶段预计算并以双版本形式缓存在 Rust 端：
//! - `search_texts`：小写化版本，用于大小写不敏感搜索（`memchr::memmem` SIMD 加速）
//! - `original_texts`：原始大小写版本，用于大小写敏感搜索和正则表达式搜索
//!
//! `search_in_cache` 支持以下 4 种搜索模式（通过 `case_sensitive` 和 `use_regex` 参数控制）：
//! 1. **正则 + 大小写不敏感**：`(?i)pattern` 正则，在 `original_texts` 上匹配
//! 2. **正则 + 大小写敏感**：`pattern` 正则，在 `original_texts` 上匹配
//! 3. **字面量 + 大小写敏感**：`memchr::memmem` 在 `original_texts` 上精确匹配
//! 4. **字面量 + 大小写不敏感**：`memchr::memmem` 在 `search_texts`（已小写）上匹配
//!
//! 小数组（< `PARALLEL_THRESHOLD`）使用顺序迭代，大数组使用 rayon 并行迭代。

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Instant, SystemTime};

use rayon::prelude::*;

use crate::models::display::TransformedSession;
use crate::models::project::Project;
use crate::services::file_guard::TempBackupEntry;

/// 项目列表缓存的默认有效期（秒）
///
/// 在此时间内重复调用 `scan_projects` 将直接返回缓存数据，不再重新扫描文件系统。
/// 用户可以通过显式刷新操作强制重新扫描。
const PROJECT_CACHE_TTL_SECS: u64 = 30;

/// 会话缓存的最大容量
///
/// 最多缓存这么多个会话的转换结果和搜索文本。当缓存满时，最久未访问的会话将被淘汰。
const SESSION_CACHE_MAX_ENTRIES: usize = 20;

/// 并行搜索的数组长度阈值
///
/// 当 display_messages 数量小于此阈值时，使用顺序迭代（`.iter()`）搜索；
/// 否则使用 rayon 并行迭代（`.par_iter()`）搜索。
///
/// 对于小数组，并行化的线程调度开销会超过实际计算收益，
/// 因此小数组场景下顺序搜索反而更快。
const PARALLEL_THRESHOLD: usize = 100;

/// 应用全局缓存状态
///
/// 通过 Tauri 的 `manage()` 方法注册为应用状态，
/// 所有 command 函数可以通过 `State<AppCache>` 参数访问。
///
/// # 线程安全
/// 内部使用 `RwLock` 包装，支持多读单写的并发访问模式。
pub struct AppCache {
    /// 项目列表缓存：存储最近一次完整扫描的结果和扫描时间
    projects: RwLock<Option<ProjectCacheEntry>>,

    /// 会话缓存：以文件路径为 key，缓存转换后的 TransformedSession 和搜索文本
    /// 每个缓存条目记录了文件的 mtime，用于检测文件是否被外部修改
    sessions: RwLock<SessionCache>,

    /// 临时备份注册表：记录本次应用运行期间所有临时备份的映射关系
    /// 应用关闭后注册表清空，但 TEMP 目录下的备份文件仍由 OS 管理
    temp_backups: RwLock<Vec<TempBackupEntry>>,
}

/// 项目列表缓存条目
struct ProjectCacheEntry {
    /// 缓存的项目数据
    data: Vec<Project>,
    /// 缓存创建的时间点（用于 TTL 判断）
    cached_at: Instant,
}

/// 会话缓存
///
/// 简化版 LRU 缓存实现，使用 HashMap 存储数据，
/// 通过 `last_accessed` 时间戳实现 LRU 淘汰策略。
struct SessionCache {
    /// 缓存条目映射：文件路径 → 缓存条目
    entries: HashMap<String, SessionCacheEntry>,
}

/// 单个会话缓存条目
///
/// 存储 TransformedSession（IPC 返回数据）和两个版本的搜索文本（不序列化到前端）。
/// `search_texts[i]` 和 `original_texts[i]` 均对应 `transformed.display_messages[i]`。
struct SessionCacheEntry {
    /// IPC 返回的转换结果
    transformed: TransformedSession,
    /// 小写化搜索文本（不传给前端，用于大小写不敏感搜索）
    search_texts: Vec<String>,
    /// 原始大小写搜索文本（用于大小写敏感和正则搜索模式）
    original_texts: Vec<String>,
    /// 文件的最后修改时间（用于判断缓存是否仍然有效）
    file_mtime: SystemTime,
    /// 最后访问时间（用于 LRU 淘汰）
    last_accessed: Instant,
}

impl AppCache {
    /// 创建新的空缓存实例
    pub fn new() -> Self {
        Self {
            projects: RwLock::new(None),
            sessions: RwLock::new(SessionCache {
                entries: HashMap::new(),
            }),
            temp_backups: RwLock::new(Vec::new()),
        }
    }

    // ======== 项目列表缓存方法 ========

    /// 获取缓存的项目列表（如果缓存仍然有效）
    ///
    /// # 返回值
    /// - `Some(projects)` - 缓存有效时返回缓存数据的克隆
    /// - `None` - 缓存无效（不存在或已过期）时返回 None
    pub fn get_projects(&self) -> Option<Vec<Project>> {
        let cache = self.projects.read().ok()?;
        let entry = cache.as_ref()?;

        // 检查缓存是否在 TTL 内
        if entry.cached_at.elapsed().as_secs() <= PROJECT_CACHE_TTL_SECS {
            Some(entry.data.clone())
        } else {
            None
        }
    }

    /// 更新项目列表缓存
    ///
    /// # 参数
    /// - `projects` - 新的项目列表数据
    pub fn set_projects(&self, projects: Vec<Project>) {
        if let Ok(mut cache) = self.projects.write() {
            *cache = Some(ProjectCacheEntry {
                data: projects,
                cached_at: Instant::now(),
            });
        }
    }

    /// 使项目列表缓存失效
    ///
    /// 在执行修改操作（如删除会话）后调用，确保下次查询会重新扫描
    pub fn invalidate_projects(&self) {
        if let Ok(mut cache) = self.projects.write() {
            *cache = None;
        }
    }

    // ======== 会话缓存方法 ========

    /// 获取缓存的会话转换结果（如果缓存仍然有效）
    ///
    /// 通过比对文件 mtime 判断缓存是否有效：
    /// - 如果文件未被修改，直接返回缓存数据
    /// - 如果文件已被修改（mtime 变化），返回 None 表示需要重新读取
    ///
    /// # 参数
    /// - `file_path` - 会话 JSONL 文件的绝对路径
    ///
    /// # 返回值
    /// - `Some(transformed)` - 缓存有效时返回 TransformedSession 的克隆
    /// - `None` - 缓存无效时返回 None
    pub fn get_session(&self, file_path: &str) -> Option<TransformedSession> {
        let mut cache = self.sessions.write().ok()?;
        let entry = cache.entries.get_mut(file_path)?;

        // 检查文件是否被外部修改
        let current_mtime = std::fs::metadata(file_path).ok()?.modified().ok()?;

        if current_mtime == entry.file_mtime {
            // 更新最后访问时间（LRU）
            entry.last_accessed = Instant::now();
            Some(entry.transformed.clone())
        } else {
            // 文件已被修改，缓存失效
            cache.entries.remove(file_path);
            None
        }
    }

    /// 更新会话缓存
    ///
    /// 如果缓存已满，先淘汰最久未访问的条目。
    ///
    /// # 参数
    /// - `file_path` - 会话 JSONL 文件的绝对路径
    /// - `transformed` - 转换后的 TransformedSession
    /// - `search_texts` - 小写化的搜索文本列表（用于大小写不敏感搜索）
    /// - `original_texts` - 原始大小写搜索文本列表（用于大小写敏感和正则搜索）
    pub fn set_session(
        &self,
        file_path: &str,
        transformed: TransformedSession,
        search_texts: Vec<String>,
        original_texts: Vec<String>,
    ) {
        if let Ok(mut cache) = self.sessions.write() {
            // 获取文件的当前 mtime
            let file_mtime = std::fs::metadata(file_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(SystemTime::UNIX_EPOCH);

            // 如果缓存已满且不是更新现有条目，淘汰最久未访问的条目
            if cache.entries.len() >= SESSION_CACHE_MAX_ENTRIES
                && !cache.entries.contains_key(file_path)
            {
                // 找到最久未访问的条目并移除
                if let Some(oldest_key) = cache
                    .entries
                    .iter()
                    .min_by_key(|(_, entry)| entry.last_accessed)
                    .map(|(key, _)| key.clone())
                {
                    cache.entries.remove(&oldest_key);
                }
            }

            cache.entries.insert(
                file_path.to_string(),
                SessionCacheEntry {
                    transformed,
                    search_texts,
                    original_texts,
                    file_mtime,
                    last_accessed: Instant::now(),
                },
            );
        }
    }

    /// 使指定会话的缓存失效
    ///
    /// 在消息被编辑或删除后调用
    ///
    /// # 参数
    /// - `file_path` - 会话 JSONL 文件的绝对路径
    pub fn invalidate_session(&self, file_path: &str) {
        if let Ok(mut cache) = self.sessions.write() {
            cache.entries.remove(file_path);
        }
    }

    /// 在缓存的搜索文本上执行搜索，支持 4 种搜索模式
    ///
    /// 根据 `case_sensitive` 和 `use_regex` 参数的组合，选择不同的搜索策略：
    ///
    /// | use_regex | case_sensitive | 搜索文本        | 方法                  |
    /// |-----------|----------------|-----------------|----------------------|
    /// | true      | false          | original_texts  | regex `(?i)pattern`  |
    /// | true      | true           | original_texts  | regex `pattern`      |
    /// | false     | true           | original_texts  | memchr::memmem 精确  |
    /// | false     | false          | search_texts    | memchr::memmem 小写  |
    ///
    /// 小数组（< `PARALLEL_THRESHOLD`）使用顺序迭代，大数组使用 rayon 并行迭代。
    ///
    /// # 参数
    /// - `file_path` - 会话 JSONL 文件的绝对路径
    /// - `query` - 搜索查询词
    /// - `case_sensitive` - 是否大小写敏感
    /// - `use_regex` - 是否使用正则表达式模式
    ///
    /// # 返回值
    /// - `Ok(Some(display_ids))` - 匹配的 display_id 列表
    /// - `Ok(None)` - 缓存中没有该会话的数据
    /// - `Err(msg)` - 正则表达式编译失败，msg 为错误描述
    pub fn search_in_cache(
        &self,
        file_path: &str,
        query: &str,
        case_sensitive: bool,
        use_regex: bool,
    ) -> Result<Option<Vec<String>>, String> {
        // 获取缓存读锁，缓存不存在时返回 Ok(None)
        let cache = self.sessions.read().map_err(|e| format!("缓存读锁获取失败: {}", e))?;
        let entry = match cache.entries.get(file_path) {
            Some(e) => e,
            None => return Ok(None),
        };

        let dm = &entry.transformed.display_messages;
        // 元素数量决定使用顺序还是并行搜索
        let n = entry.search_texts.len();

        if use_regex {
            // ---- 正则表达式搜索模式 ----
            // 根据大小写敏感选项构建正则表达式 pattern
            let pattern = if case_sensitive {
                // 大小写敏感：直接使用原始 query 作为 pattern
                query.to_string()
            } else {
                // 大小写不敏感：在 pattern 前加 `(?i)` 修饰符
                format!("(?i){}", query)
            };

            // 编译正则表达式，失败时返回 Err
            let re = regex::Regex::new(&pattern)
                .map_err(|e| format!("无效正则表达式: {}", e))?;

            // 在 original_texts 上执行正则匹配（保留原始大小写供 regex 处理）
            let results: Vec<String> = if n < PARALLEL_THRESHOLD {
                // 小数组：顺序迭代，避免并行化开销
                entry
                    .original_texts
                    .iter()
                    .enumerate()
                    .filter(|(_, text)| re.is_match(text))
                    .map(|(i, _)| dm[i].display_id.clone())
                    .collect()
            } else {
                // 大数组：rayon 并行迭代，利用多核加速
                entry
                    .original_texts
                    .par_iter()
                    .enumerate()
                    .filter(|(_, text)| re.is_match(text))
                    .map(|(i, _)| dm[i].display_id.clone())
                    .collect()
            };

            Ok(Some(results))
        } else if case_sensitive {
            // ---- 字面量 + 大小写敏感搜索 ----
            // 使用 memchr::memmem::find 在 original_texts 上精确匹配（needle 不小写化）
            let needle = query.as_bytes();

            let results: Vec<String> = if n < PARALLEL_THRESHOLD {
                // 小数组：顺序迭代
                entry
                    .original_texts
                    .iter()
                    .enumerate()
                    .filter(|(_, text)| memchr::memmem::find(text.as_bytes(), needle).is_some())
                    .map(|(i, _)| dm[i].display_id.clone())
                    .collect()
            } else {
                // 大数组：rayon 并行迭代
                entry
                    .original_texts
                    .par_iter()
                    .enumerate()
                    .filter(|(_, text)| memchr::memmem::find(text.as_bytes(), needle).is_some())
                    .map(|(i, _)| dm[i].display_id.clone())
                    .collect()
            };

            Ok(Some(results))
        } else {
            // ---- 字面量 + 大小写不敏感搜索（原有逻辑）----
            // 在预计算的小写化 search_texts 上匹配，needle 也需小写化
            let needle_lower = query.to_lowercase();
            let needle = needle_lower.as_bytes();

            let results: Vec<String> = if n < PARALLEL_THRESHOLD {
                // 小数组：顺序迭代
                entry
                    .search_texts
                    .iter()
                    .enumerate()
                    .filter(|(_, text)| memchr::memmem::find(text.as_bytes(), needle).is_some())
                    .map(|(i, _)| dm[i].display_id.clone())
                    .collect()
            } else {
                // 大数组：rayon 并行迭代，SIMD memchr 加速
                entry
                    .search_texts
                    .par_iter()
                    .enumerate()
                    .filter(|(_, text)| memchr::memmem::find(text.as_bytes(), needle).is_some())
                    .map(|(i, _)| dm[i].display_id.clone())
                    .collect()
            };

            Ok(Some(results))
        }
    }

    // ======== 临时备份注册表方法 ========

    /// 注册一条临时备份记录
    ///
    /// 由 `file_guard` 在创建临时备份后调用。
    pub fn register_temp_backup(&self, entry: TempBackupEntry) {
        if let Ok(mut backups) = self.temp_backups.write() {
            backups.push(entry);
        }
    }

    /// 获取所有临时备份记录（供前端展示）
    ///
    /// 返回本次应用运行期间所有临时备份的完整列表。
    pub fn get_all_temp_backups(&self) -> Vec<TempBackupEntry> {
        self.temp_backups
            .read()
            .map(|backups| backups.clone())
            .unwrap_or_default()
    }
}

impl Default for AppCache {
    fn default() -> Self {
        Self::new()
    }
}
