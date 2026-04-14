//! # Skills 扫描与解析服务
//!
//! 实现 Claude Code Skills 的发现、扫描和解析逻辑。
//! 完全对齐 Claude Code 源码 `src/skills/loadSkillsDir.ts` 中的行为：
//!
//! ## 扫描路径（与源码一致）
//! 0. 企业策略级：`<managed_path>/.claude/skills/` — 企业部署的强制策略 skills
//! 1. 用户级：`~/.claude/skills/` — 全局可用的 skills
//! 2. 项目级：`<project>/.claude/skills/` — 仅在特定项目中可用
//! 3. 旧版命令：`~/.claude/commands/` 和 `<project>/.claude/commands/`（支持嵌套命名空间）
//!
//! ## 目录格式（与源码一致）
//! Skills 目录只支持目录格式：`skill-name/SKILL.md`
//! 旧版 commands 目录同时支持目录格式和单文件格式（`command-name.md`）
//!
//! ## Frontmatter 解析
//! 使用 `serde_yaml` 解析 SKILL.md 开头的 YAML frontmatter（`---` 分隔符之间的内容），
//! 对应源码中的 `parseFrontmatter()` 函数。

use std::path::{Path, PathBuf};

use tokio::fs;

use crate::models::skill::{SkillDetail, SkillFrontmatter, SkillInfo, SkillSource};

/// Frontmatter 分隔符正则匹配的简化实现
///
/// 对应源码 `frontmatterParser.ts` 中的 `FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/`
/// 这里使用手动字符串查找代替正则，性能更好且无需额外依赖。
///
/// # 返回值
/// - `Some((frontmatter_text, markdown_content))` - 成功解析出 frontmatter 和内容
/// - `None` - 没有找到有效的 frontmatter
fn split_frontmatter(content: &str) -> Option<(&str, &str)> {
    // 必须以 "---" 开头（允许尾随空格）
    let content = content.trim_start_matches('\u{feff}'); // 去除 BOM
    if !content.starts_with("---") {
        return None;
    }

    // 找到第一个换行符（跳过开头的 "---"）
    let after_first_delimiter = &content[3..];
    let first_newline = after_first_delimiter.find('\n')?;

    // 确保第一行 "---" 后面只有空格
    let first_line_rest = &after_first_delimiter[..first_newline].trim();
    if !first_line_rest.is_empty() {
        return None;
    }

    // 从第一个换行符之后开始查找结束分隔符 "---"
    let body_start = 3 + first_newline + 1;
    let body = &content[body_start..];

    // 查找结束的 "---"（必须在行首）
    // PLACEHOLDER_CONTINUE
    for (i, line) in body.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed == "---" {
            // 计算结束分隔符在 body 中的字节偏移
            let mut offset = 0;
            for (j, l) in body.lines().enumerate() {
                if j == i {
                    break;
                }
                offset += l.len() + 1; // +1 for '\n'
            }

            let frontmatter_text = &body[..offset];
            // 跳过结束分隔符行
            let after_end = offset + line.len();
            let remaining = &body[after_end..];
            // 跳过结束分隔符后的可选换行
            let markdown_content = remaining.strip_prefix('\n').unwrap_or(remaining);

            return Some((frontmatter_text, markdown_content));
        }
    }

    None
}

/// 解析 YAML frontmatter 为 SkillFrontmatter 结构体
///
/// 对应源码 `frontmatterParser.ts` 中的 `parseFrontmatter()` 函数。
/// 使用 `serde_yaml` 进行解析，解析失败时返回默认空值（与源码行为一致）。
fn parse_frontmatter(yaml_text: &str) -> SkillFrontmatter {
    // 尝试直接解析
    if let Ok(fm) = serde_yaml::from_str::<serde_yaml::Value>(yaml_text) {
        // 手动提取字段，因为 YAML 中的 key 使用 kebab-case
        // 而 Rust struct 使用 snake_case，需要手动映射
        if let serde_yaml::Value::Mapping(map) = fm {
            return extract_frontmatter_from_mapping(&map);
        }
    }
    SkillFrontmatter::default()
}

