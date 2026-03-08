//! # 修复项：撤销 ToolSearch 域名限制补丁（恢复备份）
//!
//! ## 修复信息
//!
//! - **修复者（Author）**：MoYeRanQianZhi（CCR 项目维护者）
//! - **修复模型（Model）**：Claude Opus 4.6
//! - **修复时间（Date）**：2026-03-08
//! - **修复设备（Device）**：Windows 11 PC
//! - **档位（Level）**：Full（特殊修复）
//!
//! ## 问题描述
//!
//! 用户在使用「ToolSearch 域名限制（全局补丁）」修复项后，
//! 可能需要撤销补丁、恢复 Claude Code 的原始行为。
//! 例如：不再使用代理、Claude Code 更新后需要重新评估、
//! 或补丁导致了意料之外的问题。
//!
//! ## 修复方式
//!
//! 扫描系统中所有 Claude Code 安装位置，检查是否存在
//! `.toolsearch-bak` 备份文件。如果存在，将备份文件的内容
//! 恢复到原始安装文件，撤销之前的补丁操作。
//!
//! ## 为什么使用 Full 档位
//!
//! 与 `patch_toolsearch` 相同的原因：操作的是 Claude Code 的安装文件，
//! 不在 `~/.claude/` 路径范围内。

use std::future::Future;
use std::pin::Pin;

use crate::services::cache::AppCache;
use crate::services::fixers::patch_toolsearch::{
    find_all_installations, write_patched_file, Installation, BACKUP_SUFFIX,
};
use crate::services::fixers::{FixDefinition, FixLevel, FixResult};

// ============ 公开接口 ============

/// 返回修复项的元数据定义
///
/// 提供 ToolSearch 补丁撤销（恢复备份）的完整描述信息，
/// 供前端列表展示和搜索过滤使用。
pub fn definition() -> FixDefinition {
    FixDefinition {
        id: "restore_toolsearch".to_string(),
        name: "撤销 ToolSearch 补丁（恢复备份）".to_string(),
        description: concat!(
            "撤销「ToolSearch 域名限制（全局补丁）」修复项的操作，",
            "将 Claude Code 安装文件恢复到补丁前的原始状态。\n\n",
            "本修复会扫描系统中所有 Claude Code 安装，",
            "查找 .toolsearch-bak 备份文件并恢复。\n\n",
            "⚠️ 注意：恢复后 ToolSearch 将恢复域名白名单限制，",
            "使用第三方 API 代理时 ToolSearch 可能无法使用。\n",
            "恢复后需要重启 Claude Code 生效。",
        )
        .to_string(),
        fix_method: concat!(
            "扫描所有 Claude Code 安装位置，查找 .toolsearch-bak 备份文件，",
            "将备份内容恢复到原始安装文件。",
        )
        .to_string(),
        tags: vec![
            "toolsearch".to_string(),
            "tool_search".to_string(),
            "恢复".to_string(),
            "撤销".to_string(),
            "restore".to_string(),
            "backup".to_string(),
            "域名限制".to_string(),
        ],
        level: FixLevel::Full,
    }
}

/// 执行恢复（Full 档位函数指针入口）
///
/// 扫描系统中所有 Claude Code 安装，从 `.toolsearch-bak` 备份恢复原始文件。
///
/// # 参数
/// - `_session_file_path` — 会话文件路径（本修复不使用，仅为满足 Full 档位签名）
/// - `_cache` — AppCache 引用（本修复不使用 file_guard，因为操作的不是会话文件）
pub fn execute<'a>(
    _session_file_path: &'a str,
    _cache: &'a AppCache,
) -> Pin<Box<dyn Future<Output = Result<FixResult, String>> + Send + 'a>> {
    Box::pin(execute_inner())
}

// ============ 内部实现 ============

/// 单个安装的恢复结果
///
/// 记录每个安装的恢复操作结果，用于汇总报告。
#[derive(Debug)]
struct RestoreResult {
    /// 安装描述
    description: String,
    /// 是否成功
    success: bool,
    /// 结果消息
    message: String,
}

