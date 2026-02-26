//! # 文件写入守卫服务
//!
//! 统一所有对 Claude 数据文件的修改操作，提供双重备份保障：
//!
//! ## 临时备份（强制）
//! 每次修改前自动备份到系统 TEMP 目录（`%TEMP%/ccr-backups/`），
//! 在应用运行期间始终有效，供用户反悔恢复。
//! 备份文件使用完整原始文件名 + 时间戳命名，避免不同会话碰巧重名。
//!
//! ## 主动备份（可选）
//! 用户在设置中启用后，每次修改前在原文件同目录创建 `.ccbak<time>` 备份，
//! 作为持久化的历史快照。
//!
//! ## 路径安全验证
//! 所有写入/删除操作前验证目标路径是否在 `~/.claude/` 目录下，
//! 防止意外修改非 Claude 数据文件。
//!
//! ## 使用方式
//! 项目中所有对 Claude 数据文件的修改必须通过以下两个入口函数：
//! - `safe_write_file()` — 安全写入文件
//! - `safe_delete_file()` — 安全删除文件

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::services::cache::AppCache;
use crate::utils::path;

/// 备份配置（从 `~/.mo/CCR/backup-config.json` 加载）
///
/// 控制主动备份（.ccbak）的启用状态。
/// 临时备份始终启用，不受此配置影响。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfig {
    /// 是否启用主动备份（在原文件同目录创建 .ccbak 文件）
    pub auto_backup_enabled: bool,
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            auto_backup_enabled: false,
        }
    }
}

/// 临时备份注册表中的单条记录
///
/// 记录一次临时备份的完整信息，供前端展示和恢复操作使用。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TempBackupEntry {
    /// 被备份的原始文件绝对路径
    pub original_path: String,
    /// 临时备份文件的绝对路径（在系统 TEMP 目录下）
    pub temp_path: String,
    /// 备份创建时间（ISO 8601 格式）
    pub created_at: String,
    /// 触发备份的操作描述（如 "delete_message", "edit_message", "save_settings"）
    pub operation: String,
}

// ============ 公开入口函数 ============

/// 安全写入文件（统一入口）
///
/// 所有对 Claude 数据目录下文件的修改必须通过此函数。
/// 执行流程：
/// 1. 验证路径在 `~/.claude/` 目录下
/// 2. 如果原文件存在，创建临时备份到系统 TEMP 目录（强制）
/// 3. 如果启用主动备份且原文件存在，创建 `.ccbak` 文件（可选）
/// 4. 执行实际写入
///
/// # 参数
/// - `file_path` - 目标文件的绝对路径
/// - `content` - 要写入的字节内容
/// - `operation` - 操作描述（用于备份记录，如 "delete_message"）
/// - `cache` - AppCache 引用，用于注册临时备份记录
///
/// # 错误
/// 路径验证失败、备份创建失败或写入失败时返回错误
pub async fn safe_write_file(
    file_path: &str,
    content: &[u8],
    operation: &str,
    cache: &AppCache,
) -> Result<(), String> {
    // 1. 路径安全验证
    validate_claude_path(file_path)?;

    // 2. 如果原文件存在，执行备份
    if Path::new(file_path).exists() {
        // 临时备份（强制）
        create_temp_backup(file_path, operation, cache).await?;

        // 主动备份（可选，根据配置决定）
        let config = read_backup_config_internal().await;
        if config.auto_backup_enabled {
            create_auto_backup(file_path).await?;
        }
    }

    // 3. 执行实际写入
    tokio::fs::write(file_path, content)
        .await
        .map_err(|e| format!("写入文件失败: {}", e))
}

/// 安全删除文件（统一入口）
///
/// 删除前同样执行完整的备份流程。
///
/// # 参数
/// - `file_path` - 要删除的文件的绝对路径
/// - `operation` - 操作描述（用于备份记录）
/// - `cache` - AppCache 引用，用于注册临时备份记录
///
/// # 错误
/// 路径验证失败、备份创建失败或删除失败时返回错误
pub async fn safe_delete_file(
    file_path: &str,
    operation: &str,
    cache: &AppCache,
) -> Result<(), String> {
    // 1. 路径安全验证
    validate_claude_path(file_path)?;

    // 2. 如果文件存在，执行备份
    if Path::new(file_path).exists() {
        // 临时备份（强制）
        create_temp_backup(file_path, operation, cache).await?;

        // 主动备份（可选）
        let config = read_backup_config_internal().await;
        if config.auto_backup_enabled {
            create_auto_backup(file_path).await?;
        }
    }

    // 3. 执行实际删除
    tokio::fs::remove_file(file_path)
        .await
        .map_err(|e| format!("删除文件失败: {}", e))
}

