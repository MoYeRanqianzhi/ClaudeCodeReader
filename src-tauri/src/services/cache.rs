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
//! 搜索文本（小写化）在 transform 阶段预计算，缓存在 Rust 端。
//! 前端发起搜索时，Rust 使用 `memchr::memmem` SIMD 加速在缓存文本上执行子串搜索，
//! 仅返回匹配的 display_id 列表，避免大量文本通过 IPC 传输。

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Instant, SystemTime};

use rayon::prelude::*;

use crate::models::display::TransformedSession;
use crate::models::project::Project;

/// 项目列表缓存的默认有效期（秒）
///
/// 在此时间内重复调用 `scan_projects` 将直接返回缓存数据，不再重新扫描文件系统。
/// 用户可以通过显式刷新操作强制重新扫描。
const PROJECT_CACHE_TTL_SECS: u64 = 30;

/// 会话缓存的最大容量
///
/// 最多缓存这么多个会话的转换结果和搜索文本。当缓存满时，最久未访问的会话将被淘汰。
const SESSION_CACHE_MAX_ENTRIES: usize = 20;

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
/// 存储 TransformedSession（IPC 返回数据）和搜索文本（不序列化到前端）。
/// 搜索文本 `search_texts[i]` 对应 `transformed.display_messages[i]` 的小写化可搜索文本。
struct SessionCacheEntry {
    /// IPC 返回的转换结果
    transformed: TransformedSession,
    /// 小写化搜索文本（不传给前端，仅用于 Rust 端搜索）
    search_texts: Vec<String>,
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
    /// - `search_texts` - 小写化的搜索文本列表
    pub fn set_session(
        &self,
        file_path: &str,
        transformed: TransformedSession,
        search_texts: Vec<String>,
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

    /// 在缓存的搜索文本上执行 SIMD 加速子串搜索
    ///
    /// 使用 `memchr::memmem::Finder` 在预计算的小写化搜索文本上执行搜索，
    /// 利用 SIMD 指令加速子串匹配。
    ///
    /// # 参数
    /// - `file_path` - 会话 JSONL 文件的绝对路径
    /// - `query` - 搜索查询词（将被小写化）
    ///
    /// # 返回值
    /// - `Some(display_ids)` - 匹配的 display_id 列表
    /// - `None` - 缓存中没有该会话的数据
    pub fn search_in_cache(
        &self,
        file_path: &str,
        query: &str,
    ) -> Option<Vec<String>> {
        let cache = self.sessions.read().ok()?;
        let entry = cache.entries.get(file_path)?;

        // 将查询词小写化（搜索文本已预计算为小写）
        let needle = query.to_lowercase();
        let finder = memchr::memmem::Finder::new(needle.as_bytes());

        let dm = &entry.transformed.display_messages;

        // 使用 rayon 并行搜索所有搜索文本
        let results: Vec<String> = entry
            .search_texts
            .par_iter()
            .enumerate()
            .filter(|(_, text)| finder.find(text.as_bytes()).is_some())
            .map(|(i, _)| dm[i].display_id.clone())
            .collect();

        Some(results)
    }
}

impl Default for AppCache {
    fn default() -> Self {
        Self::new()
    }
}