/// 恢复逻辑的内部实现
///
/// 执行完整的扫描 → 检测备份 → 恢复流程：
/// 1. 探测所有 Claude Code 安装位置
/// 2. 对每个安装检查是否存在 `.toolsearch-bak` 备份
/// 3. 将备份内容恢复到原始文件
/// 4. 汇总所有结果
async fn execute_inner() -> Result<FixResult, String> {
    // 第 1 步：探测所有 Claude Code 安装
    let installations = find_all_installations().await;

    // 没有找到任何安装
    if installations.is_empty() {
        return Ok(FixResult {
            success: true,
            message: concat!(
                "未检测到任何 Claude Code 安装。\n",
                "支持的安装方式：bun 官方安装 / npm -g / pnpm add -g / ",
                "VS Code·Cursor 扩展",
            )
            .to_string(),
            affected_lines: 0,
        });
    }

    // 第 2 步：对每个安装执行恢复
    let mut results: Vec<RestoreResult> = Vec::new();
    let mut success_count: usize = 0;

    for inst in &installations {
        let restore_result = restore_from_backup(inst).await;
        if restore_result.success {
            success_count += 1;
        }
        results.push(restore_result);
    }

    // 检查是否所有安装都没有备份文件
    let all_no_backup = results.iter().all(|r| r.message.contains("未找到备份文件"));

    if all_no_backup {
        return Ok(FixResult {
            success: true,
            message: format!(
                "扫描到 {} 个安装，均未找到 .toolsearch-bak 备份文件，无需恢复。",
                installations.len(),
            ),
            affected_lines: 0,
        });
    }

    // 第 3 步：汇总结果消息
    let mut report = String::new();
    report.push_str(&format!(
        "扫描到 {} 个安装，成功恢复 {} 个：\n",
        installations.len(),
        success_count,
    ));

    for r in &results {
        let icon = if r.success { "✓" } else { "✗" };
        report.push_str(&format!("\n{} [{}]\n  {}", icon, r.description, r.message));
    }

    // 恢复成功时提醒用户重启
    if success_count > 0 {
        report.push_str("\n\n请重启 Claude Code 使恢复生效。");
    }

    Ok(FixResult {
        success: true,
        message: report,
        // affected_lines 用于表示成功恢复的安装数量
        affected_lines: success_count,
    })
}

/// 对单个安装从备份恢复
///
/// 完整的单安装恢复流程：
/// 1. 检查备份文件是否存在
/// 2. 读取备份内容
/// 3. 将备份内容写回原始文件
///
/// # 参数
/// - `inst` — 安装信息（复用 patch_toolsearch 的探测结果）
async fn restore_from_backup(inst: &Installation) -> RestoreResult {
    let desc = inst.description.clone();

    // 构造备份文件路径
    let backup_path_str = format!("{}{}", inst.target.display(), BACKUP_SUFFIX);
    let backup_path = std::path::PathBuf::from(&backup_path_str);

    // 检查备份文件是否存在
    if !backup_path.is_file() {
        return RestoreResult {
            description: desc,
            success: false,
            message: "未找到备份文件，无法恢复。".to_string(),
        };
    }

    // 读取备份文件内容
    let backup_data = match tokio::fs::read(&backup_path).await {
        Ok(d) => d,
        Err(e) => {
            return RestoreResult {
                description: desc,
                success: false,
                message: format!("读取备份文件失败: {}", e),
            };
        }
    };

    // 将备份内容写回原始文件（复用 patch_toolsearch 的写入逻辑，支持重命名方式）
    match write_patched_file(&inst.target, &backup_data).await {
        Ok(()) => RestoreResult {
            description: desc,
            success: true,
            message: format!("已从备份恢复。备份文件: {}", backup_path_str),
        },
        Err(e) => RestoreResult {
            description: desc,
            success: false,
            message: format!("恢复写入失败: {}", e),
        },
    }
}
