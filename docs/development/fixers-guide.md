# 一键修复开发指南（Fixers Guide）

## 概述

一键修复（Quick Fix）是 CCR 提供的可扩展修复框架，允许开发者为常见的 Claude Code 会话问题添加自动化修复方案。用户通过"实用工具 → 一键修复"弹窗浏览、搜索并执行修复。

## 目录结构

```
src-tauri/src/services/fixers/
├── mod.rs                  # 注册表 + 数据结构 + 执行引擎
├── strip_thinking.rs       # 修复项：去除 thinking 块（Entry 档位）
└── <your_new_fixer>.rs     # 你的新修复项
```

## 架构说明

采用**函数指针注册表 + 四级分档**模式：

- 每个修复项是一个独立的 Rust 模块（`.rs` 文件）
- 每个模块导出两个函数：
  - `definition()` → `FixDefinition` — 元数据（含 `level` 档位字段）
  - `execute(...)` → `Pin<Box<Future<FixResult>>>` — 修复逻辑（签名因档位而异）
- 所有修复项在 `mod.rs` 的 `all_fixers()` 函数中注册
- 框架根据档位自动分配权限和参数

## 四级档位设计

| 档位 | 名称 | 权限范围 | execute 参数 | 写回方式 | 前端标注 |
|------|------|----------|-------------|----------|----------|
| **Entry** | 条目修复 | 只能操作解析后的消息条目 | `&mut Vec<SessionMessage>` | 框架自动覆写 | 绿色 |
| **Content** | 内容修复 | 只能操作文件原始文本 | `&str`（文件内容） | 框架自动覆写 | 蓝色 |
| **File** | 文件修复 | 仅限操作该会话文件 | `&str` + `&AppCache` | 修复自行操作 | 橙色 |
| **Full** | 特殊修复 | 完全权限，无限制 | `&str` + `&AppCache` | 修复自行操作 | 红色 |

### 如何选择档位

- **Entry（推荐）**：修复逻辑只需增删改查消息条目（如过滤内容块、修改字段值）。绝大多数修复应优先使用此档位。
- **Content**：修复逻辑需要操作文件的原始文本（如修复格式错乱、编码问题），但不需要直接操作文件系统。
- **File**：修复逻辑需要直接操作文件（如重命名、拆分文件），但仅限于该会话文件。
- **Full**：修复逻辑需要跨目录操作或访问非会话文件。仅在特殊场景下使用。

**原则：选择满足需求的最低档位。** Entry 和 Content 档位的文件读写完全由框架处理，修复逻辑无法接触文件系统，安全性最高。

## 添加新修复的步骤

### 第 1 步：创建修复模块

在 `src-tauri/src/services/fixers/` 下创建新文件。根据选择的档位，使用对应的代码模板：

#### Entry 档位模板（推荐）

```rust
//! # 修复项：<问题名称>
//!
//! ## 档位：Entry（条目修复）
//!
//! 该修复只操作解析后的消息条目，不直接访问文件系统。
//! 框架自动负责文件读取和覆写。
//!
//! ## 问题描述
//! <详细描述问题发生的场景和错误信息>
//!
//! ## 修复方式
//! <描述修复逻辑>

use std::future::Future;
use std::pin::Pin;

use crate::models::message::SessionMessage;
use crate::services::fixers::{FixDefinition, FixLevel, FixResult};

/// 返回修复项的元数据定义
pub fn definition() -> FixDefinition {
    FixDefinition {
        id: "my_fixer".to_string(),
        name: "问题名称".to_string(),
        description: "详细描述...".to_string(),
        fix_method: "修复说明...".to_string(),
        tags: vec!["tag1".to_string(), "tag2".to_string()],
        level: FixLevel::Entry,
    }
}

/// 执行修复（Entry 档位函数指针入口）
///
/// 接收框架已解析好的消息列表，在原地修改消息条目。
/// 修复完成后框架会根据 `affected_lines` 判断是否需要覆写文件。
pub fn execute<'a>(
    messages: &'a mut Vec<SessionMessage>,
) -> Pin<Box<dyn Future<Output = Result<FixResult, String>> + Send + 'a>> {
    Box::pin(execute_inner(messages))
}

/// 修复逻辑的内部实现
async fn execute_inner(
    messages: &mut Vec<SessionMessage>,
) -> Result<FixResult, String> {
    let mut affected_count = 0;

    for msg in messages.iter_mut() {
        // ... 操作消息条目（serde_json::Value）...
        // 如有修改：affected_count += 1;
    }

    if affected_count == 0 {
        return Ok(FixResult {
            success: true,
            message: "未发现需要修复的内容".to_string(),
            affected_lines: 0,
        });
    }

    // 不需要调用 write，框架会看 affected_lines > 0 自动覆写
    Ok(FixResult {
        success: true,
        message: format!("成功修复 {} 条消息", affected_count),
        affected_lines: affected_count,
    })
}
```

