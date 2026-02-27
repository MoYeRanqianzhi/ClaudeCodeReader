# Entry 档位 API 参考（条目修复）

> 本文件供 AI 编码助手（如 Claude Code）快速查阅 Entry 档位的接口规范。
> 人类开发者请参阅完整指南：[fixers-guide.md](./fixers-guide.md)

## 概要

| 项目 | 值 |
|------|-----|
| 档位名称 | Entry（条目修复） |
| 权限范围 | 仅操作解析后的消息条目，**不可访问文件系统** |
| 前端标注 | 绿色徽章 |
| 适用场景 | 过滤内容块、修改字段值、删除/替换消息条目 |

## 函数签名

### `definition()` — 元数据定义

```rust
pub fn definition() -> FixDefinition {
    FixDefinition {
        id: "your_fixer_id".to_string(),       // snake_case，全局唯一
        name: "问题名称".to_string(),            // 简短明确，显示在列表标题
        description: "详细描述...".to_string(),   // 可多行，包含错误信息示例
        fix_method: "修复说明...".to_string(),    // 让用户了解修复将做什么
        tags: vec!["tag1".to_string()],          // 搜索标签
        level: FixLevel::Entry,                  // 必须为 Entry
    }
}
```

### `execute()` — 修复入口

```rust
pub fn execute<'a>(
    messages: &'a mut Vec<SessionMessage>,
) -> Pin<Box<dyn Future<Output = Result<FixResult, String>> + Send + 'a>> {
    Box::pin(execute_inner(messages))
}
```

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `messages` | `&mut Vec<SessionMessage>` | 框架已解析好的消息列表（`SessionMessage` = `serde_json::Value`） |

**返回值：**

```rust
FixResult {
    success: bool,           // 修复是否成功
    message: String,         // 结果描述
    affected_lines: usize,   // 受影响的消息行数（0 = 未发现问题，框架不会覆写文件）
}
```

## 必要的 use 导入

```rust
use std::future::Future;
use std::pin::Pin;

use crate::models::message::SessionMessage;
use crate::services::fixers::{FixDefinition, FixLevel, FixResult};
```

## SessionMessage 操作指南

`SessionMessage` 是 `serde_json::Value`，典型结构如下：

```json
{
  "type": "human" | "assistant",
  "message": {
    "role": "user" | "assistant",
    "content": [
      { "type": "text", "text": "..." },
      { "type": "tool_use", "id": "...", "name": "...", "input": {...} },
      { "type": "thinking", "thinking": "..." }
    ]
  }
}
```

常用操作：

```rust
// 获取消息内容数组
if let Some(content) = msg.get_mut("message")
    .and_then(|m| m.get_mut("content"))
    .and_then(|c| c.as_array_mut())
{
    // 过滤特定类型的内容块
    content.retain(|block| {
        block.get("type")
            .and_then(|t| t.as_str())
            .map(|t| t != "thinking")
            .unwrap_or(true)
    });
}
```

## 关键约束

1. **禁止**在 Entry 档位修复中导入或使用 `tokio::fs`、`std::fs`、`file_guard` 等文件系统 API
2. **禁止**在 Entry 档位修复中导入或使用 `AppCache`
3. 返回 `affected_lines: 0` 时框架**不会**覆写文件，安全返回即可
4. 确保不破坏原始 JSON 结构——只增删改内部字段/元素，不要替换整个顶层 Value

## 注册方式

在 `src-tauri/src/services/fixers/mod.rs` 中：

```rust
pub mod your_fixer;  // 添加模块声明

// 在 all_fixers() 中添加：
FixerEntry {
    definition: your_fixer::definition,
    executor: FixerExecutor::Entry(your_fixer::execute),
},
```
