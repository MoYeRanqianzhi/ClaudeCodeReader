//! # 消息分类器
//!
//! 将原始 `serde_json::Value` 消息分类为不同的显示类型，
//! 与前端 `messageTransform.ts` 的分类逻辑完全等价，但利用 Rust 原生性能。
//!
//! ## 分类优先级
//! 1. type 字段过滤：非 user/assistant → Skip
//! 2. assistant → Assistant
//! 3. isCompactSummary → CompactSummary
//! 4. `<command-name>` 配对标签 → SlashCommand
//! 5. 字段级系统消息（isMeta / sourceToolUseID / caller）→ System
//! 6. 语义级系统消息（计划执行）→ System
//! 7. 内容级系统消息（协议 XML 标签配对验证）→ System
//! 8. 默认 → User
//!
//! ## 性能策略
//! - 零 regex（7 个标签检查）：使用 `str::strip_prefix` + `str::contains`
//! - 预编译 regex（仅 2 个）：使用 `std::sync::LazyLock`
//! - 早退出：type 字段 → 布尔字段 → 文本提取 → str 检查 → regex
//! - 零拷贝文本提取：`Cow<'_, str>`，字符串 content 直接引用 Value，数组才 join

use std::borrow::Cow;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

/// 消息分类结果枚举
///
/// 每种分类决定了后续 `transformer` 如何构建 `DisplayMessage`
#[derive(Debug)]
pub enum Classification {
    /// 跳过：非 user/assistant 类型（file-history-snapshot, queue-operation 等）
    Skip,
    /// 助手消息：直接映射
    Assistant,
    /// 压缩摘要：isCompactSummary 为 true 的 user 消息
    CompactSummary,
    /// 斜杠命令：以 `<command-name>/xxx</command-name>` 开头的 user 消息
    /// 包含提取到的命令名（如 "/compact"）
    SlashCommand(String),
    /// 系统消息：CLI 自动注入的各类消息
    /// - `label`：子类型标签（"技能" / "计划" / "系统"）
    /// - `plan_source_path`：仅计划消息有值，引用的源会话 JSONL 路径
    System {
        label: String,
        plan_source_path: Option<String>,
    },
    /// 普通用户消息：需要拆分 tool_result 块
    User,
}

/// 需要配对验证的系统 XML 标签列表
///
/// 当 user 消息的文本以 `<tag_name>` 开头，且后续包含 `</tag_name>` 时，
/// 判定为系统自动注入的消息。
///
/// 所有标签检查均锚定到文本开头，不会被消息正文中偶然出现的同名标签误触发。
const SYSTEM_TAGS: &[&str] = &[
    "local-command-stdout",
    "local-command-caveat",
    "system-reminder",
    "user-prompt-submit-hook",
    "task-notification",
];

/// 计划执行消息中的 JSONL 文件路径匹配正则
///
/// 匹配 "read the full transcript at: <path>.jsonl" 中的文件路径。
/// 使用 `LazyLock` 实现全局唯一的预编译正则，避免重复编译开销。
static PLAN_JSONL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"read the full transcript at:\s*(.+?\.jsonl)").unwrap());

/// Markdown 标题检测正则
///
/// 匹配行首的一级或二级 Markdown 标题（`# ` 或 `## `），
/// 用于计划执行消息的第三个验证条件。
static HEADING_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^#{1,2}\s").unwrap());

/// 验证文本以 `<tag_name>` 开头，且在其后包含 `</tag_name>`
///
/// 相比仅匹配开标签的做法，配对验证可以避免将 git diff 等内容中
/// 偶然出现的类似标签误判为系统消息。
///
/// # 参数
/// - `text` - 消息文本内容
/// - `tag_name` - 要验证的 XML 标签名（不含尖括号）
///
/// # 返回值
/// 开标签和闭标签都存在时返回 true
fn has_valid_tag_pair(text: &str, tag_name: &str) -> bool {
    // 构建开标签 "<tag_name>" 和闭标签 "</tag_name>"
    let open = format!("<{}>", tag_name);
    let close = format!("</{}>", tag_name);
    // 验证：文本以开标签起始，且后续包含闭标签
    if let Some(rest) = text.strip_prefix(&open) {
        rest.contains(&close)
    } else {
        false
    }
}

/// 从 `<command-name>/xxx</command-name>` 标签中提取斜杠命令名称
///
/// 使用配对标签验证（同时检查开标签和闭标签），
/// 并验证提取的命令名以 '/' 开头。
///
/// # 参数
/// - `text` - 消息文本内容
///
/// # 返回值
/// - `Some(cmd)` - 提取到的命令名（如 "/compact"），包含开头的斜杠
/// - `None` - 不是斜杠命令格式
fn extract_slash_command(text: &str) -> Option<&str> {
    // 尝试去除开标签前缀
    let rest = text.strip_prefix("<command-name>")?;
    // 查找闭标签位置
    let end = rest.find("</command-name>")?;
    // 提取标签内容
    let cmd = &rest[..end];
    // 验证命令名以 '/' 开头（过滤无效标签内容）
    cmd.starts_with('/').then_some(cmd)
}