#### Content 档位模板

```rust
//! # 修复项：<问题名称>
//!
//! ## 档位：Content（内容修复）
//!
//! 该修复操作文件的原始文本内容，不直接访问文件系统。
//! 框架自动负责文件读取和覆写。

use std::future::Future;
use std::pin::Pin;

use crate::services::fixers::{FixDefinition, FixLevel, FixResult};

pub fn definition() -> FixDefinition {
    FixDefinition {
        id: "my_content_fixer".to_string(),
        name: "问题名称".to_string(),
        description: "详细描述...".to_string(),
        fix_method: "修复说明...".to_string(),
        tags: vec!["tag1".to_string()],
        level: FixLevel::Content,
    }
}

/// 执行修复（Content 档位函数指针入口）
///
/// 接收文件原始文本内容，返回修复结果和修改后的新内容。
/// 框架自动负责文件读取和覆写。
pub fn execute<'a>(
    content: &'a str,
) -> Pin<Box<dyn Future<Output = Result<(FixResult, String), String>> + Send + 'a>> {
    Box::pin(execute_inner(content))
}

async fn execute_inner(
    content: &str,
) -> Result<(FixResult, String), String> {
    let mut new_content = content.to_string();
    let mut affected_count = 0;

    // ... 操作文本内容 ...
    // 修改 new_content，更新 affected_count

    if affected_count == 0 {
        return Ok((
            FixResult {
                success: true,
                message: "未发现需要修复的内容".to_string(),
                affected_lines: 0,
            },
            new_content,
        ));
    }

    Ok((
        FixResult {
            success: true,
            message: format!("成功修复 {} 处内容", affected_count),
            affected_lines: affected_count,
        },
        new_content,
    ))
}
```

#### File 档位模板

```rust
//! # 修复项：<问题名称>
//!
//! ## 档位：File（文件修复）
//!
//! 该修复拥有对会话文件的直接操作权限。
//! 框架会预先验证路径在 `~/.claude/` 目录下。

use std::future::Future;
use std::pin::Pin;

use crate::services::cache::AppCache;
use crate::services::fixers::{FixDefinition, FixLevel, FixResult};
use crate::services::file_guard;

pub fn definition() -> FixDefinition {
    FixDefinition {
        id: "my_file_fixer".to_string(),
        name: "问题名称".to_string(),
        description: "详细描述...".to_string(),
        fix_method: "修复说明...".to_string(),
        tags: vec!["tag1".to_string()],
        level: FixLevel::File,
    }
}

/// 执行修复（File 档位函数指针入口）
///
/// 接收文件路径和 AppCache 引用，修复项自行进行文件操作。
/// 注意：必须通过 `file_guard::safe_write_file()` 写入文件。
pub fn execute<'a>(
    session_file_path: &'a str,
    cache: &'a AppCache,
) -> Pin<Box<dyn Future<Output = Result<FixResult, String>> + Send + 'a>> {
    Box::pin(execute_inner(session_file_path, cache))
}

async fn execute_inner(
    session_file_path: &str,
    cache: &AppCache,
) -> Result<FixResult, String> {
    // ... 自行操作文件 ...
    // 写入时必须使用 file_guard::safe_write_file()

    Ok(FixResult {
        success: true,
        message: "修复完成".to_string(),
        affected_lines: 0,
    })
}
```

#### Full 档位模板

