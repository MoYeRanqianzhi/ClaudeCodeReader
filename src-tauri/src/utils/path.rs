//! # 路径工具函数
//!
//! 提供与文件路径相关的工具函数，包括：
//! - 获取 Claude Code 数据目录路径（`~/.claude/`）
//! - 解码编码后的项目目录名为原始文件系统路径
//! - 获取 CCR 自身配置目录路径（`~/.mo/CCR/`）

use std::path::PathBuf;

/// 获取 Claude Code 数据目录的绝对路径
///
/// Claude Code 将所有用户数据存储在用户主目录下的 `.claude` 文件夹中。
/// 使用 `dirs` crate 获取跨平台的主目录路径。
///
/// # 返回值
/// 返回 `~/.claude/` 目录的绝对路径。
///
/// # 错误
/// 如果无法确定用户主目录（极端情况，如无 HOME 环境变量），返回错误信息。
///
/// # 示例
/// - Windows: `C:\Users\username\.claude`
/// - Linux/macOS: `/home/username/.claude`
pub fn get_claude_data_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
    Ok(home.join(".claude"))
}

/// 获取 CCR 自身配置目录的绝对路径
///
/// CCR 的配置数据独立存储在 `~/.mo/CCR/` 目录下，
/// 与 Claude Code 原生数据分离，避免对 Claude Code 的文件造成意外污染。
///
/// # 返回值
/// 返回 `~/.mo/CCR/` 目录的绝对路径。
///
/// # 错误
/// 如果无法确定用户主目录，返回错误信息。
pub fn get_ccr_config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
    Ok(home.join(".mo").join("CCR"))
}

/// 将编码的项目目录名解码为原始文件系统路径
///
/// Claude Code 在 `~/.claude/projects/` 目录下使用编码后的路径作为子目录名，
/// 将路径分隔符和驱动器号替换为短横线，以适应文件系统命名限制。
///
/// # 解码规则
///
/// 使用两阶段解码策略，以正确区分双短横线（`--`）和单短横线（`-`）：
///
/// 1. **第一阶段**：将 `--` 替换为临时占位符 `\x00`
///    - `--` 在原始路径中代表路径分隔符（较深层级的分隔）
/// 2. **第二阶段**：将剩余的单 `-` 替换为路径分隔符
///    - 单 `-` 也代表路径分隔符
/// 3. **第三阶段**：将占位符 `\x00` 还原为路径分隔符
///    - 此时所有的双短横线和单短横线都已正确转换为路径分隔符
/// 4. **第四阶段**：还原 Windows 盘符
///    - 如果路径以 `X:\` 开头（单字母后跟 `:\`），表示这是一个 Windows 绝对路径
///
/// # 参数
/// - `encoded_name` - 编码后的项目目录名（如 "G--ClaudeProjects-Test"）
///
/// # 返回值
/// 解码后的原始文件系统路径（如 "G:\ClaudeProjects\Test"）
///
/// # 示例
/// ```
/// let decoded = decode_project_path("G--ClaudeProjects-Test");
/// assert_eq!(decoded, r"G:\ClaudeProjects\Test");
/// ```
pub fn decode_project_path(encoded_name: &str) -> String {
    // 使用与前端 TypeScript 相同的解码逻辑
    let separator = std::path::MAIN_SEPARATOR.to_string();

    // 阶段 1: 将双短横线 "--" 替换为临时占位符，避免被后续的单短横线替换逻辑误处理
    let result = encoded_name.replace("--", "\x00");

    // 阶段 2: 将剩余的单短横线 "-" 替换为路径分隔符
    let result = result.replace('-', &separator);

    // 阶段 3: 将占位符还原为路径分隔符
    let result = result.replace('\x00', &separator);

    // 阶段 4: 还原 Windows 盘符格式
    // 检查是否以 "X\" 开头（单个字母后跟路径分隔符），如果是则插入冒号变为 "X:\"
    // 这对应前端的 `.replace(/^([A-Za-z])--/, '$1:\\')`
    let chars: Vec<char> = result.chars().collect();
    if chars.len() >= 2
        && chars[0].is_ascii_alphabetic()
        && chars[1] == std::path::MAIN_SEPARATOR
    {
        format!("{}:{}", chars[0], &result[chars[0].len_utf8()..])
    } else {
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_project_path_windows() {
        // Windows 风格路径解码测试
        let decoded = decode_project_path("G--ClaudeProjects-Test");
        assert_eq!(decoded, r"G:\ClaudeProjects\Test");
    }

    #[test]
    fn test_decode_project_path_simple() {
        let decoded = decode_project_path("home-user-projects-myapp");
        // 非 Windows 盘符开头的路径
        let sep = std::path::MAIN_SEPARATOR;
        let expected = format!("home{sep}user{sep}projects{sep}myapp");
        assert_eq!(decoded, expected);
    }
}
