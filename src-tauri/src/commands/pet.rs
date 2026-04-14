//! # 宠物管理 Tauri Commands
//!
//! 提供宠物系统相关的 Tauri command 处理函数：
//! - `get_companion` - 获取当前宠物完整信息
//! - `clear_companion` - 清除宠物记录（允许重新孵化）
//! - `preview_companion_bones` - 预览当前用户的骨架属性
//!
//! 所有 commands 均为异步操作，直接操作 `~/.claude.json` 全局配置文件。

use crate::models::pet::{Companion, CompanionBones, PetActionResult};
use crate::services::pet;

/// 获取当前宠物的完整信息
///
/// 从 `~/.claude.json` 读取已孵化的宠物灵魂数据，
/// 并根据 userId 确定性计算骨架属性，合并为完整的 `Companion`。
///
/// # 返回值
/// - `Ok(Some(companion))` - 用户已孵化宠物，返回完整信息
/// - `Ok(None)` - 用户尚未孵化宠物
/// - `Err(msg)` - 配置文件操作失败
///
/// # 前端调用示例
/// ```typescript
/// const companion = await invoke<Companion | null>('get_companion');
/// ```
#[tauri::command]
pub async fn get_companion() -> Result<Option<Companion>, String> {
    pet::get_current_companion().await
}

/// 清除宠物记录
///
/// 从 `~/.claude.json` 中删除 `companion` 字段。
/// 清除后，用户在 Claude Code 中执行 `/buddy` 可重新孵化新宠物。
///
/// # 返回值
/// 返回 `PetActionResult`，包含操作成功与否和描述消息。
///
/// # 注意
/// - 此操作会直接修改 Claude Code 的全局配置文件
/// - 骨架是确定性的，清除后重新孵化会得到相同种族和稀有度的宠物
/// - 只有灵魂（名字和性格）会由模型重新生成
///
/// # 前端调用示例
/// ```typescript
/// const result = await invoke<PetActionResult>('clear_companion');
/// ```
#[tauri::command]
pub async fn clear_companion() -> Result<PetActionResult, String> {
    pet::clear_companion().await
}

/// 预览当前用户的宠物骨架
///
/// 仅根据配置中的 userId 计算骨架属性，不需要宠物已孵化。
/// 用于在清除宠物后预览重新孵化将得到的基础属性。
///
/// # 返回值
/// 返回 `CompanionBones`，包含种族、稀有度、眼睛、帽子、闪光和属性值。
///
/// # 前端调用示例
/// ```typescript
/// const bones = await invoke<CompanionBones>('preview_companion_bones');
/// ```
#[tauri::command]
pub async fn preview_companion_bones() -> Result<CompanionBones, String> {
    pet::preview_bones().await
}