/// 严格判断文本是否为"计划执行"消息，同时提取 JSONL 源路径
///
/// 必须同时满足三个条件：
/// 1. 文本以 "Implement the following plan:\n\n#" 开头
/// 2. 文本中包含 "read the full transcript at: <path>.jsonl"
/// 3. 文本中包含 Markdown 标题结构（至少有 # 一级或 ## 二级标题）
///
/// # 参数
/// - `text` - 消息的纯文本内容
///
/// # 返回值
/// - `Some(path)` - 匹配时返回提取到的 JSONL 源文件路径
/// - `None` - 不是计划执行消息
fn is_plan_execution(text: &str) -> Option<String> {
    // 条件 1：开头严格匹配（与 TS 版 isPlanExecution 一致）
    if !text.starts_with("Implement the following plan:\n\n#") {
        return None;
    }
    // 条件 2：包含 JSONL 文件引用
    let caps = PLAN_JSONL_RE.captures(text)?;
    let jsonl_path = caps.get(1)?.as_str().to_string();
    // 条件 3：包含 Markdown 标题
    if !HEADING_RE.is_match(text) {
        return None;
    }
    Some(jsonl_path)
}

/// 从消息中提取纯文本内容，用于分类检测
///
/// 处理 `message.content` 的两种格式：
/// - 字符串格式：零拷贝返回 `Cow::Borrowed`
/// - 数组格式：提取所有 text 块的 text 字段，join 后返回 `Cow::Owned`
///
/// # 参数
/// - `msg` - 原始消息 Value
///
/// # 返回值
/// 提取到的纯文本，无内容时返回空字符串
fn extract_text(msg: &Value) -> Cow<'_, str> {
    // 获取 message.content 字段
    let content = msg
        .get("message")
        .and_then(|m| m.get("content"));

    match content {
        // 字符串格式：直接借用，零拷贝
        Some(Value::String(s)) => Cow::Borrowed(s.as_str()),
        // 数组格式：提取所有 text 类型块的 text 字段
        Some(Value::Array(arr)) => {
            let mut buf = String::new();
            for block in arr {
                if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                    if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                        if !buf.is_empty() {
                            buf.push('\n');
                        }
                        buf.push_str(t);
                    }
                }
            }
            Cow::Owned(buf)
        }
        _ => Cow::Borrowed(""),
    }
}

/// 消息分类主函数
///
/// 将一条原始 `serde_json::Value` 消息分类为 `Classification` 枚举值。
/// 优先级与前端 `messageTransform.ts` 的 `transformForDisplay` 完全一致。
///
/// ## 分类优先级
/// 1. type 不是 "user" 或 "assistant" → Skip
/// 2. type === "assistant" → Assistant
/// 3. isCompactSummary === true → CompactSummary
/// 4. `<command-name>/xxx</command-name>` 配对标签 → SlashCommand
/// 5. isMeta === true → System("技能"/"系统")
/// 6. sourceToolUseID 存在 → System("技能")
/// 7. caller 存在 → System("系统")
/// 8. 计划执行消息（三条件严格匹配）→ System("计划")
/// 9. 系统 XML 标签配对验证 → System("系统")
/// 10. 默认 → User
///
/// # 参数
/// - `msg` - 原始消息 `serde_json::Value`
///
/// # 返回值
/// 分类结果 `Classification`
pub fn classify(msg: &Value) -> Classification {
    // 获取消息 type 字段
    let msg_type = msg
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // P0：过滤非聊天消息（file-history-snapshot, queue-operation, custom-title, tag）
    if msg_type != "user" && msg_type != "assistant" {
        return Classification::Skip;
    }

    // P1：assistant 消息直接映射
    if msg_type == "assistant" {
        return Classification::Assistant;
    }

    // ---- 以下均为 user 消息的分类 ----

    // P2：压缩摘要（isCompactSummary 字段级判断，最优先）
    if msg
        .get("isCompactSummary")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return Classification::CompactSummary;
    }

    // 提取纯文本用于后续检测（零拷贝 Cow）
    let text = extract_text(msg);

    // P3：斜杠命令（配对标签验证，锚定开头）
    if let Some(cmd) = extract_slash_command(&text) {
        return Classification::SlashCommand(cmd.to_string());
    }

    // P4：系统消息 - 字段级判断（最可靠）

    // isMeta：元数据消息（skill 上下文、系统告示等）
    if msg
        .get("isMeta")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        // 细分：以 "Base directory for this skill:" 开头 → 技能
        let label = if text.starts_with("Base directory for this skill:") {
            "技能"
        } else {
            "系统"
        };
        return Classification::System {
            label: label.into(),
            plan_source_path: None,
        };
    }

    // sourceToolUseID：由工具调用触发的注入消息（通常是 skill 展开的提示词）
    if msg.get("sourceToolUseID").is_some() {
        return Classification::System {
            label: "技能".into(),
            plan_source_path: None,
        };
    }

    // caller：由钩子等自动化组件触发的消息
    if msg.get("caller").is_some() {
        return Classification::System {
            label: "系统".into(),
            plan_source_path: None,
        };
    }

    // P5：系统消息 - 语义级判断（计划执行消息，严格三条件匹配）
    if let Some(path) = is_plan_execution(&text) {
        return Classification::System {
            label: "计划".into(),
            plan_source_path: Some(path),
        };
    }

    // P6：系统消息 - 内容级判断（协议 XML 标签配对验证）
    for tag in SYSTEM_TAGS {
        if has_valid_tag_pair(&text, tag) {
            return Classification::System {
                label: "系统".into(),
                plan_source_path: None,
            };
        }
    }

    // P7：默认 → 普通用户消息
    Classification::User
}
