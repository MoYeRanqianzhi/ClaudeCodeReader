# Full 档位 API 参考（特殊修复）

> 本文件供 AI 编码助手（如 Claude Code）快速查阅 Full 档位的接口规范。
> 人类开发者请参阅完整指南：[fixers-guide.md](./fixers-guide.md)

## 概要

| 项目 | 值 |
|------|-----|
| 档位名称 | Full（特殊修复） |
| 权限范围 | **完全权限**，不受路径限制，不受文件系统限制 |
| 前端标注 | 红色徽章 |
| 适用场景 | 跨目录操作、访问非会话文件、操作系统级修复等特殊场景 |

## ⚠️ 重要警告

Full 档位是最高权限级别，**框架不做任何安全限制**。使用此档位前，请确认：

1. 你的修复逻辑**确实需要**跨目录操作或访问非会话文件
2. Entry、Content、File 三个低档位**均无法满足**需求
3. 你已充分考虑安全风险并实现了必要的自我约束

**原则：选择满足需求的最低档位。绝大多数修复不需要 Full 档位。**

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
        level: FixLevel::Full,                   // 必须为 Full
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

与 File 档位完全相同：

| 参数 | 类型 | 说明 |
|------|------|------|
| `session_file_path` | `&str` | 会话 JSONL 文件的绝对路径 |
| `cache` | `&AppCache` | 应用缓存引用 |

**与 File 档位的区别：**

- File 档位：框架预先调用 `validate_claude_path()` 验证路径
- Full 档位：框架 **不做任何路径验证**，修复可以操作任意文件

## 必要的 use 导入

```rust
use std::future::Future;
use std::pin::Pin;

use crate::services::cache::AppCache;
use crate::services::fixers::{FixDefinition, FixLevel, FixResult};
// 按需导入：
// use crate::services::file_guard;
// use crate::services::parser;
```

## 安全建议

即使 Full 档位不受框架限制，修复实现者仍应遵循以下最佳实践：

1. 仍然优先使用 `file_guard::safe_write_file()` 进行写入（获得备份保护）
2. 在代码注释中明确说明为什么需要 Full 档位（审查时可追溯）
3. 操作范围尽可能小——不要因为有 Full 权限就扩大不必要的操作范围
4. 对于删除操作，考虑先备份到临时目录

## 注册方式

在 `src-tauri/src/services/fixers/mod.rs` 中：

```rust
pub mod your_fixer;

// 在 all_fixers() 中添加：
FixerEntry {
    definition: your_fixer::definition,
    executor: FixerExecutor::Full(your_fixer::execute),
},
```
