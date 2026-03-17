//! # 项目回溯 Tauri Commands
//!
//! 定义「项目回溯」功能的所有 Tauri command 处理函数。
//! 这些函数是前端与后端回溯引擎之间的 IPC 接口层。
//!
//! ## Command 列表
//! - `retrospect_init`：初始化回溯（扫描所有会话，提取操作列表）
//! - `retrospect_file_tree`：获取指定时间刻的文件树
//! - `retrospect_file_content`：获取指定时间刻的指定文件内容
//! - `retrospect_save_file`：另存为单个文件
//! - `retrospect_export_zip`：批量导出为 ZIP
//! - `retrospect_cleanup`：清理回溯状态，释放内存
//!
//! ## 设计原则
//! - 所有 command 都通过 `State<RetrospectState>` 注入全局状态
//! - 内部获取 Mutex 锁，检查初始化状态后调用 services 层函数
//! - 错误统一转为 `String` 类型返回给前端

use tauri::State;

use crate::models::retrospect::{FileTreeNode, RetrospectTimeline};
use crate::services::retrospect::RetrospectState;

/// 初始化回溯：扫描所有会话，提取操作列表
///
/// 前端在进入回溯页面时调用此 command。
/// 扫描指定项目的所有 JSONL 文件，提取文件操作，构建时间轴。
///
/// # 参数
/// - `claude_data_path` - Claude 数据目录路径（如 `~/.claude`）
/// - `project_name` - 编码后的项目目录名（如 "G--ClaudeProjects-Test"）
/// - `state` - Tauri managed state（自动注入）
///
/// # 返回值
/// 成功返回 `RetrospectTimeline`（包含操作总数和摘要列表）
///
/// # 错误
/// - 会话目录不存在
/// - JSONL 文件解析失败
#[tauri::command]
pub async fn retrospect_init(
    claude_data_path: String,
    project_name: String,
    state: State<'_, RetrospectState>,
) -> Result<RetrospectTimeline, String> {
    log::info!(
        "retrospect_init: claude_data_path={}, project_name={}",
        claude_data_path,
        project_name
    );

    // 验证 project_name 不包含路径遍历字符
    // 防止通过恶意 project_name 访问非预期目录
    if project_name.contains("..") || project_name.contains('/') || project_name.contains('\\') {
        return Err(format!("无效的项目名称: {}", project_name));
    }

    // 快速检查：如果已初始化，拒绝重复初始化
    // 避免并发调用导致状态覆盖，需先调用 retrospect_cleanup 清理
    {
        let guard = state.lock_inner()?;
        if guard.is_some() {
            return Err("回溯引擎已初始化，请先调用 retrospect_cleanup".to_string());
        }
    }

    // 调用 services 层的初始化函数
    let (timeline, inner) =
        crate::services::retrospect::init(&claude_data_path, &project_name).await?;

    // 将内部状态存入全局 managed state
    crate::services::retrospect::store_inner(&state, inner)?;

    log::info!(
        "retrospect_init 完成: {} 条操作",
        timeline.total_operations
    );
    Ok(timeline)
}

/// 获取指定时间刻的文件树
///
/// 前端在用户拖动时间轴滑块时调用此 command。
/// 回放操作到指定 index，返回该时间点的文件树结构。
///
/// # 参数
/// - `index` - 目标操作序号（0-based，0 到 total_operations - 1）
/// - `state` - Tauri managed state（自动注入）
///
/// # 返回值
/// 根级别的 FileTreeNode 列表
///
/// # 错误
/// - 未初始化（未调用 retrospect_init）
/// - index 超出范围
#[tauri::command]
pub async fn retrospect_file_tree(
    index: usize,
    state: State<'_, RetrospectState>,
) -> Result<Vec<FileTreeNode>, String> {
    // 获取 Mutex 锁
    let mut guard = state.lock_inner()?;

    // 检查是否已初始化
    let inner = guard
        .as_mut()
        .ok_or_else(|| "回溯引擎未初始化，请先调用 retrospect_init".to_string())?;

    // 校验 index 范围
    if inner.operations_count() == 0 {
        return Err("没有任何文件操作记录".to_string());
    }
    if index >= inner.operations_count() {
        return Err(format!(
            "index {} 超出范围 (最大 {})",
            index,
            inner.operations_count() - 1
        ));
    }

    // 获取文件树
    let tree = crate::services::retrospect::get_file_tree(inner, index);
    Ok(tree)
}