/// 从 YAML Mapping 中提取 frontmatter 字段
///
/// 手动映射 YAML 键名到 SkillFrontmatter 字段，
/// 因为 YAML 中使用 kebab-case（如 `allowed-tools`），
/// 而 serde 的 rename_all 无法同时处理 kebab-case 输入和 camelCase 输出。
fn extract_frontmatter_from_mapping(map: &serde_yaml::Mapping) -> SkillFrontmatter {
    /// 辅助函数：从 YAML Mapping 中获取字符串值
    fn get_str(map: &serde_yaml::Mapping, key: &str) -> Option<String> {
        map.get(serde_yaml::Value::String(key.to_string()))
            .and_then(|v| match v {
                serde_yaml::Value::String(s) => Some(s.clone()),
                serde_yaml::Value::Bool(b) => Some(b.to_string()),
                serde_yaml::Value::Number(n) => Some(n.to_string()),
                _ => None,
            })
    }

    /// 辅助函数：从 YAML Mapping 中获取 JSON Value（用于复杂类型字段）
    fn get_json_value(map: &serde_yaml::Mapping, key: &str) -> Option<serde_json::Value> {
        map.get(serde_yaml::Value::String(key.to_string()))
            .map(yaml_to_json)
    }

    SkillFrontmatter {
        name: get_str(map, "name"),
        description: get_str(map, "description"),
        allowed_tools: get_json_value(map, "allowed-tools"),
        when_to_use: get_str(map, "when_to_use"),
        model: get_str(map, "model"),
        user_invocable: get_json_value(map, "user-invocable"),
        disable_model_invocation: get_json_value(map, "disable-model-invocation"),
        context: get_str(map, "context"),
        agent: get_str(map, "agent"),
        argument_hint: get_str(map, "argument-hint"),
        version: get_str(map, "version"),
        paths: get_json_value(map, "paths"),
        shell: get_str(map, "shell"),
        effort: get_str(map, "effort"),
    }
}

/// 将 serde_yaml::Value 转换为 serde_json::Value
///
/// 用于处理 frontmatter 中的复杂类型字段（如数组、布尔值等），
/// 统一转换为 JSON Value 以便前端消费。
fn yaml_to_json(yaml: &serde_yaml::Value) -> serde_json::Value {
    match yaml {
        serde_yaml::Value::Null => serde_json::Value::Null,
        serde_yaml::Value::Bool(b) => serde_json::Value::Bool(*b),
        serde_yaml::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                serde_json::Value::Number(i.into())
            } else if let Some(f) = n.as_f64() {
                serde_json::json!(f)
            } else {
                serde_json::Value::Null
            }
        }
        serde_yaml::Value::String(s) => serde_json::Value::String(s.clone()),
        serde_yaml::Value::Sequence(seq) => {
            serde_json::Value::Array(seq.iter().map(yaml_to_json).collect())
        }
        serde_yaml::Value::Mapping(map) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in map {
                if let serde_yaml::Value::String(key) = k {
                    obj.insert(key.clone(), yaml_to_json(v));
                }
            }
            serde_json::Value::Object(obj)
        }
        serde_yaml::Value::Tagged(tagged) => yaml_to_json(&tagged.value),
    }
}

/// 从 frontmatter 中解析 allowed-tools 列表
///
/// 对应源码 `markdownConfigLoader.ts` 中的 `parseSlashCommandToolsFromFrontmatter()`。
/// 支持两种格式：
/// - 逗号分隔字符串：`"Bash, Read, Write"`
/// - YAML 数组：`["Bash", "Read", "Write"]`
fn parse_allowed_tools(value: &Option<serde_json::Value>) -> Vec<String> {
    match value {
        Some(serde_json::Value::String(s)) => {
            s.split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect()
        }
        Some(serde_json::Value::Array(arr)) => {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                .filter(|t| !t.is_empty())
                .collect()
        }
        _ => vec![],
    }
}

/// 解析 user-invocable 布尔值
///
/// 对应源码 `frontmatterParser.ts` 中的 `parseBooleanFrontmatter()`。
/// 只有 `true` 或 `"true"` 才返回 true，其他值（包括缺失）返回 false。
/// 但 skills 目录下默认为 true（缺失时）。
fn parse_bool_frontmatter(value: &Option<serde_json::Value>, default: bool) -> bool {
    match value {
        None => default,
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::String(s)) => s == "true",
        _ => default,
    }
}

