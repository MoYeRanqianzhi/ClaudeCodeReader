# Rust 后端开发指南

本文档详细说明 ClaudeCodeReader (CCR) 项目 Rust 后端的架构设计、文件结构、依赖配置、安全权限以及扩展方式。

---

## 架构说明

CCR 的后端采用 **MVC 分层架构**，承担所有核心计算任务：

- **Commands 层**（`commands/`）：Tauri IPC 接口，接收前端 `invoke()` 调用，委托给 Services 层处理
- **Services 层**（`services/`）：核心业务逻辑，包括文件扫描、JSONL 解析、消息分类/转换、缓存管理、导出
- **Models 层**（`models/`）：数据结构定义，与前端 TypeScript 类型一一对应
- **Utils 层**（`utils/`）：通用工具函数（路径编解码等）

### 设计原则

1. **计算密集型操作在 Rust 端完成**：消息解析、分类、转换、Token 统计、文本搜索全部在 Rust 端执行
2. **前端只负责渲染**：前端通过 `invoke()` 获取处理后的 `TransformedSession` 数据，直接渲染
3. **多级缓存**：项目列表 TTL 缓存（30 秒）+ 会话消息 LRU 缓存（20 个）+ 搜索结果缓存
4. **SIMD 加速搜索**：使用 memchr 库进行子串搜索，利用 CPU SIMD 指令集加速
5. **并行处理**：使用 rayon 对大会话进行并行分类（map-reduce 模式）

---

## 文件结构

```
src-tauri/src/
├── main.rs                # Windows 子系统配置 + 入口点
├── lib.rs                 # 应用初始化：插件注册 + Commands 注册 + 缓存初始化
├── commands/              # Command 层（IPC 接口）
│   ├── mod.rs             # 模块索引
│   ├── projects.rs        # 项目扫描 commands (1 个)
│   ├── messages.rs        # 消息读写/搜索/导出 commands (7 个)
│   └── settings.rs        # 设置和配置 commands (7 个)
├── models/                # 数据模型层
│   ├── mod.rs             # 模块索引
│   ├── project.rs         # Project、Session、FileHistorySnapshot
│   ├── message.rs         # SessionMessage、MessageContent、ToolUseResult
│   ├── display.rs         # DisplayMessage、ToolUseInfo、TokenStats、TransformedSession
│   └── settings.rs        # ClaudeSettings、EnvProfile、EnvSwitcherConfig
├── services/              # 业务逻辑层
│   ├── mod.rs             # 模块索引
│   ├── scanner.rs         # 项目/会话文件系统扫描（并行 I/O）
│   ├── parser.rs          # JSONL 解析与写入
│   ├── classifier.rs      # 消息分类（user/assistant/system/compact_summary）
│   ├── transformer.rs     # 消息转换管线（DisplayMessage 生成）
│   ├── cache.rs           # LRU 缓存 + TTL 缓存 + 搜索缓存
│   └── export.rs          # Markdown/JSON 导出
└── utils/
    └── path.rs            # 路径编解码工具
```

---

## 入口文件