// ============ 内部辅助函数 ============

/// 验证路径是否在 Claude 数据目录（`~/.claude/`）下
///
/// 使用 `std::fs::canonicalize` 解析符号链接和 `..` 等路径组件，
/// 确保最终路径确实位于 Claude 数据目录内，防止路径遍历攻击。
///
/// # 错误
/// 路径不在 `~/.claude/` 下时返回安全检查失败错误
fn validate_claude_path(file_path: &str) -> Result<(), String> {
    let claude_path = path::get_claude_data_path()?;

    // canonicalize 解析符号链接和相对路径组件
    let canonical = std::fs::canonicalize(file_path)
        .map_err(|e| format!("路径解析失败: {}", e))?;
    let claude_canonical = std::fs::canonicalize(&claude_path)
        .map_err(|e| format!("Claude 数据路径解析失败: {}", e))?;

    if !canonical.starts_with(&claude_canonical) {
        return Err(format!(
            "安全检查失败：路径 {} 不在 Claude 数据目录 {} 下",
            file_path,
            claude_path.display()
        ));
    }

    Ok(())
}

/// 获取当前 Unix 时间戳（秒）
fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// 获取当前时间的格式化字符串（YYYYMMDDHHmmss）
///
/// 用于主动备份文件名后缀。
fn formatted_timestamp() -> String {
    let secs = unix_timestamp();
    // 简单的时间格式化：从 Unix 时间戳计算日期时间
    // 使用 chrono 会更精确，但为避免新增依赖，使用手动计算
    // 这里直接用 Unix 时间戳作为后缀，保证唯一性
    format!("{}", secs)
}

/// 创建临时备份到系统 TEMP 目录（强制执行）
///
/// 备份路径格式：`%TEMP%/ccr-backups/<原始完整文件名>_<timestamp>.bak`
/// 使用完整原始文件名（含完整会话 UUID），避免不同会话截断后碰巧重名。
///
/// 备份完成后将记录注册到 AppCache 的临时备份注册表中。
async fn create_temp_backup(
    file_path: &str,
    operation: &str,
    cache: &AppCache,
) -> Result<(), String> {
    let temp_dir = std::env::temp_dir().join("ccr-backups");

    // 确保临时备份目录存在
    if !temp_dir.exists() {
        tokio::fs::create_dir_all(&temp_dir)
            .await
            .map_err(|e| format!("创建临时备份目录失败: {}", e))?;
    }

    // 提取原始文件名（完整，含扩展名）
    let file_name = Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    let timestamp = unix_timestamp();
    let backup_name = format!("{}_{}.bak", file_name, timestamp);
    let backup_path = temp_dir.join(&backup_name);

    // 复制原文件到临时备份位置
    tokio::fs::copy(file_path, &backup_path)
        .await
        .map_err(|e| format!("创建临时备份失败: {}", e))?;

    // 注册到 AppCache 的临时备份注册表
    let entry = TempBackupEntry {
        original_path: file_path.to_string(),
        temp_path: backup_path.to_string_lossy().to_string(),
        created_at: format!("{}", timestamp),
        operation: operation.to_string(),
    };
    cache.register_temp_backup(entry);

    Ok(())
}

/// 创建主动备份（.ccbak 文件，与原文件同目录）
///
/// 备份路径格式：`<原始文件路径>.ccbak<timestamp>`
/// 例如：`a9fbcef9-...-.jsonl.ccbak1740000000`
async fn create_auto_backup(file_path: &str) -> Result<(), String> {
    let timestamp = formatted_timestamp();
    let backup_path = format!("{}.ccbak{}", file_path, timestamp);

    tokio::fs::copy(file_path, &backup_path)
        .await
        .map_err(|e| format!("创建主动备份失败: {}", e))?;

    Ok(())
}

/// 内部函数：读取备份配置（不经过 Tauri command 层）
///
/// 从 `~/.mo/CCR/backup-config.json` 加载配置。
/// 读取失败时静默返回默认配置（主动备份关闭）。
pub(crate) async fn read_backup_config_internal() -> BackupConfig {
    let ccr_path = match path::get_ccr_config_path() {
        Ok(p) => p,
        Err(_) => return BackupConfig::default(),
    };
    let config_path = ccr_path.join("backup-config.json");

    if !config_path.exists() {
        return BackupConfig::default();
    }

    match tokio::fs::read_to_string(&config_path).await {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => BackupConfig::default(),
    }
}