/// 从 markdown 内容中提取描述（首段文本）
///
/// 对应源码 `markdownConfigLoader.ts` 中的 `extractDescriptionFromMarkdown()`。
/// 当 frontmatter 中没有 description 字段时，使用 markdown 内容的第一个非空行作为描述。
///
/// 与源码行为一致：
/// - 如果行是标题（`#` 开头），去掉 `#` 前缀和空格后使用标题文本
/// - 截断长度为 100 字符（超过时取前 97 字符 + "..."）
fn extract_description_from_markdown(content: &str, fallback_label: &str) -> String {
    // 遍历所有行，找到第一个非空行
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // 如果是标题行，去掉 `#` 前缀和空格后使用标题文本
        // 对应源码: const headerMatch = trimmed.match(/^#+\s+(.+)$/)
        //           const text = headerMatch?.[1] ?? trimmed
        let text = if let Some(after_hashes) = trimmed.strip_prefix('#') {
            // 继续去掉更多的 # 号
            let after_all_hashes = after_hashes.trim_start_matches('#');
            // 去掉 # 与文本之间的空格
            let header_text = after_all_hashes.trim_start();
            if header_text.is_empty() {
                // 只有 # 没有文本的情况，使用原始行
                trimmed
            } else {
                header_text
            }
        } else {
            trimmed
        };

        // 截取前 100 个字符作为描述（与源码一致：text.length > 100 ? text.substring(0, 97) + '...' : text）
        let desc = if text.len() > 100 {
            // 需要注意 UTF-8 字符边界，使用 char_indices 安全截断
            let truncated: String = text.chars().take(97).collect();
            format!("{}...", truncated)
        } else {
            text.to_string()
        };
        return desc;
    }
    format!("{} (no description)", fallback_label)
}

/// 解析 paths 字段
///
/// 对应源码 `loadSkillsDir.ts` 中的 `parseSkillPaths()`。
fn parse_paths(value: &Option<serde_json::Value>) -> Option<Vec<String>> {
    match value {
        Some(serde_json::Value::String(s)) => {
            let patterns: Vec<String> = s.split(',')
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty() && p != "**")
                .collect();
            if patterns.is_empty() { None } else { Some(patterns) }
        }
        Some(serde_json::Value::Array(arr)) => {
            let patterns: Vec<String> = arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                .filter(|p| !p.is_empty() && p != "**")
                .collect();
            if patterns.is_empty() { None } else { Some(patterns) }
        }
        _ => None,
    }
}

// ============================= 扫描逻辑 =============================

/// 从单个 SKILL.md 文件构建 SkillInfo
///
/// 读取并解析 SKILL.md 文件内容，提取 frontmatter 元数据，
/// 构建用于前端展示的 SkillInfo 结构体。
///
/// # 参数
/// - `skill_dir` - skill 目录路径（包含 SKILL.md 的目录）
/// - `skill_file` - SKILL.md 文件的完整路径
/// - `source` - skill 来源类型
/// - `skill_name` - skill 名称（通常为目录名）
fn build_skill_info_from_file(
    raw_content: &str,
    skill_file: &Path,
    source: SkillSource,
    skill_name: &str,
) -> SkillInfo {
    // 解析 frontmatter
    let (frontmatter, markdown_content) = match split_frontmatter(raw_content) {
        Some((fm_text, md)) => (parse_frontmatter(fm_text), md),
        None => (crate::models::skill::SkillFrontmatter::default(), raw_content),
    };

    // 提取描述：优先使用 frontmatter 中的 description，否则从 markdown 首段提取
    let description = frontmatter
        .description
        .clone()
        .unwrap_or_else(|| extract_description_from_markdown(markdown_content, "Skill"));

    // 解析 allowed-tools 列表
    let allowed_tools = parse_allowed_tools(&frontmatter.allowed_tools);

    // 解析 user-invocable（skills 目录默认为 true）
    let user_invocable = parse_bool_frontmatter(&frontmatter.user_invocable, true);

    // 解析 paths
    let paths = parse_paths(&frontmatter.paths);

    SkillInfo {
        name: skill_name.to_string(),
        display_name: frontmatter.name.clone(),
        description,
        source,
        source_path: skill_file.to_string_lossy().to_string(),
        user_invocable,
        model: frontmatter.model.clone(),
        context: frontmatter.context.clone(),
        allowed_tools,
        when_to_use: frontmatter.when_to_use.clone(),
        version: frontmatter.version.clone(),
        argument_hint: frontmatter.argument_hint.clone(),
        paths,
    }
}

