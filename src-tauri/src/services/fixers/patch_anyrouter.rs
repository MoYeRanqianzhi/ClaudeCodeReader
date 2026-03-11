//! # 修复项：AnyRouter 400 错误修复
//!
//! ## 修复信息
//!
//! - **修复者（Author）**：MoYeRanQianZhi（CCR 项目维护者）
//! - **修复模型（Model）**：Claude Opus 4.6
//! - **修复时间（Date）**：2026-03-11
//! - **修复设备（Device）**：Windows 11 PC
//! - **档位（Level）**：Full（特殊修复）
//!
//! ## 问题描述
//!
//! 使用 AnyRouter 等第三方 API 路由时，Claude Code 可能出现：
//! ```
//! AnyRouter: API Error: 400 status code (no body)
//! ```
//! 这是因为 Claude Code 的实验性 beta 功能和 ToolSearch 功能
//! 发送了 AnyRouter 不支持的请求参数，导致上游 API 返回 400 错误。
//!
//! ## 修复方式
//!
//! 修改 Claude Code 全局配置文件 `~/.claude/settings.json`，
//! 在 `env` 字段中设置以下两个环境变量：
//!
//! - `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` = `"1"`
//!   禁用实验性 beta 功能，避免发送不兼容的参数
//!
//! - `ENABLE_TOOL_SEARCH` = `"false"`
//!   关闭 ToolSearch 功能，避免触发 AnyRouter 不支持的 API 调用
//!
//! ## 为什么使用 Full 档位
//!
//! 该修复操作的是 `~/.claude/settings.json` 全局配置文件，
//! 而非当前打开的会话 JSONL 文件。虽然 settings.json 在 `~/.claude/` 下，
//! 但 File 档位的参数是会话文件路径，本修复需要自行定位 settings.json，
//! 因此使用 Full 档位以获取完全的文件操作权限。

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;

use serde_json::Value;

use crate::services::cache::AppCache;
use crate::services::fixers::{FixDefinition, FixLevel, FixResult};

// ============ 常量 ============

/// 需要在 env 中设置的键值对
///
/// 每个元组包含 (键名, 目标值)：
/// - `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`：禁用实验性 beta 功能
/// - `ENABLE_TOOL_SEARCH`：关闭 ToolSearch 功能
const ENV_PATCHES: &[(&str, &str)] = &[
    ("CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS", "1"),
    ("ENABLE_TOOL_SEARCH", "false"),
];

/// 配置文件名
///
/// Claude Code 的全局配置文件位于 `~/.claude/settings.json`。
const SETTINGS_FILENAME: &str = "settings.json";

/// Claude Code 配置目录名
///
/// 位于用户主目录下的 `.claude` 目录。
const CLAUDE_DIR_NAME: &str = ".claude";

/// 备份文件后缀
///
/// 修改 settings.json 前先创建带此后缀的备份文件。
const BACKUP_SUFFIX: &str = ".anyrouter-bak";

// ============ 公开接口 ============

/// 返回修复项的元数据定义
///
/// 提供 AnyRouter 400 错误修复的完整描述信息，
/// 供前端列表展示和搜索过滤使用。
pub fn definition() -> FixDefinition {
    FixDefinition {
        id: "patch_anyrouter_400".to_string(),
        name: "AnyRouter 400 (no body) 错误".to_string(),
        description: concat!(
            "使用 AnyRouter 等第三方 API 路由时出现：\n",
            "AnyRouter: API Error: 400 status code (no body)\n\n",
            "原因：Claude Code 的实验性 beta 功能和 ToolSearch 功能\n",
            "发送了 AnyRouter 不支持的请求参数。\n\n",
            "本修复会修改 ~/.claude/settings.json 全局配置，\n",
            "禁用相关功能以解决兼容性问题。\n\n",
            "⚠️ 注意：本修复与当前打开的会话文件无关，\n",
            "它修改的是 Claude Code 的全局配置。\n",
            "修复后需要重启 Claude Code 生效。",
        )
        .to_string(),
        fix_method: concat!(
            "在 ~/.claude/settings.json 的 env 字段中设置：\n",
            "  CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = \"1\"\n",
            "  ENABLE_TOOL_SEARCH = \"false\"\n",
            "修改前自动创建 .anyrouter-bak 备份文件。",
        )
        .to_string(),
        tags: vec![
            "anyrouter".to_string(),
            "400".to_string(),
            "no body".to_string(),
            "api error".to_string(),
            "experimental_betas".to_string(),
            "tool_search".to_string(),
            "代理".to_string(),
            "proxy".to_string(),
            "路由".to_string(),
            "router".to_string(),
        ],
        level: FixLevel::Full,
    }
}

/// 执行修复（Full 档位函数指针入口）
///
/// 定位 `~/.claude/settings.json`，修改 env 字段以禁用导致 400 错误的功能。
///
/// # 参数
/// - `_session_file_path` — 会话文件路径（本修复不使用，仅为满足 Full 档位签名）
/// - `_cache` — AppCache 引用（本修复不使用 file_guard，因为操作的不是会话文件）
///
/// # 返回值
/// 成功时返回 FixResult，包含修改详情；
/// 失败时返回错误描述字符串。
pub fn execute<'a>(
    _session_file_path: &'a str,
    _cache: &'a AppCache,
) -> Pin<Box<dyn Future<Output = Result<FixResult, String>> + Send + 'a>> {
    Box::pin(execute_inner())
}

// ============ 内部实现 ============