### `src/main.rs` — Windows 子系统配置 + 入口点

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  app_lib::run();
}
```

- Release 模式下隐藏控制台窗口，Debug 模式保留便于查看日志
- 仅调用 `app_lib::run()`，实际初始化逻辑在 `lib.rs`

### `src/lib.rs` — 应用初始化

负责完整的 Tauri 应用初始化：

1. 注册 5 个 Tauri 官方插件（fs、dialog、shell、opener、log）
2. 初始化 `AppCache` 全局状态（`manage(AppCache::new())`）
3. 注册 15 个自定义 Tauri Commands（`invoke_handler`）
4. Debug 模式下启用日志插件

---

## Commands 层

### `commands/projects.rs` — 项目扫描

| Command | 签名 | 说明 |
|---------|------|------|
| `scan_projects` | `(cache: State<AppCache>) → Vec<Project>` | 扫描 ~/.claude/projects/ 目录，返回所有项目及其会话列表。使用 TTL 缓存（30 秒内重复调用直接返回缓存） |

### `commands/messages.rs` — 消息操作

| Command | 签名 | 说明 |
|---------|------|------|
| `read_session_messages` | `(session_path, project_path, cache) → TransformedSession` | 读取会话 JSONL，经过分类+转换管线，返回 DisplayMessage 列表 + toolUseMap + tokenStats |
| `delete_message` | `(session_path, message_uuid, project_path, cache) → TransformedSession` | 删除单条消息，重新转换并返回 |
| `delete_messages` | `(session_path, message_uuids, project_path, cache) → TransformedSession` | 批量删除消息 |
| `edit_message_content` | `(session_path, message_uuid, block_edits, project_path, cache) → TransformedSession` | 按内容块编辑消息（支持 text 块精确编辑） |
| `delete_session` | `(session_path, cache)` | 删除会话文件，清除缓存 |
| `search_session` | `(session_path, query, case_sensitive, use_regex, cache) → Vec<String>` | 4 模式全文搜索，返回匹配的 displayId 列表 |
| `export_session` | `(session_path, format, cache) → String` | 导出为 Markdown 或 JSON 格式 |

### `commands/settings.rs` — 设置管理

| Command | 签名 | 说明 |
|---------|------|------|
| `get_claude_data_path` | `() → String` | 获取 ~/.claude 路径 |
| `read_settings` | `(claude_path) → ClaudeSettings` | 读取 settings.json |
| `save_settings` | `(claude_path, settings)` | 保存 settings.json |
| `read_env_config` | `() → EnvSwitcherConfig` | 读取环境配置 |
| `save_env_config` | `(config)` | 保存环境配置 |
| `read_history` | `(claude_path) → Vec<Value>` | 读取命令历史 |
| `check_file_exists` | `(file_path) → bool` | 检查文件是否存在 |

---

## Services 层

### `services/scanner.rs` — 文件系统扫描

- 扫描 `~/.claude/projects/` 下所有项目目录
- 每个项目目录下扫描 `.jsonl` 会话文件（排除 `agent-` 前缀）
- 使用 `tokio::fs` 异步 I/O
- 项目按最新会话时间降序排序
- 会话按文件修改时间降序排序

### `services/parser.rs` — JSONL 解析

- 逐行解析 JSONL 文件为 `SessionMessage` 数组
- 容错处理：无效 JSON 行静默跳过
- 写入时将消息数组序列化为 JSONL 格式

### `services/classifier.rs` — 消息分类器

将原始 `SessionMessage` 分类为以下类型：

| 分类 | 说明 |
|------|------|
| `user` | 用户消息 |
| `assistant` | 助手消息 |
| `system` | 系统消息（进一步识别子类型：skill、plan、plan_execution 等） |
| `compact_summary` | 自动压缩摘要消息 |

系统消息子类型识别：
- **skill**：包含 `<skill-name>` 标签
- **plan**：包含计划模式相关标记
- **plan_execution**：计划执行消息，包含会话跳转信息
- **compact_summary**：`isSummary: true` 的压缩摘要

### `services/transformer.rs` — 消息转换管线

核心转换流程：

```
SessionMessage[] → classify → split → build DisplayMessage[]
                                    → build toolUseMap
                                    → calculate tokenStats
                                    → return TransformedSession