与 File 模板相同的函数签名，但将 `level` 设为 `FixLevel::Full`。
框架不会对 Full 档位进行路径限制。仅在确实需要跨目录操作时使用。

### 第 2 步：在注册表中注册

编辑 `src-tauri/src/services/fixers/mod.rs`：

1. 在文件顶部添加模块声明：

```rust
pub mod strip_thinking;
pub mod my_fixer;  // ← 新增
```

2. 在 `all_fixers()` 函数中用**对应档位的 `FixerExecutor` 变体**注册：

```rust
pub fn all_fixers() -> Vec<FixerEntry> {
    vec![
        // 已有修复项
        FixerEntry {
            definition: strip_thinking::definition,
            executor: FixerExecutor::Entry(strip_thinking::execute),
        },
        // ← 新增（以 Entry 档位为例）
        FixerEntry {
            definition: my_fixer::definition,
            executor: FixerExecutor::Entry(my_fixer::execute),
        },
    ]
}
```

不同档位对应的变体：

| 档位 | 注册变体 |
|------|----------|
| Entry | `FixerExecutor::Entry(my_fixer::execute)` |
| Content | `FixerExecutor::Content(my_fixer::execute)` |
| File | `FixerExecutor::File(my_fixer::execute)` |
| Full | `FixerExecutor::Full(my_fixer::execute)` |

### 第 3 步：验证

```bash
# Rust 编译检查
cd src-tauri && cargo check

# TypeScript 编译检查（前端无需改动，但确认不受影响）
npx tsc -b --noEmit
```

运行应用 → 实用工具 → 一键修复 → 确认新修复项出现在列表中，且档位徽章颜色正确。

## FixDefinition 各字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `String` | 唯一标识符，snake_case 格式，用于 `execute_fixer` 命令定位 |
| `name` | `String` | 问题名称，显示在列表和详情标题中 |
| `description` | `String` | 问题详细描述，支持多行，可包含错误信息示例 |
| `fix_method` | `String` | 修复方式说明，让用户了解修复将做什么 |
| `tags` | `Vec<String>` | 搜索标签，扩展搜索范围（名称和描述之外） |
| `level` | `FixLevel` | 修复档位级别，决定权限范围和 UI 标注样式 |

## FixResult 各字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | `bool` | 修复是否成功 |
| `message` | `String` | 结果消息（成功时的提示或失败时的原因） |
| `affected_lines` | `usize` | 受影响的消息行数 |

## 安全注意事项

1. **Entry/Content 档位不允许操作文件系统**
   - 这两个档位的 `execute` 函数签名中不包含文件路径或 AppCache
   - 所有文件读写由框架统一处理（含双重备份）
   - 修复逻辑只操作内存中的数据

2. **File 档位必须使用 `file_guard` 写入文件**
   - 使用 `file_guard::safe_write_file()` 或 `parser::write_messages()` 写回
   - 自动进行路径验证（确保在 `~/.claude/` 下）
   - 自动创建临时备份（强制）和主动备份（可选）
   - **禁止直接使用 `tokio::fs::write()`**

3. **operation 参数命名规范**
   - 框架自动使用 `"fixer_<id>"` 格式构造 operation
   - File/Full 档位如需自行写文件，也应遵循此命名

4. **SessionMessage 是 `serde_json::Value`**
   - 使用 `.get()` / `.get_mut()` / `.as_array()` 等方法操作
   - 修改后的 Value 会被 `serde_json::to_string()` 序列化写回
   - 确保不破坏原始 JSON 结构

5. **无修改时不要写文件**
   - Entry/Content 档位：返回 `affected_lines: 0` 时框架不会覆写
   - File/Full 档位：修复逻辑应自行跳过无修改的场景

## 现有修复项参考

### strip_thinking（去除 thinking 块）— Entry 档位

- **问题**：会话文件中的 thinking/redacted_thinking 块签名过期，导致 resume 时 400 错误
- **修复**：遍历每条消息的 `message.content` 数组，过滤掉 `type` 为 `"thinking"` 或 `"redacted_thinking"` 的内容块
- **档位**：Entry（条目修复）— 只操作解析后的消息列表
- **文件**：`src-tauri/src/services/fixers/strip_thinking.rs`