/// 扫描单个 skills 目录
///
/// 对应源码 `loadSkillsDir.ts` 中的 `loadSkillsFromSkillsDir()` 函数。
/// 只支持目录格式：每个子目录包含一个 `SKILL.md` 文件。
///
/// # 参数
/// - `skills_dir` - skills 目录路径（如 `~/.claude/skills/`）
/// - `source` - skill 来源类型
///
/// # 返回值
/// 发现的所有 skill 信息列表
async fn scan_skills_dir(skills_dir: &Path, source: SkillSource) -> Vec<SkillInfo> {
    let mut skills = Vec::new();

    // 尝试读取目录，如果不存在则静默返回空列表
    let mut entries = match fs::read_dir(skills_dir).await {
        Ok(entries) => entries,
        Err(_) => return skills,
    };

    // 遍历目录中的每个条目
    while let Ok(Some(entry)) = entries.next_entry().await {
        let entry_path = entry.path();

        // 只处理目录（或符号链接指向的目录）
        let is_dir = match entry.file_type().await {
            Ok(ft) => ft.is_dir() || ft.is_symlink(),
            Err(_) => continue,
        };

        if !is_dir {
            continue;
        }

        // 检查目录内是否存在 SKILL.md
        let skill_file = entry_path.join("SKILL.md");
        let raw_content = match fs::read_to_string(&skill_file).await {
            Ok(content) => content,
            Err(_) => continue, // SKILL.md 不存在，跳过
        };

        // 使用目录名作为 skill 名称
        let skill_name = entry
            .file_name()
            .to_string_lossy()
            .to_string();

        let info = build_skill_info_from_file(
            &raw_content,
            &skill_file,
            source.clone(),
            &skill_name,
        );

        skills.push(info);
    }

    skills
}

/// 扫描旧版 commands 目录（支持嵌套命名空间）
///
/// 对应源码 `loadSkillsDir.ts` 中的 `loadSkillsFromCommandsDir()` 函数。
/// 同时支持两种格式：
/// - 目录格式：`command-name/SKILL.md`
/// - 单文件格式：`command-name.md`
///
/// 支持嵌套目录构建命名空间（与源码 `buildNamespace()` 一致）：
/// - `commands/category/subcmd.md` → 命名空间 `category:subcmd`
/// - `commands/a/b/cmd.md` → 命名空间 `a:b:cmd`
///
/// # 参数
/// - `commands_dir` - commands 目录路径（如 `~/.claude/commands/`）
async fn scan_commands_dir(commands_dir: &Path) -> Vec<SkillInfo> {
    // 使用递归辅助函数，初始命名空间为空
    scan_commands_dir_recursive(commands_dir, commands_dir).await
}

