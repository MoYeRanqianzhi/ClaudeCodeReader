/**
 * @file retrospectData.ts - 项目回溯功能的数据访问层
 * @description
 * 封装所有与项目回溯功能相关的 Tauri IPC 调用。
 * 通过 `invoke()` 与 Rust 后端通信，获取时间轴数据、文件树、文件内容，
 * 以及执行导出和清理操作。
 *
 * 所有函数均为异步操作，遵循 Tauri commands 的调用规范：
 * - 函数参数名必须与 Rust 端 #[tauri::command] 的参数名完全一致
 * - 返回值类型由 Rust 端的序列化结果自动推断
 *
 * 依赖模式：参考 `src/utils/claudeData.ts` 的 invoke 封装方式
 */

import { invoke } from '@tauri-apps/api/core';
import type { RetrospectTimeline, FileTreeNode } from '../types/retrospect';

// ============ 初始化与清理 ============

/**
 * 初始化项目回溯
 *
 * 在 Rust 后端扫描指定项目的所有会话文件，提取文件操作历史，
 * 按时间顺序构建完整的回溯时间轴。此操作可能耗时较长（取决于会话文件数量和大小）。
 *
 * 后端会：
 * 1. 扫描 `<claudeDataPath>/projects/<projectName>/` 下的所有 JSONL 文件
 * 2. 解析每个文件中的 tool_use/tool_result 消息
 * 3. 提取 Write/Edit/Bash 等文件操作
 * 4. 按时间排序，构建 RetrospectTimeline
 * 5. 将状态缓存在 Rust 全局 state 中，供后续 API 使用
 *
 * @param claudeDataPath - Claude 数据目录的绝对路径（~/.claude/）
 * @param projectName - 编码后的项目目录名（如 "-G-ClaudeProjects-MyApp"）
 * @returns 返回完整的回溯时间轴数据
 */
export async function retrospectInit(
  claudeDataPath: string,
  projectName: string
): Promise<RetrospectTimeline> {
  return invoke<RetrospectTimeline>('retrospect_init', { claudeDataPath, projectName });
}

/**
 * 清理回溯状态
 *
 * 释放 Rust 后端中缓存的回溯数据（文件快照、操作列表等），
 * 回收内存。应在回溯视图关闭时调用。
 *
 * 此函数不会抛出错误——即使后端没有活跃的回溯状态也能安全调用。
 */
export async function retrospectCleanup(): Promise<void> {
  return invoke<void>('retrospect_cleanup');
}

// ============ 文件树与内容查询 ============

/**
 * 获取指定时间刻的文件树
 *
 * 根据时间轴上的操作索引，计算该时刻项目的文件目录结构。
 * 后端会重放从第 0 步到第 index 步的所有文件操作，构建出该时刻的文件树快照。
 *
 * @param index - 时间轴操作索引（0 ≤ index < totalOperations）
 * @returns 返回文件树根节点数组（顶层可能有多个文件/目录）
 */
export async function retrospectFileTree(index: number): Promise<FileTreeNode[]> {
  return invoke<FileTreeNode[]>('retrospect_file_tree', { index });
}

/**
 * 获取指定时间刻的指定文件内容
 *
 * 根据时间轴索引和文件路径，获取该时刻该文件的内容快照。
 * 后端会重放操作历史，计算出文件在指定时刻的内容状态。
 *
 * @param index - 时间轴操作索引（0 ≤ index < totalOperations）
 * @param filePath - 文件路径（相对于项目根目录，与 FileTreeNode.path 一致）
 * @returns 返回文件的文本内容
 * @throws 如果指定时刻该文件不存在，后端会返回错误
 */
export async function retrospectFileContent(
  index: number,
  filePath: string
): Promise<string> {
  return invoke<string>('retrospect_file_content', { index, filePath });
}

// ============ 导出功能 ============

/**
 * 另存为单个文件
 *
 * 将指定时间刻的某个文件内容保存到用户选择的本地路径。
 * 配合 Tauri dialog 的 `save()` 函数使用：先由前端弹出保存对话框获取路径，
 * 再调用此函数让后端执行文件写入。
 *
 * @param index - 时间轴操作索引
 * @param filePath - 要保存的文件路径（项目内的相对路径）
 * @param saveTo - 用户选择的保存目标路径（绝对路径）
 */
export async function retrospectSaveFile(
  index: number,
  filePath: string,
  saveTo: string
): Promise<void> {
  return invoke<void>('retrospect_save_file', { index, filePath, saveTo });
}

/**
 * 批量导出为 ZIP
 *
 * 将指定时间刻的整个项目文件树打包为 ZIP 文件，保存到用户选择的路径。
 * 包含该时刻所有存在的文件及其内容，目录结构与原始项目一致。
 *
 * @param index - 时间轴操作索引
 * @param saveTo - ZIP 文件的保存路径（绝对路径，如 "C:\exports\project-snapshot.zip"）
 */
export async function retrospectExportZip(
  index: number,
  saveTo: string
): Promise<void> {
  return invoke<void>('retrospect_export_zip', { index, saveTo });
}
