# Content 档位 API 参考（内容修复）

> 本文件供 AI 编码助手（如 Claude Code）快速查阅 Content 档位的接口规范。
> 人类开发者请参阅完整指南：[fixers-guide.md](./fixers-guide.md)

## 概要

| 项目 | 值 |
|------|-----|
| 档位名称 | Content（内容修复） |
| 权限范围 | 操作文件原始文本内容，**不可直接访问文件系统** |
| 前端标注 | 蓝色徽章 |
| 适用场景 | 修复格式错乱、编码问题、文本替换、正则清洗 |

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
        level: FixLevel::Content,               // 必须为 Content
    }
}
```

### `execute()` — 修复入口

```rust
pub fn execute<'a>(
    content: &'a str,
) -> Pin<Box<dyn Future<Output = Result<(FixResult, String), String>> + Send + 'a>> {
    Box::pin(execute_inner(content))
}
```

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `content` | `&str` | 框架读取的文件原始文本（完整的 JSONL 文件内容） |

**返回值：**

```rust
(
    FixResult {
        success: bool,
        message: String,
        affected_lines: usize,  // 0 = 未发现问题，框架不会覆写
    },
    String,  // 修改后的完整文件内容（即使 affected_lines 为 0 也需要返回）
)
```

## 必要的 use 导入

```rust
use std::future::Future;
use std::pin::Pin;

use crate::services::fixers::{FixDefinition, FixLevel, FixResult};
```

## 文本内容格式

文件内容是 JSONL 格式（每行一个独立的 JSON 对象），例如：

```
{"type":"human","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi!"}]}}
```

常用操作模式：

```rust
async fn execute_inner(content: &str) -> Result<(FixResult, String), String> {
    let mut new_lines: Vec<String> = Vec::new();
    let mut affected_count = 0;

    for line in content.lines() {
        // 逐行处理
        let processed = line.replace("旧内容", "新内容");
        if processed != line {
            affected_count += 1;
        }
        new_lines.push(processed);
    }

    let new_content = new_lines.join("\n");

    Ok((
        FixResult {
            success: true,
            message: if affected_count > 0 {
                format!("成功修复 {} 行", affected_count)
            } else {
                "未发现需要修复的内容".to_string()
            },
            affected_lines: affected_count,
        },
        new_content,
    ))
}
```

## 关键约束

1. **禁止**在 Content 档位修复中导入或使用 `tokio::fs`、`std::fs`、`file_guard` 等文件系统 API
2. **禁止**在 Content 档位修复中导入或使用 `AppCache`
3. 返回值的第二个元素（`String`）必须是**完整的文件内容**，不是 diff 或部分内容
4. 返回 `affected_lines: 0` 时框架**不会**覆写文件
5. 注意保持 JSONL 格式——每行一个独立 JSON，行尾无多余空白

## 注册方式

在 `src-tauri/src/services/fixers/mod.rs` 中：

```rust
pub mod your_fixer;

// 在 all_fixers() 中添加：
FixerEntry {
    definition: your_fixer::definition,
    executor: FixerExecutor::Content(your_fixer::execute),
},
```
