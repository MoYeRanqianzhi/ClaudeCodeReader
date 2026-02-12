//! # 项目和会话 Tauri Commands
//!
//! 提供项目扫描相关的 Tauri command 处理函数：
//! - `scan_projects` - 一次性并行扫描所有项目和会话元数据
//!
//! 集成了内存缓存层，避免重复扫描。

use tauri::State;

use crate::models::project::Project;
use crate::services::cache::AppCache;
use crate::services::scanner;

/// 一次性并行扫描所有项目和会话元数据
///
/// 这是整个性能优化的核心 command。通过一次 IPC 调用完成以下工作：
/// 1. 检查缓存，如果缓存有效则直接返回
/// 2. 缓存无效时，扫描 `~/.claude/projects/` 目录下的所有项目子目录
/// 3. 对每个项目并行扫描其会话 `.jsonl` 文件
/// 4. 并行获取每个文件的 metadata（修改时间）
/// 5. 将结果存入缓存并返回
///
/// # 性能对比
/// - **优化前**：前端需要 N 次 readDir + N*M 次 stat（1000+ 次 IPC 往返）
/// - **优化后**：前端仅需 1 次 `invoke('scan_projects')`，
///   Rust 后端使用 tokio 并行完成所有 I/O 操作
///
/// # 参数
/// - `claude_path` - Claude 数据目录路径（`~/.claude/`）
/// - `cache` - Tauri managed state，内存缓存
///
/// # 返回值
/// 返回按最新会话时间倒序排列的 Project 数组
///
/// # 错误
/// 如果 projects 目录不可读，返回错误信息
#[tauri::command]
pub async fn scan_projects(
    claude_path: String,
    cache: State<'_, AppCache>,
) -> Result<Vec<Project>, String> {
    // 优先尝试从缓存获取
    if let Some(cached) = cache.get_projects() {
        return Ok(cached);
    }

    // 缓存未命中，执行完整扫描
    let projects = scanner::scan_all_projects(&claude_path).await?;

    // 存入缓存
    cache.set_projects(projects.clone());

    Ok(projects)
}