/// 递归扫描 commands 目录的内部辅助函数
///
/// 通过 `base_dir` 和当前 `current_dir` 的相对路径关系，
/// 构建 `:` 分隔的嵌套命名空间（对应源码中的 `buildNamespace()`）。
///
/// # 参数
/// - `current_dir` - 当前正在扫描的目录
/// - `base_dir` - commands 根目录（用于计算相对路径/命名空间）
fn scan_commands_dir_recursive<'a>(
    current_dir: &'a Path,
    base_dir: &'a Path,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Vec<SkillInfo>> + Send + 'a>> {
    Box::pin(async move {
    let mut skills = Vec::new();

    let mut entries = match fs::read_dir(current_dir).await {
        Ok(entries) => entries,
        Err(_) => return skills,
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let entry_path = entry.path();
        let file_type = match entry.file_type().await {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        if file_type.is_dir() || file_type.is_symlink() {
            // 先检查目录内是否有 SKILL.md（目录格式的 skill）
            let skill_file = entry_path.join("SKILL.md");
            if let Ok(raw_content) = fs::read_to_string(&skill_file).await {
                // 目录格式：使用目录名作为命令基础名
                // 对应源码 getSkillCommandName: commandBaseName = basename(skillDirectory)
                // namespace = buildNamespace(parentOfSkillDir, baseDir)
                let command_base_name = entry.file_name().to_string_lossy().to_string();
                let namespace = build_namespace(current_dir, base_dir);
                let skill_name = if namespace.is_empty() {
                    command_base_name
                } else {
                    format!("{}:{}", namespace, command_base_name)
                };
                let info = build_skill_info_from_file(
                    &raw_content,
                    &skill_file,
                    SkillSource::LegacyCommands,
                    &skill_name,
                );
                skills.push(info);
            } else {
                // 没有 SKILL.md，递归扫描子目录
                let sub_skills = scan_commands_dir_recursive(&entry_path, base_dir).await;
                skills.extend(sub_skills);
            }
        } else if file_type.is_file() {
            // 单文件格式：command-name.md
            let file_name = entry.file_name().to_string_lossy().to_string();
            if !file_name.ends_with(".md") {
                continue;
            }

            if let Ok(raw_content) = fs::read_to_string(&entry_path).await {
                // 对应源码 getRegularCommandName: commandBaseName = fileName.replace(/\.md$/, '')
                // namespace = buildNamespace(fileDirectory, baseDir)
                let command_base_name = file_name.trim_end_matches(".md").to_string();
                let namespace = build_namespace(current_dir, base_dir);
                let skill_name = if namespace.is_empty() {
                    command_base_name
                } else {
                    format!("{}:{}", namespace, command_base_name)
                };
                let info = build_skill_info_from_file(
                    &raw_content,
                    &entry_path,
                    SkillSource::LegacyCommands,
                    &skill_name,
                );
                skills.push(info);
            }
        }
    }

    skills
    })
}

/// 构建命名空间字符串
///
/// 对应源码 `loadSkillsDir.ts` 中的 `buildNamespace()` 函数。
/// 通过 target_dir 相对于 base_dir 的路径，用 `:` 连接各层目录名。
///
/// 例如：
/// - target_dir = `/home/user/.claude/commands/category`, base_dir = `/home/user/.claude/commands`
///   → 返回 `"category"`
/// - target_dir = base_dir → 返回 `""`（空字符串，无命名空间）
fn build_namespace(target_dir: &Path, base_dir: &Path) -> String {
    // 如果 target_dir 与 base_dir 相同，无命名空间
    if target_dir == base_dir {
        return String::new();
    }

    // 计算相对路径，用 `:` 连接各层目录名
    match target_dir.strip_prefix(base_dir) {
        Ok(relative) => {
            let parts: Vec<&str> = relative
                .components()
                .filter_map(|c| c.as_os_str().to_str())
                .collect();
            parts.join(":")
        }
        Err(_) => String::new(),
    }
}

// ============================= 公共 API =============================

/// 获取 Claude 配置主目录路径
///
/// 对应源码 `envUtils.ts` 中的 `getClaudeConfigHomeDir()`。
/// 返回 `~/.claude/` 路径。
fn get_claude_config_home() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
}

/// 获取 managed（企业策略）配置文件路径
///
/// 对应源码 `utils/settings/managedPath.ts` 中的 `getManagedFilePath()`。
/// 根据操作系统平台返回不同的路径：
/// - macOS: `/Library/Application Support/ClaudeCode`
/// - Windows: `C:\Program Files\ClaudeCode`
/// - Linux 及其他: `/etc/claude-code`
fn get_managed_file_path() -> PathBuf {
    if cfg!(target_os = "macos") {
        PathBuf::from("/Library/Application Support/ClaudeCode")
    } else if cfg!(target_os = "windows") {
        PathBuf::from(r"C:\Program Files\ClaudeCode")
    } else {
        PathBuf::from("/etc/claude-code")
    }
}

/// 获取所有项目级 skills 目录
///
/// 对应源码 `markdownConfigLoader.ts` 中的 `getProjectDirsUpToHome()`。
/// 从给定的项目路径开始，向上遍历目录树直到用户主目录，
/// 收集所有包含 `.claude/skills/` 的目录路径。
///
/// # 参数
/// - `project_path` - 项目根目录路径
fn get_project_skills_dirs(project_path: &str) -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut dirs_list = Vec::new();
    let mut current = PathBuf::from(project_path);

    // 向上遍历，直到到达 home 目录（不包含 home 本身，因为它被 user 级别覆盖）
    loop {
        // 如果到达 home 目录，停止
        if current == home {
            break;
        }

        let skills_dir = current.join(".claude").join("skills");
        dirs_list.push(skills_dir);

        // 移动到父目录
        match current.parent() {
            Some(parent) if parent != current => {
                current = parent.to_path_buf();
            }
            _ => break, // 到达文件系统根目录
        }
    }

    dirs_list
}