```

- 将原始消息拆分为独立的 DisplayMessage（一条 assistant 消息可能拆分为多个 tool_use + text 块）
- 构建 `toolUseMap`：tool_use_id → ToolUseInfo（工具名称、参数、关联文件路径）
- 计算 `tokenStats`：汇总整个会话的 input/output/cache Token 使用量

### `services/cache.rs` — 缓存管理

```
AppCache
├── project_cache: Mutex<Option<(Vec<Project>, Instant)>>  # TTL 缓存（30 秒）
├── session_cache: Mutex<LruCache<String, Vec<SessionMessage>>>  # LRU 缓存（20 个）
└── search_cache: Mutex<HashMap<String, Vec<String>>>  # 搜索结果缓存
```

- **项目列表缓存**：30 秒 TTL，避免频繁扫描文件系统
- **会话消息缓存**：LRU 策略，最多缓存 20 个会话的原始消息
- **搜索结果缓存**：按 `session_path + query + options` 组合键缓存

### `services/export.rs` — 会话导出

- **Markdown 格式**：按消息角色分段，代码块保留语法高亮标记
- **JSON 格式**：原始 SessionMessage 数组的 JSON 序列化

---

## Models 层

### `models/project.rs`

| 结构体 | 说明 |
|--------|------|
| `Project` | 项目信息：name（编码名）、path（解码路径）、sessions |
| `Session` | 会话信息：id、timestamp、filePath、messageCount |
| `FileHistorySnapshot` | 文件历史快照 |

### `models/message.rs`

| 结构体 | 说明 |
|--------|------|
| `SessionMessage` | 原始会话消息：uuid、type、message、timestamp 等 |
| `MessageContent` | 消息内容块：type（text/tool_use/tool_result/thinking/image）+ 对应字段 |
| `ToolUseResult` | 工具调用结果 |

### `models/display.rs`

| 结构体 | 说明 |
|--------|------|
| `DisplayMessage` | 前端渲染用消息：displayId、displayType、content、sourceUuid 等 |
| `ToolUseInfo` | 工具调用信息：toolName、filePath（用于"打开文件位置"按钮） |
| `TokenStats` | Token 统计：inputTokens、outputTokens、cacheReadTokens、cacheCreationTokens |
| `TransformedSession` | 转换后的完整会话：messages + toolUseMap + tokenStats + projectPath |

### `models/settings.rs`

| 结构体 | 说明 |
|--------|------|
| `ClaudeSettings` | Claude Code 设置：env、model、permissions、apiKey 等 |
| `EnvProfile` | 环境配置：id、name、env、createdAt、updatedAt |
| `EnvSwitcherConfig` | 环境切换器配置：profiles、activeProfileId |

---

## Rust 依赖列表

### 构建依赖 (`[build-dependencies]`)

| 依赖 | 版本 | 用途 |
|------|------|------|
| `tauri-build` | 2.5.3 | Tauri 构建脚本 |

### 运行依赖 (`[dependencies]`)

| 依赖 | 版本 | 用途 |
|------|------|------|
| `tauri` | 2.9.5 | Tauri 核心框架 |
| `serde` | 1.0 (derive) | 序列化/反序列化 |
| `serde_json` | 1.0 | JSON 处理 |
| `log` | 0.4 | 日志门面 |
| `tauri-plugin-fs` | 2 | 文件系统插件 |
| `tauri-plugin-dialog` | 2 | 系统对话框插件 |
| `tauri-plugin-shell` | 2 | Shell 执行插件 |
| `tauri-plugin-opener` | 2 | 文件管理器集成插件 |
| `tauri-plugin-log` | 2 | 日志插件（仅 Debug） |
| `tokio` | 1 (fs, rt) | 异步文件 I/O |
| `dirs` | 6 | 跨平台主目录获取 |
| `regex` | 1 | 正则表达式（计划消息检测） |
| `rayon` | 1.10 | 数据并行（大会话分类） |
| `memchr` | 2 | SIMD 加速子串搜索 |

### 包元数据

| 字段 | 值 | 说明 |
|------|------|------|
| `name` | `claude-code-reader` | Cargo 包名称 |
| `version` | `2.1.0-beta.1` | 当前版本号 |
| `edition` | `2024` | Rust 版本 (Edition) |
| `rust-version` | `1.85` | 最低 Rust 工具链版本 |
| `license` | `MIT` | 开源许可证 |

---

## Tauri 插件配置

### 已注册插件（5 个）

| 插件 | 注册方式 | 用途 |
|------|---------|------|
| `tauri-plugin-fs` | `.plugin(tauri_plugin_fs::init())` | 文件系统访问（主要供导出功能使用，数据加载已迁移到 Rust 后端） |
| `tauri-plugin-dialog` | `.plugin(tauri_plugin_dialog::init())` | 系统对话框（文件保存对话框） |
| `tauri-plugin-shell` | `.plugin(tauri_plugin_shell::init())` | Shell 操作（打开外部链接） |
| `tauri-plugin-opener` | `.plugin(tauri_plugin_opener::init())` | 文件管理器集成（在文件管理器中定位文件） |
| `tauri-plugin-log` | `.setup()` 中条件注册 | 调试日志（仅 Debug 模式，Info 级别） |

---

## Tauri 配置 (`tauri.conf.json`)

### 窗口配置

| 属性 | 值 | 说明 |
|------|------|------|
| `title` | "Claude Code Reader" | 窗口标题 |
| `width` / `height` | 1200 x 800 | 默认窗口尺寸 |
| `minWidth` / `minHeight` | 800 x 600 | 最小窗口尺寸 |
| `resizable` | `true` | 允许调整大小 |
| `center` | `true` | 启动时居中 |

### 安全配置

- CSP 设为 `null`（禁用），因为 CCR 是纯本地应用，不加载远程资源

---

## 安全权限 (`capabilities/default.json`)

| 权限标识 | 说明 |
|---------|------|
| `core:default` | Tauri 核心默认权限 |
| `fs:default` | 文件系统默认权限 |
| `fs:allow-read-dir` | 读取目录列表 |
| `fs:allow-read-file` | 读取文件内容 |
| `fs:allow-write-file` | 写入文件内容 |
| `fs:allow-exists` | 检查文件存在 |
| `fs:allow-stat` | 获取文件元数据 |
| `fs:allow-home-read-recursive` | 递归读取用户主目录 |
| `fs:allow-home-write-recursive` | 递归写入用户主目录 |
| `dialog:default` | 对话框默认权限 |
| `shell:default` | Shell 默认权限 |

---

## 如何添加新的 Tauri Command

### 第 1 步：在对应的 commands 子模块中定义函数

```rust
// commands/messages.rs 中添加新 command
#[tauri::command]
pub async fn my_new_command(
    session_path: String,
    cache: tauri::State<'_, AppCache>,
) -> Result<MyResult, String> {
    // 调用 services 层的业务逻辑
    let result = services::my_service::do_something(&session_path)
        .map_err(|e| e.to_string())?;
    Ok(result)
}
```

### 第 2 步：在 `lib.rs` 的 `invoke_handler` 中注册

```rust
.invoke_handler(tauri::generate_handler![
    // ... 现有 commands
    commands::messages::my_new_command,  // 新增
])
```

### 第 3 步：在前端调用

```typescript
import { invoke } from '@tauri-apps/api/core';

const result = await invoke<MyResult>('my_new_command', {
  sessionPath: '/path/to/session.jsonl',
});
```

### 注意事项

- Command 函数名使用 `snake_case`，前端调用时同样使用 `snake_case`
- 异步 Command 使用 `async fn`，Tauri 在线程池中执行
- 返回 `Result<T, String>`，错误信息传递到前端 `catch`
- 需要缓存时通过 `tauri::State<'_, AppCache>` 参数注入
- 业务逻辑应放在 `services/` 层，command 函数只做参数转换和错误映射
