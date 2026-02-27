# 贡献修复方案指南（Contributing Fixers Guide）

> **本文档面向 AI 编码助手（如 Claude Code、Cursor 等）和人类开发者。**
> 如果你正在使用 AI 工具为本项目贡献修复方案代码，请仔细阅读本文档的每一节。

## 项目背景

**ClaudeCodeReader (CCR)** 是一个使用 [Tauri 2.9](https://v2.tauri.app/) 构建的桌面应用，用于查看和管理 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 的聊天记录与会话设置。

Claude Code 将会话数据存储在 `~/.claude/projects/` 目录下，每个会话是一个 `.jsonl` 文件（每行一个独立的 JSON 对象）。在日常使用中，这些文件可能会出现各种问题（如签名过期、格式错乱、编码异常等），导致 Claude Code 无法正常 resume 会话或出现 400 错误。

**一键修复（Quick Fix）** 功能正是为了解决这类问题而设计的可扩展修复框架。我们将每种已知问题及其修复方案封装为一个独立的 Rust 模块，用户通过图形界面即可一键执行修复。

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript 5.9 + Tailwind CSS |
| 后端 | Rust 2024 edition (1.85+) + Tauri 2.9 |
| 消息格式 | JSONL（每行一个 `serde_json::Value`） |
| 文件安全 | `file_guard` 模块（路径验证 + 双重备份机制） |

### 源码结构（修复相关）

```
src-tauri/src/services/fixers/
├── mod.rs                  # 注册表 + 数据结构 + 执行引擎
├── strip_thinking.rs       # 现有修复：去除 thinking 块（Entry 档位）
└── <your_new_fixer>.rs     # 你的新修复项
```

## 四级权限档位

框架为修复方案设计了四个权限级别，从最安全到最宽松依次为：

### 1. Entry（条目修复）🟢

- **权限**：仅操作解析后的消息条目列表（`Vec<serde_json::Value>`），不可访问文件系统
- **参数**：`&mut Vec<SessionMessage>`
- **写回**：框架自动读取和覆写（含双重备份）
- **适用场景**：过滤内容块、修改字段值、删除/替换消息条目
- **API 文档**：[`fixer-api-entry.md`](./fixer-api-entry.md)

### 2. Content（内容修复）🔵

- **权限**：操作文件的原始文本内容，不可直接访问文件系统
- **参数**：`&str`（文件内容）
- **写回**：返回修改后的完整内容，框架自动覆写
- **适用场景**：修复格式错乱、编码问题、文本替换、正则清洗
- **API 文档**：[`fixer-api-content.md`](./fixer-api-content.md)

### 3. File（文件修复）🟠

- **权限**：拥有对该会话文件的直接操作权限，路径受限于 `~/.claude/`
- **参数**：`&str`（文件路径） + `&AppCache`
- **写回**：修复自行操作文件（必须通过 `file_guard`）
- **适用场景**：文件拆分、重命名、二进制处理等
- **API 文档**：[`fixer-api-file.md`](./fixer-api-file.md)

### 4. Full（特殊修复）🔴

- **权限**：完全权限，不受路径和文件系统限制
- **参数**：`&str`（文件路径） + `&AppCache`
- **写回**：修复自行操作
- **适用场景**：跨目录操作、访问非会话文件等特殊场景
- **API 文档**：[`fixer-api-full.md`](./fixer-api-full.md)

**选择原则：始终选择满足需求的最低档位。** 绝大多数修复应使用 Entry 档位。

## 代码规范（强制要求）

### 文件头部信息（必须）

每个修复模块的文件**开头**必须包含以下格式的元信息文档注释：

```rust
//! # 修复项：<问题名称>
//!
//! ## 修复信息
//!
//! - **修复者（Author）**：<你的名字 / GitHub 用户名>
//! - **修复模型（Model）**：<使用的 AI 模型，如 Claude Opus 4 / 人工编写>
//! - **修复时间（Date）**：<YYYY-MM-DD>
//! - **修复设备（Device）**：<设备信息，如 MacBook Pro M2 / Windows 11 PC>
//! - **档位（Level）**：<Entry / Content / File / Full>
//!
//! ## 问题描述
//! <详细描述问题出现的场景、错误信息、影响范围>
//!
//! ## 修复方式
//! <详细描述修复逻辑、处理策略、边界情况考量>
```

### 注释要求（强制）

本项目遵循**开源团队原则：每一个文件、函数甚至每一行代码都要有详细的注释**。

- 每个 `pub fn` 必须有 `///` 文档注释，说明功能、参数和返回值
- 关键逻辑块必须有行内注释说明**为什么**这样做（不仅仅是**做什么**）
- 使用简体中文编写注释

### 编程规范（强制）

- **Rust edition**：必须使用 `edition = "2024"`，可以使用 2024 edition 的新特性
- **安全性**：禁止 `unwrap()` / `expect()` 用于可能失败的操作，必须使用 `?` 或 `map_err()`
- **高效性**：避免不必要的 `.clone()` 和内存分配
- **错误信息**：使用清晰的中文错误描述（用户可见）
- **类型安全**：`SessionMessage` 是 `serde_json::Value`，使用 `.get()` / `.as_str()` 等安全方法

## 开发流程

### 第 1 步：确认你的修复方案

在编写代码前，你需要明确：

1. **你要修复的问题是什么？** — 问题的具体表现、错误信息、复现条件
2. **你的修复方式是什么？** — 修复逻辑、处理策略
3. **应该使用哪个档位？** — 根据修复逻辑需要的权限选择最低档位

### 第 2 步：阅读对应档位的 API 文档

根据选择的档位，阅读对应的 API 参考文件：

- Entry → [`docs/development/fixer-api-entry.md`](./fixer-api-entry.md)
- Content → [`docs/development/fixer-api-content.md`](./fixer-api-content.md)
- File → [`docs/development/fixer-api-file.md`](./fixer-api-file.md)
- Full → [`docs/development/fixer-api-full.md`](./fixer-api-full.md)

### 第 3 步：创建修复模块

在 `src-tauri/src/services/fixers/` 下创建新的 `.rs` 文件，按照 API 文档中的签名和模板编写代码。

### 第 4 步：注册到框架

编辑 `src-tauri/src/services/fixers/mod.rs`：

1. 添加 `pub mod your_fixer;` 模块声明
2. 在 `all_fixers()` 函数中添加对应的 `FixerEntry`

### 第 5 步：测试与验证（必须）

```bash
# 1. Rust 编译检查（必须通过，不允许 warning）
cd src-tauri && cargo check 2>&1 | grep -E "(error|warning)"

# 2. TypeScript 编译检查
npx tsc -b --noEmit

# 3. 运行应用并手动验证
npm run tauri dev
# → 实用工具 → 一键修复 → 确认新修复项出现 → 执行修复 → 验证结果
```

### 第 6 步：提交代码

提交信息必须包含详细描述：

```bash
git add src-tauri/src/services/fixers/your_fixer.rs
git add src-tauri/src/services/fixers/mod.rs

git commit -m "$(cat <<'EOF'
feat(fixers): 添加 <修复名称> 修复项

问题：<简要描述问题>
修复：<简要描述修复逻辑>
档位：<Entry / Content / File / Full>

- 新增 fixers/your_fixer.rs 修复模块
- 在 mod.rs 注册表中注册修复项
- 通过 cargo check 和 tsc 编译验证
EOF
)"
```

### 第 7 步：提交 Pull Request

```bash
# 推送到你的 fork
git push origin feat/fixer-your-fixer-name

# 创建 PR（使用 gh CLI）
gh pr create \
  --title "feat(fixers): 添加 <修复名称> 修复项" \
  --body "$(cat <<'EOF'
## 修复说明

- **问题描述**：<问题的详细描述>
- **修复方式**：<修复逻辑的详细说明>
- **档位级别**：<Entry / Content / File / Full>

## 测试验证

- [ ] `cargo check` 通过，无 warning
- [ ] `npx tsc -b --noEmit` 通过
- [ ] 在应用中手动执行修复，结果正确
- [ ] 无修改时返回 affected_lines: 0

## 修复者信息

- **修复者**：<你的名字>
- **使用模型**：<AI 模型名称 / 人工编写>
- **修复时间**：<日期>
EOF
)"
```

## 现有修复项参考

### strip_thinking — 去除 thinking 块（Entry 档位）

- **文件**：`src-tauri/src/services/fixers/strip_thinking.rs`
- **问题**：会话文件中的 `thinking` / `redacted_thinking` 块签名过期，导致 resume 时出现 400 错误
- **修复**：遍历消息的 `content` 数组，过滤掉 `type` 为 `"thinking"` 或 `"redacted_thinking"` 的内容块

建议在编写新修复方案前，先阅读此文件作为参考范例。

## 联系与协作

如果你在贡献过程中遇到问题，或对修复框架有改进建议，欢迎在 [GitHub Issues](https://github.com/MoYeRanQianZhi/ClaudeCodeReader/issues) 中讨论。