/// 获取所有项目级 commands 目录（旧版）
///
/// 与 `get_project_skills_dirs` 类似，但扫描 `.claude/commands/` 目录。
fn get_project_commands_dirs(project_path: &str) -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut dirs_list = Vec::new();
    let mut current = PathBuf::from(project_path);

    loop {
        if current == home {
            break;
        }

        let commands_dir = current.join(".claude").join("commands");
        dirs_list.push(commands_dir);

        match current.parent() {
            Some(parent) if parent != current => {
                current = parent.to_path_buf();
            }
            _ => break,
        }
    }

    dirs_list
}

/// 列出所有可用的 Skills
///
/// 这是 skills 功能的核心公共 API。并行扫描所有 skills 来源目录，
/// 合并去重后返回完整的 skill 列表。
///
/// 扫描顺序和优先级对齐源码 `loadSkillsDir.ts` 中的 `getSkillDirCommands()`：
/// 1. 用户级 skills：`~/.claude/skills/`
/// 2. 项目级 skills：从项目目录向上遍历到 home
/// 3. 旧版用户级 commands：`~/.claude/commands/`
/// 4. 旧版项目级 commands：从项目目录向上遍历到 home
///
/// # 参数
/// - `project_path` - 可选的项目根目录路径。提供时扫描项目级 skills。
///
/// # 返回值
/// 去重后的所有 skill 信息列表
pub async fn list_all_skills(project_path: Option<&str>) -> Result<Vec<SkillInfo>, String> {
    let claude_home = get_claude_config_home();
    let managed_base = get_managed_file_path();
    let mut all_skills: Vec<SkillInfo> = Vec::new();

    // 0. 扫描 managed（企业策略）skills：<managed_path>/.claude/skills/
    // 对应源码 loadSkillsDir.ts:641: managedSkillsDir = join(getManagedFilePath(), '.claude', 'skills')
    // managed skills 优先级最高，排在最前面
    let managed_skills_dir = managed_base.join(".claude").join("skills");
    let managed_skills = scan_skills_dir(&managed_skills_dir, SkillSource::Managed).await;
    all_skills.extend(managed_skills);

    // 1. 扫描用户级 skills：~/.claude/skills/
    let user_skills_dir = claude_home.join("skills");
    let user_skills = scan_skills_dir(&user_skills_dir, SkillSource::User).await;
    all_skills.extend(user_skills);

    // 2. 扫描项目级 skills（如果提供了项目路径）
    if let Some(proj_path) = project_path {
        let project_dirs = get_project_skills_dirs(proj_path);
        for dir in project_dirs {
            let project_skills = scan_skills_dir(&dir, SkillSource::Project).await;
            all_skills.extend(project_skills);
        }
    }

    // 3. 扫描旧版用户级 commands：~/.claude/commands/
    let user_commands_dir = claude_home.join("commands");
    let legacy_commands = scan_commands_dir(&user_commands_dir).await;
    all_skills.extend(legacy_commands);

    // 4. 扫描旧版项目级 commands（如果提供了项目路径）
    if let Some(proj_path) = project_path {
        let project_cmd_dirs = get_project_commands_dirs(proj_path);
        for dir in project_cmd_dirs {
            let project_commands = scan_commands_dir(&dir).await;
            all_skills.extend(project_commands);
        }
    }

    // 去重：同名 skill 保留先出现的（优先级高的）
    let mut seen_names = std::collections::HashSet::new();
    all_skills.retain(|skill| seen_names.insert(skill.name.clone()));

    Ok(all_skills)
}

