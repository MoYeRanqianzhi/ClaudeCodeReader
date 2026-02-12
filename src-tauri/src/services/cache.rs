//! # 内存缓存管理服务
//!
//! 提供基于内存的缓存层，减少重复的文件系统 I/O 操作：
//! - **项目列表缓存**：存储上次扫描结果，带时间戳用于判断有效性
//! - **会话消息缓存**：LRU 缓存最近查看的会话消息
//!
//! ## 缓存失效策略
//! - 项目列表缓存：基于 TTL（生存时间），超过阈值后重新扫描
//! - 会话消息缓存：基于文件 mtime（最后修改时间），文件变化时重新解析
//!
//! ## 线程安全
//! 使用 `std::sync::RwLock` 保证多线程安全访问。
//! Tauri 的 command 可能在不同线程上并发执行，RwLock 允许多个读操作并发进行。

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Instant, SystemTime};

use crate::models::message::SessionMessage;
use crate::models::project::Project;

/// 项目列表缓存的默认有效期（秒）
///
/// 在此时间内重复调用 `scan_projects` 将直接返回缓存数据，不再重新扫描文件系统。
/// 用户可以通过显式刷新操作强制重新扫描。
const PROJECT_CACHE_TTL_SECS: u64 = 30;

/// 会话消息 LRU 缓存的最大容量
///
/// 最多缓存这么多个会话的消息数据。当缓存满时，最久未访问的会话将被淘汰。
const MESSAGE_CACHE_MAX_ENTRIES: usize = 20;

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

    /// 会话消息缓存：以文件路径为 key，缓存解析后的消息数据
    /// 每个缓存条目记录了文件的 mtime，用于检测文件是否被外部修改
    messages: RwLock<MessageCache>,
}

/// 项目列表缓存条目
struct ProjectCacheEntry {
    /// 缓存的项目数据
    data: Vec<Project>,
    /// 缓存创建的时间点（用于 TTL 判断）
    cached_at: Instant,
}

/// 会话消息缓存
///
/// 简化版 LRU 缓存实现，使用 HashMap 存储数据，
/// 通过 `last_accessed` 时间戳实现 LRU 淘汰策略。
struct MessageCache {
    /// 缓存条目映射：文件路径 → 缓存条目
    entries: HashMap<String, MessageCacheEntry>,
}

/// 单个会话消息缓存条目
struct MessageCacheEntry {
    /// 缓存的消息数据
    data: Vec<SessionMessage>,
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
            messages: RwLock::new(MessageCache {
                entries: HashMap::new(),
            }),
        }
    }

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

    /// 获取缓存的会话消息（如果缓存仍然有效）
    ///
    /// 通过比对文件 mtime 判断缓存是否有效：
    /// - 如果文件未被修改，直接返回缓存数据
    /// - 如果文件已被修改（mtime 变化），返回 None 表示需要重新读取
    ///
    /// # 参数
    /// - `file_path` - 会话 JSONL 文件的绝对路径
    ///
    /// # 返回值
    /// - `Some(messages)` - 缓存有效时返回缓存数据的克隆
    /// - `None` - 缓存无效时返回 None
    pub fn get_messages(&self, file_path: &str) -> Option<Vec<SessionMessage>> {
        let mut cache = self.messages.write().ok()?;
        let entry = cache.entries.get_mut(file_path)?;

        // 检查文件是否被外部修改
        let current_mtime = std::fs::metadata(file_path).ok()?.modified().ok()?;

        if current_mtime == entry.file_mtime {
            // 更新最后访问时间（LRU）
            entry.last_accessed = Instant::now();
            Some(entry.data.clone())
        } else {
            // 文件已被修改，缓存失效
            cache.entries.remove(file_path);
            None
        }
    }

    /// 更新会话消息缓存
    ///
    /// 如果缓存已满，先淘汰最久未访问的条目。
    ///
    /// # 参数
    /// - `file_path` - 会话 JSONL 文件的绝对路径
    /// - `messages` - 解析后的消息数据
    pub fn set_messages(&self, file_path: &str, messages: Vec<SessionMessage>) {
        if let Ok(mut cache) = self.messages.write() {
            // 获取文件的当前 mtime
            let file_mtime = std::fs::metadata(file_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(SystemTime::UNIX_EPOCH);

            // 如果缓存已满且不是更新现有条目，淘汰最久未访问的条目
            if cache.entries.len() >= MESSAGE_CACHE_MAX_ENTRIES
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
                MessageCacheEntry {
                    data: messages,
                    file_mtime,
                    last_accessed: Instant::now(),
                },
            );
        }
    }

    /// 使指定会话的消息缓存失效
    ///
    /// 在消息被编辑或删除后调用
    ///
    /// # 参数
    /// - `file_path` - 会话 JSONL 文件的绝对路径
    pub fn invalidate_messages(&self, file_path: &str) {
        if let Ok(mut cache) = self.messages.write() {
            cache.entries.remove(file_path);
        }
    }
}

impl Default for AppCache {
    fn default() -> Self {
        Self::new()
    }
}