/// 修复逻辑的内部实现
///
/// 执行完整的定位 → 读取 → 修改 → 写回流程：
/// 1. 定位 `~/.claude/settings.json` 文件
/// 2. 读取并解析为 JSON
/// 3. 检查 env 字段中的当前值
/// 4. 如需修改，创建备份并写入新配置
async fn execute_inner() -> Result<FixResult, String> {
    // 第 1 步：定位 settings.json
    let settings_path = find_settings_path()?;

    // 第 2 步：读取现有配置（文件不存在时使用空对象）
    let (original_content, mut config) = read_or_create_config(&settings_path).await?;

    // 第 3 步：检查并修改 env 字段
    let changes = apply_env_patches(&mut config);

    // 没有需要修改的项目（所有值已经是目标值）
    if changes.is_empty() {
        return Ok(FixResult {
            success: true,
            message: format!(
                "配置文件已包含所有目标值，无需修改。\n路径: {}",
                settings_path.display(),
            ),
            affected_lines: 0,
        });
    }

    // 第 4 步：序列化为格式化 JSON
    let new_content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化 JSON 失败: {}", e))?;

    // 第 5 步：创建备份（仅当原文件存在时）
    if !original_content.is_empty() {
        let backup_path = format!("{}{}", settings_path.display(), BACKUP_SUFFIX);
        tokio::fs::write(&backup_path, &original_content)
            .await
            .map_err(|e| format!("创建备份文件失败: {}", e))?;
    }

    // 第 6 步：确保目录存在并写入新配置
    if let Some(parent) = settings_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }

    tokio::fs::write(&settings_path, &new_content)
        .await
        .map_err(|e| format!("写入配置文件失败: {}", e))?;

    // 构建结果报告
    let mut report = format!(
        "已修改 {} 项配置：\n",
        changes.len(),
    );

    for (key, old_val, new_val) in &changes {
        report.push_str(&format!(
            "\n  {} : {} → {}",
            key, old_val, new_val,
        ));
    }

    report.push_str(&format!(
        "\n\n配置文件: {}\n请重启 Claude Code 使修改生效。",
        settings_path.display(),
    ));

    // 如果原文件存在，附加备份路径信息
    if !original_content.is_empty() {
        report.push_str(&format!(
            "\n备份文件: {}{}",
            settings_path.display(),
            BACKUP_SUFFIX,
        ));
    }

    Ok(FixResult {
        success: true,
        message: report,
        // affected_lines 表示修改的配置项数量
        affected_lines: changes.len(),
    })
}

/// 定位 `~/.claude/settings.json` 文件路径
///
/// 通过 `dirs::home_dir()` 获取用户主目录，
/// 拼接 `.claude/settings.json` 路径。
///
/// # 返回值
/// settings.json 的绝对路径
///
/// # 错误
/// 无法获取用户主目录时返回错误
fn find_settings_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "无法获取用户主目录".to_string())?;

    Ok(home.join(CLAUDE_DIR_NAME).join(SETTINGS_FILENAME))
}

/// 读取现有配置文件，或创建默认空配置
///
/// 如果文件存在，读取并解析为 JSON Value；
/// 如果文件不存在，返回空 JSON 对象 `{}`。
///
/// # 参数
/// - `path` — settings.json 的路径
///
/// # 返回值
/// 元组 `(原始文件内容字符串, 解析后的 JSON Value)`：
/// - 原始内容用于创建备份
/// - JSON Value 用于后续修改
async fn read_or_create_config(path: &PathBuf) -> Result<(String, Value), String> {
    if !path.is_file() {
        // 文件不存在，返回空对象
        return Ok((String::new(), Value::Object(serde_json::Map::new())));
    }

    // 读取文件内容
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    // 解析 JSON
    let config: Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析配置文件 JSON 失败: {}", e))?;

    // 确保顶层是对象
    if !config.is_object() {
        return Err("配置文件顶层不是 JSON 对象".to_string());
    }

    Ok((content, config))
}

/// 在配置的 env 字段中应用所有补丁
///
/// 遍历 `ENV_PATCHES` 常量中定义的所有键值对，
/// 检查当前值是否与目标值一致。
/// 如果不一致或不存在，设置为目标值并记录变更。
///
/// # 参数
/// - `config` — 可变的 JSON 配置对象
///
/// # 返回值
/// 变更列表：`Vec<(键名, 旧值, 新值)>`
/// 空列表表示所有值已经是目标值
fn apply_env_patches(config: &mut Value) -> Vec<(String, String, String)> {
    let mut changes: Vec<(String, String, String)> = Vec::new();

    // 确保 config 是对象
    let obj = match config.as_object_mut() {
        Some(o) => o,
        None => return changes,
    };

    // 确保 env 字段存在且是对象
    if !obj.contains_key("env") {
        obj.insert(
            "env".to_string(),
            Value::Object(serde_json::Map::new()),
        );
    }

    let env = match obj.get_mut("env").and_then(|v| v.as_object_mut()) {
        Some(e) => e,
        None => {
            // env 字段存在但不是对象，替换为新对象
            obj.insert(
                "env".to_string(),
                Value::Object(serde_json::Map::new()),
            );
            obj.get_mut("env").unwrap().as_object_mut().unwrap()
        }
    };

    // 应用每个补丁
    for &(key, target_value) in ENV_PATCHES {
        let current = env.get(key).and_then(|v| v.as_str()).unwrap_or("");

        if current != target_value {
            // 记录变更：旧值 → 新值
            let old_display = if current.is_empty() {
                "(未设置)".to_string()
            } else {
                format!("\"{}\"", current)
            };

            changes.push((
                key.to_string(),
                old_display,
                format!("\"{}\"", target_value),
            ));

            // 设置新值
            env.insert(
                key.to_string(),
                Value::String(target_value.to_string()),
            );
        }
    }

    changes
}
