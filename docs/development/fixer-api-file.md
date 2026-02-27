# File 档位 API 参考（文件修复）

> 本文件供 AI 编码助手（如 Claude Code）快速查阅 File 档位的接口规范。
> 人类开发者请参阅完整指南：[fixers-guide.md](./fixers-guide.md)

## 概要

| 项目 | 值 |
|------|-----|
| 档位名称 | File（文件修复） |
| 权限范围 | 拥有对**该会话文件**的直接操作权限，路径受限于 `~/.claude/` |
| 前端标注 | 橙色徽章 |
| 适用场景 | 需要直接操作文件的修复（如文件拆分、重命名、二进制处理） |

## 函数签名

### `definition()` — 元数据定义

```rust
pub fn definition() -> FixDefinition {
    FixDefinition {
        id: "your_fixer_id".to_string(),
        name: "问题名称".to_string(),
        description: "详细描述...".to_string(),
        fix_method: "修复说明...".to_string(),
        tags: vec!["tag1".to_string()],
        level: FixLevel::File,                   // 必须为 File
    }
}
```

### `execute()` — 修复入口

```rust
pub fn execute<'a>(
    session_file_path: &'a str,
    cache: &'a AppCache,
) -> Pin<Box<dyn Future<Output = Result<FixResult, String>> + Send + 'a>> {
    Box::pin(execute_inner(session_file_path, cache))
}
```

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `session_file_path` | `&str` | 会话 JSONL 文件的绝对路径（框架已预先验证在 `~/.claude/` 下） |
| `cache` | `&AppCache` | 应用缓存引用，传递给 `file_guard` 的安全写入函数 |

**返回值：**

```rust
FixResult {
    success: bool,
    message: String,
    affected_lines: usize,
}
```

## 必要的 use 导入

```rust
use std::future::Future;
use std::pin::Pin;

use crate::services::cache::AppCache;
use crate::services::fixers::{FixDefinition, FixLevel, FixResult};
use crate::services::file_guard;
// 如需读写消息，还可使用：
// use crate::services::parser;
```

## 文件操作规范

### 写入文件 — 必须使用 `file_guard`

```rust
// 写入原始字节
file_guard::safe_write_file(
    session_file_path,
    new_content.as_bytes(),
    "fixer_your_fixer_id",  // operation 标识
    cache,
).await?;

// 或者写入解析后的消息列表
parser::write_messages(
    session_file_path,
    &messages,
    "fixer_your_fixer_id",
    cache,
).await?;
```

### 读取文件

```rust
// 读取原始文本
let content = tokio::fs::read_to_string(session_file_path).await
    .map_err(|e| format!("读取文件失败: {}", e))?;

// 或者读取解析后的消息列表
let messages = parser::read_messages(session_file_path).await?;
```

## 关键约束

1. **必须**通过 `file_guard::safe_write_file()` 或 `parser::write_messages()` 写入文件
2. **禁止**直接使用 `tokio::fs::write()` 或 `std::fs::write()`
3. **禁止**操作 `session_file_path` 之外的文件——File 档位仅限操作该会话文件
4. 框架已预先调用 `file_guard::validate_claude_path()` 验证路径合法性
5. `operation` 参数使用 `"fixer_<id>"` 格式命名

## 注册方式

在 `src-tauri/src/services/fixers/mod.rs` 中：

```rust
pub mod your_fixer;

// 在 all_fixers() 中添加：
FixerEntry {
    definition: your_fixer::definition,
    executor: FixerExecutor::File(your_fixer::execute),
},
```