/// 获取指定时间刻的指定文件内容
///
/// 前端在用户点击文件树中的文件时调用此 command。
///
/// # 参数
/// - `index` - 目标操作序号（0-based）
/// - `file_path` - 文件相对路径（使用 `/` 分隔符，如 "src/App.tsx"）
/// - `state` - Tauri managed state（自动注入）
///
/// # 返回值
/// 文件内容字符串
///
/// # 错误
/// - 未初始化
/// - 文件在该时间点不存在
#[tauri::command]
pub async fn retrospect_file_content(
    index: usize,
    file_path: String,
    state: State<'_, RetrospectState>,
) -> Result<String, String> {
    // 获取 Mutex 锁
    let mut guard = state.lock_inner()?;

    // 检查是否已初始化
    let inner = guard
        .as_mut()
        .ok_or_else(|| "回溯引擎未初始化，请先调用 retrospect_init".to_string())?;

    // 校验 index 范围（与 retrospect_file_tree 保持一致）
    if inner.operations_count() == 0 {
        return Err("没有任何文件操作记录".to_string());
    }
    if index >= inner.operations_count() {
        return Err(format!(
            "index {} 超出范围 (最大 {})",
            index,
            inner.operations_count() - 1
        ));
    }

    // 获取文件内容
    crate::services::retrospect::get_file_content(inner, index, &file_path)
}

/// 另存为单个文件
///
/// 将指定时间点的指定文件内容保存到本地文件系统。
///
/// # 参数
/// - `index` - 目标操作序号（0-based）
/// - `file_path` - 文件相对路径（VFS 中的路径）
/// - `save_to` - 保存到的本地绝对路径
/// - `state` - Tauri managed state（自动注入）
///
/// # 错误
/// - 未初始化
/// - 文件在该时间点不存在
/// - 写入目标文件失败
#[tauri::command]
pub async fn retrospect_save_file(
    index: usize,
    file_path: String,
    save_to: String,
    state: State<'_, RetrospectState>,
) -> Result<(), String> {
    // 获取文件内容
    let content = {
        let mut guard = state.lock_inner()?;
        let inner = guard
            .as_mut()
            .ok_or_else(|| "回溯引擎未初始化，请先调用 retrospect_init".to_string())?;

        crate::services::retrospect::get_file_content(inner, index, &file_path)?
    };
    // 锁在此处释放，避免持锁执行 I/O

    // 写入目标文件
    tokio::fs::write(&save_to, content.as_bytes())
        .await
        .map_err(|e| format!("写入文件失败 [{}]: {}", save_to, e))?;

    log::info!("retrospect_save_file: {} → {}", file_path, save_to);
    Ok(())
}

/// 批量导出为 ZIP
///
/// 将指定时间点的所有文件打包为 ZIP 文件保存到本地。
///
/// # 参数
/// - `index` - 目标操作序号（0-based）
/// - `save_to` - ZIP 文件保存路径（绝对路径）
/// - `state` - Tauri managed state（自动注入）
///
/// # 错误
/// - 未初始化
/// - ZIP 创建或写入失败
#[tauri::command]
pub async fn retrospect_export_zip(
    index: usize,
    save_to: String,
    state: State<'_, RetrospectState>,
) -> Result<(), String> {
    // 在 Mutex 锁内收集文件数据，然后立即释放锁
    let files = {
        let mut guard = state.lock_inner()?;
        let inner = guard
            .as_mut()
            .ok_or_else(|| "回溯引擎未初始化，请先调用 retrospect_init".to_string())?;

        // 校验 index 范围：先检查是否有操作记录，再检查 index 是否越界
        if inner.operations_count() == 0 {
            return Err("没有任何文件操作记录".to_string());
        }
        if index >= inner.operations_count() {
            return Err(format!(
                "index {} 超出范围 (最大 {})",
                index,
                inner.operations_count() - 1
            ));
        }

        // 收集快照文件（同步操作，在锁内完成）
        crate::services::retrospect::collect_snapshot_files(inner, index)
    };
    // guard 在此处已释放，可以安全地执行 async I/O

    // 异步写入 ZIP 文件
    crate::services::retrospect::export_zip_from_files(files, &save_to).await?;

    log::info!("retrospect_export_zip: index={} → {}", index, save_to);
    Ok(())
}

/// 清理回溯状态
///
/// 前端在退出回溯页面时调用此 command，释放内存。
///
/// # 参数
/// - `state` - Tauri managed state（自动注入）
///
/// # 错误
/// - 获取 Mutex 锁失败
#[tauri::command]
pub async fn retrospect_cleanup(
    state: State<'_, RetrospectState>,
) -> Result<(), String> {
    crate::services::retrospect::cleanup(&state)?;
    log::info!("retrospect_cleanup 完成");
    Ok(())
}