/// 校验 skill 文件路径是否安全
///
/// 防止路径穿越攻击：前端传入的 `source_path` 必须满足以下条件：
/// 1. 文件名以 `.md` 结尾
/// 2. 路径 canonicalize 后位于允许的目录前缀之下：
///    - `~/.claude/`（用户级 skills/commands）
///    - 项目目录下的 `.claude/`（项目级 skills/commands）
///    - managed 路径下的 `.claude/`（企业策略级 skills）
///
/// # 参数
/// - `source_path` - 待校验的文件路径
///
/// # 返回值
/// - `Ok(PathBuf)` - 校验通过，返回 canonicalize 后的安全路径
/// - `Err(String)` - 校验失败，返回错误说明
fn validate_skill_path(source_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(source_path);

    // 条件 1：文件名必须以 .md 结尾
    match path.extension() {
        Some(ext) if ext == "md" => {}
        _ => return Err("skill 文件路径必须以 .md 结尾".to_string()),
    }

    // 条件 2：canonicalize 路径（解析 .., 符号链接等），防止 ../../ 穿越
    let canonical = path.canonicalize().map_err(|e| {
        format!("无法解析 skill 文件路径: {}", e)
    })?;

    // 构建允许的目录前缀列表
    let mut allowed_prefixes: Vec<PathBuf> = Vec::new();

    // 允许前缀 1：~/.claude/（用户级）
    if let Some(home) = dirs::home_dir() {
        allowed_prefixes.push(home.join(".claude"));
    }

    // 允许前缀 2：managed 路径下的 .claude/（企业策略级）
    let managed_base = get_managed_file_path();
    allowed_prefixes.push(managed_base.join(".claude"));

    // 检查 canonical 路径是否以任何一个允许的前缀开头
    let is_allowed = allowed_prefixes.iter().any(|prefix| {
        // 也需要 canonicalize 前缀目录（如果目录存在的话）
        let canonical_prefix = prefix.canonicalize().unwrap_or_else(|_| prefix.clone());
        canonical.starts_with(&canonical_prefix)
    });

    if !is_allowed {
        return Err("skill 文件路径不在允许的目录范围内（需位于 ~/.claude/ 或 managed 配置目录下）".to_string());
    }

    Ok(canonical)
}

/// 获取指定 Skill 的详细信息
///
/// 读取 SKILL.md 的完整内容，返回包含 frontmatter 和 markdown 内容的详情。
/// 在读取前会校验路径安全性，防止路径穿越攻击。
///
/// # 参数
/// - `source_path` - SKILL.md 文件的完整路径（从 SkillInfo.source_path 获取）
///
/// # 返回值
/// 包含完整内容的 SkillDetail
pub async fn get_skill_detail(source_path: &str) -> Result<SkillDetail, String> {
    // 安全校验：防止路径穿越攻击
    let canonical_path = validate_skill_path(source_path)?;
    let path = canonical_path.as_path();

    // 读取文件内容
    let raw_content = fs::read_to_string(path)
        .await
        .map_err(|e| format!("读取 skill 文件失败: {}", e))?;

    // 解析 frontmatter 和 markdown 内容
    let (frontmatter_text, markdown_content) = match split_frontmatter(&raw_content) {
        Some((fm, md)) => (fm, md),
        None => ("", raw_content.as_str()),
    };

    let _frontmatter = parse_frontmatter(frontmatter_text);

    // 确定 skill 名称（从路径推断）
    let skill_name = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // 确定来源类型（从路径推断）
    let source = infer_source_from_path(path);

    // 构建基本信息
    let info = build_skill_info_from_file(&raw_content, path, source, &skill_name);

    Ok(SkillDetail {
        info,
        raw_content: raw_content.clone(),
        markdown_content: markdown_content.to_string(),
    })
}

/// 从文件路径推断 skill 来源类型
///
/// 通过检查路径中的特征目录名来判断 skill 的来源：
/// - 包含 managed 路径前缀 → Managed
/// - 包含 `/.claude/skills/` → 根据是否在 home 目录下判断 User/Project
/// - 包含 `/.claude/commands/` → LegacyCommands
fn infer_source_from_path(path: &Path) -> SkillSource {
    let path_str = path.to_string_lossy();
    // 统一路径分隔符为 /，便于跨平台匹配
    let normalized = path_str.replace('\\', "/");

    let home = dirs::home_dir()
        .map(|h| h.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    // 检查是否在 managed 路径下
    let managed = get_managed_file_path().to_string_lossy().replace('\\', "/");
    if normalized.starts_with(&format!("{}/.claude/", managed)) {
        return SkillSource::Managed;
    }

    if normalized.contains("/.claude/commands/") || normalized.contains("/.claude/commands\\") {
        SkillSource::LegacyCommands
    } else if normalized.starts_with(&format!("{}/.claude/skills/", home)) {
        SkillSource::User
    } else {
        SkillSource::Project
    }
}

