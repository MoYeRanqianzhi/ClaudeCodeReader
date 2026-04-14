//! # Skills 管理 Tauri Commands
//!
//! 提供 Skills 相关的 Tauri command 处理函数：
//! - `list_skills` - 列出所有可用的 skills（分全局/项目级）
//! - `get_skill_detail` - 获取指定 skill 的完整内容
//!
//! 这些 commands 是前端 SkillsManager 组件的数据来源，
//! 通过 Tauri IPC 调用 `services::skill` 中的业务逻辑。

use crate::models::skill::{SkillDetail, SkillInfo};
use crate::services::skill;

/// 列出所有可用的 Skills
///
/// 扫描所有 skills 来源目录（用户级、项目级、旧版 commands），
/// 返回去重后的完整 skill 列表。
///
/// 对应 Claude Code 源码中的 `/skills` 命令和 `getSkillDirCommands()` 函数。
///
/// # 参数（通过 Tauri invoke 传入）
/// - `project_path` - 可选的项目根目录路径。提供时会额外扫描项目级 skills。
///
/// # 前端调用示例
/// ```typescript
/// const skills = await invoke<SkillInfo[]>('list_skills', { projectPath: '/path/to/project' });
/// ```
#[tauri::command]
pub async fn list_skills(project_path: Option<String>) -> Result<Vec<SkillInfo>, String> {
    skill::list_all_skills(project_path.as_deref()).await
}

/// 获取指定 Skill 的详细信息
///
/// 读取 SKILL.md 的完整内容，包含 frontmatter 元数据和 markdown prompt 内容。
/// 仅在用户点击查看 skill 详情时按需调用，避免列表请求时传输大量内容。
///
/// # 参数（通过 Tauri invoke 传入）
/// - `source_path` - SKILL.md 文件的完整路径（从 `list_skills` 返回的 `sourcePath` 字段获取）
///
/// # 前端调用示例
/// ```typescript
/// const detail = await invoke<SkillDetail>('get_skill_detail', { sourcePath: '/path/to/SKILL.md' });
/// ```
#[tauri::command]
pub async fn get_skill_detail(source_path: String) -> Result<SkillDetail, String> {
    skill::get_skill_detail(&source_path).await
}
