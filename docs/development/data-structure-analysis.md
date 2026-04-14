# Claude Code 会话数据结构分析报告

> **版本**: 2026-04-12  
> **分析目标**: Claude Code 最新源码中的 JSONL 会话数据结构  
> **对比目标**: CCR (ClaudeCodeReader) 现有 Rust 后端实现  
> **源码参考**: `claude-code-source-code/src/utils/sessionStorage.ts`、`src/types/logs.ts`、`src/utils/messages.ts`

---

## 1. 存储路径和文件命名规则

### 1.1 目录结构

```text
~/.claude/
├── projects/                          # 项目会话目录
│   └── <sanitized-path>/              # 项目路径编码后的目录名
│       ├── <session-uuid>.jsonl       # 主会话转录文件
│       └── <session-uuid>/            # 子 agent 目录
│           └── subagents/
│               ├── agent-<agent-id>.jsonl       # 子 agent 转录
│               ├── agent-<agent-id>.meta.json   # 子 agent 元数据
│               └── workflows/                   # 工作流子目录
│                   └── <run-id>/
│                       └── agent-<agent-id>.jsonl
├── history.jsonl                      # 用户输入历史（Up-arrow 历史）
└── settings.json                      # 用户设置
```

### 1.2 文件命名规则

| 文件类型 | 命名格式 | 说明 |
|----------|----------|------|
| 主会话 | `<uuid>.jsonl` | UUID v4 格式 |
| 子 agent | `agent-<agent-id>.jsonl` | agent-id 格式: `a` + 可选 `<label>-` + 16 位 hex |
| agent 元数据 | `agent-<agent-id>.meta.json` | 与对应 JSONL 同目录 |
| 用户输入历史 | `history.jsonl` | 全局共享，非会话相关 |

### 1.3 路径编码规则

项目路径通过 `sanitizePath()` 编码为目录名：
- 路径分隔符 (`/`, `\`) → `-`
- 冒号 `:` → `-`
- 最大长度限制: `MAX_SANITIZED_LENGTH`

---

## 2. JSONL 文件中的条目类型 (Entry Union)

JSONL 文件的每一行是一个 JSON 对象。所有条目通过 `type` 字段区分类型。
源码中定义了 `Entry` 联合类型（`types/logs.ts:297-318`）：

### 2.1 转录消息（参与对话链）

这些是构成对话的核心消息，拥有 `uuid` 和 `parentUuid` 字段形成链式结构：

| type | 说明 | 参与 parentUuid 链 |
|------|------|-------------------|
| `"user"` | 用户消息（含 tool_result） | 是 |
| `"assistant"` | AI 助手回复（含 tool_use） | 是 |
| `"attachment"` | 附件消息 | 是 |
| `"system"` | 系统消息 | 是 |

### 2.2 元数据条目（不参与对话链）

这些是追加到 JSONL 末尾的元数据，不参与消息树：

| type | 说明 | 关键字段 |
|------|------|----------|
| `"summary"` | 会话摘要 | `leafUuid`, `summary` |
| `"custom-title"` | 用户自定义标题 | `sessionId`, `customTitle` |
| `"ai-title"` | AI 生成标题 | `sessionId`, `aiTitle` |
| `"last-prompt"` | 最后一次用户输入 | `sessionId`, `lastPrompt` |
| `"task-summary"` | agent 当前任务摘要 | `sessionId`, `summary`, `timestamp` |
| `"tag"` | 会话标签 | `sessionId`, `tag` |
| `"agent-name"` | Agent 自定义名称 | `sessionId`, `agentName` |
| `"agent-color"` | Agent 颜色 | `sessionId`, `agentColor` |
| `"agent-setting"` | Agent 设置 | `sessionId`, `agentSetting` |
| `"pr-link"` | 关联的 GitHub PR | `sessionId`, `prNumber`, `prUrl`, `prRepository`, `timestamp` |
| `"mode"` | 会话模式 | `sessionId`, `mode` ("coordinator" \| "normal") |
| `"worktree-state"` | Worktree 状态 | `sessionId`, `worktreeSession` (可为 null) |
| `"file-history-snapshot"` | 文件历史快照 | `messageId`, `snapshot`, `isSnapshotUpdate` |
| `"attribution-snapshot"` | 归因快照 | `messageId`, `surface`, `fileStates`, ... |
| `"content-replacement"` | 内容替换记录 | `sessionId`, `agentId?`, `replacements` |
| `"queue-operation"` | 消息队列操作 | `operation`, `timestamp`, `sessionId` |
| `"speculation-accept"` | 推测接受 | `timestamp`, `timeSavedMs` |
| `"marble-origami-commit"` | 上下文折叠提交 | `collapseId`, `summaryUuid`, `summaryContent`, ... |
| `"marble-origami-snapshot"` | 上下文折叠快照 | `staged[]`, `armed`, `lastSpawnTokens` |

---

## 3. TranscriptMessage 完整字段结构

`TranscriptMessage` = `SerializedMessage` + 扩展字段。
`SerializedMessage` = `Message` + 序列化字段。

### 3.1 所有消息共有的序列化字段 (SerializedMessage)

```typescript
{
  // ---- Message 基础字段 ----
  type: "user" | "assistant" | "attachment" | "system",
  uuid: UUID,                    // 消息唯一标识
  timestamp: string,             // ISO 8601 时间戳

  // ---- SerializedMessage 扩展字段 ----
  cwd: string,                   // 发送时的工作目录
  userType: string,              // 用户类型 ("ant" | "external" 等)
  entrypoint?: string,           // 入口点 (cli/sdk-ts/sdk-py 等)
  sessionId: string,             // 会话 ID
  version: string,               // Claude Code 版本号
  gitBranch?: string,            // 当前 Git 分支
  slug?: string,                 // 会话 slug（用于 plan 文件）

  // ---- TranscriptMessage 扩展字段 ----
  parentUuid: UUID | null,       // 父消息 UUID（构成对话树）
  logicalParentUuid?: UUID | null, // 逻辑父 UUID（compact 边界时保留）
  isSidechain: boolean,          // 是否为子 agent 侧链
  agentId?: string,              // 子 agent ID
  teamName?: string,             // 团队名称（swarm 场景）
  agentName?: string,            // Agent 自定义名称
  agentColor?: string,           // Agent 颜色
  promptId?: string,             // OTel prompt.id 关联
}
```

### 3.2 UserMessage 特有字段

```typescript
{
  type: "user",
  message: {
    role: "user",
    content: string | ContentBlockParam[],  // 文本或内容块数组
  },
  isMeta?: true,                    // 是否为元消息（系统注入，不直接展示给用户）
  isVisibleInTranscriptOnly?: true, // 仅在转录中可见
  isVirtual?: true,                 // 虚拟消息（REPL 提升后的消息）
  isCompactSummary?: true,          // 是否为压缩摘要
  summarizeMetadata?: {             // 压缩摘要元数据
    messagesSummarized: number,
    userContext?: string,
    direction?: PartialCompactDirection,
  },
  toolUseResult?: unknown,          // 工具执行结果
  mcpMeta?: {                       // MCP 协议元数据
    _meta?: Record<string, unknown>,
    structuredContent?: Record<string, unknown>,
  },
  imagePasteIds?: number[],         // 粘贴的图片 ID 列表
  sourceToolAssistantUUID?: UUID,   // tool_result 对应的 assistant 消息 UUID
  permissionMode?: PermissionMode,  // 发送时的权限模式
  origin?: MessageOrigin,           // 消息来源（undefined = 键盘输入）
}
```

### 3.3 AssistantMessage 特有字段

```typescript
{
  type: "assistant",
  message: {
    id: string,                      // API 返回的消息 ID
    container: null,                 // 容器（当前始终为 null）
    model: string,                   // 模型标识符
    role: "assistant",
    stop_reason: string,             // 停止原因
    stop_sequence: string,           // 停止序列
    type: "message",
    usage: {                         // Token 使用统计
      input_tokens: number,
      output_tokens: number,
      cache_creation_input_tokens: number,
      cache_read_input_tokens: number,
      server_tool_use?: {            // **新增** 服务端工具使用
        web_search_requests: number,
        web_fetch_requests: number,
      },
      service_tier: string | null,   // **新增** 服务层级
      cache_creation?: {             // **新增** 缓存创建详情
        ephemeral_1h_input_tokens: number,
        ephemeral_5m_input_tokens: number,
      },
      inference_geo: string | null,  // **新增** 推理地理位置
      iterations: number | null,     // **新增** 迭代次数
      speed: number | null,          // **新增** 速度
    },
    content: BetaContentBlock[],     // 内容块数组
    context_management: null,        // 上下文管理（当前始终为 null）
  },
  requestId?: string,               // API 请求 ID
  apiError?: unknown,               // API 错误信息
  error?: SDKAssistantMessageError,  // SDK 错误
  errorDetails?: string,            // 错误详情
  isApiErrorMessage?: boolean,      // 是否为 API 错误消息
  isVirtual?: true,                 // 虚拟消息
}
```

### 3.4 content 内容块类型

assistant 消息的 `message.content` 是 `BetaContentBlock[]`，包含以下类型：

| content block type | 说明 | 关键字段 |
|-------------------|------|----------|
| `"text"` | 文本块 | `text` |
| `"thinking"` | 思考过程 | `thinking` |
| `"redacted_thinking"` | 已编辑的思考 | `data` |
| `"tool_use"` | 工具调用 | `id`, `name`, `input` |
| `"server_tool_use"` | **新增** 服务端工具 | `id`, `name`, `input` |
| `"web_search_tool_result"` | **新增** 网页搜索结果 | `id`, `content` |
| `"citation"` | **新增** 引用 | 引用来源信息 |

user 消息的 `message.content` 是 `string | ContentBlockParam[]`，内容块包含：

| content block type | 说明 | 关键字段 |
|-------------------|------|----------|
| `"text"` | 文本块 | `text` |
| `"image"` | 图片 | `source` |
| `"document"` | 文档 | `source` |
| `"tool_result"` | 工具执行结果 | `tool_use_id`, `content`, `is_error` |

---

## 4. Agent 元数据文件 (`.meta.json`)

```typescript
{
  agentType: string,            // agent 类型
  worktreePath?: string,        // worktree 隔离路径
  description?: string,         // 原始任务描述
}
```

---

## 5. 用户输入历史 (`history.jsonl`)

```typescript
{
  display: string,              // 显示文本
  pastedContents: Record<number, StoredPastedContent>,  // 粘贴内容
  timestamp: number,            // Unix 毫秒时间戳
  project: string,              // 项目路径
  sessionId?: string,           // 会话 ID
}
```

---

## 6. 会话列表信息 (SessionInfo / LogOption)

### 6.1 轻量级会话信息 (用于列表展示)

`listSessionsImpl.ts` 的 `SessionInfo`：

```typescript
{
  sessionId: string,
  summary: string,              // 优先级：customTitle > lastPrompt > summary > firstPrompt
  lastModified: number,         // 最后修改时间（epoch ms）
  fileSize?: number,            // 文件大小（bytes）
  customTitle?: string,         // 用户自定义标题
  firstPrompt?: string,         // 第一条用户消息
  gitBranch?: string,           // Git 分支
  cwd?: string,                 // 工作目录
  tag?: string,                 // 标签
  createdAt?: number,           // 创建时间（epoch ms）
}
```

### 6.2 完整会话元数据 (LogOption)

`types/logs.ts` 的 `LogOption`（加载完整会话时）：

```typescript
{
  date: string,
  messages: SerializedMessage[],
  fullPath?: string,
  value: number,
  created: Date,
  modified: Date,
  firstPrompt: string,
  messageCount: number,
  fileSize?: number,
  isSidechain: boolean,
  isLite?: boolean,
  sessionId?: string,
  teamName?: string,
  agentName?: string,
  agentColor?: string,
  agentSetting?: string,
  isTeammate?: boolean,
  leafUuid?: UUID,
  summary?: string,
  customTitle?: string,
  tag?: string,
  fileHistorySnapshots?: FileHistorySnapshot[],
  attributionSnapshots?: AttributionSnapshotMessage[],
  contextCollapseCommits?: ContextCollapseCommitEntry[],
  contextCollapseSnapshot?: ContextCollapseSnapshotEntry,
  gitBranch?: string,
  projectPath?: string,
  prNumber?: number,
  prUrl?: string,
  prRepository?: string,
  mode?: "coordinator" | "normal",
  worktreeSession?: PersistedWorktreeSession | null,
  contentReplacements?: ContentReplacementRecord[],
}
```

---

## 7. CCR 现有实现与源码差异对比

### 7.1 Session 模型对比

| 字段 | 源码 (SessionInfo/LogOption) | CCR (Session) | 状态 |
|------|-----|-----|------|
| `sessionId` / `id` | `sessionId: string` | `id: String` | 已有 |
| `name` / `customTitle` | `customTitle?: string` | `name: Option<String>` | 已有（命名不同） |
| `timestamp` | `lastModified: number` | `timestamp: String` | 已有 |
| `messageCount` | `messageCount: number` | `message_count: u32` | 已有 |
| `filePath` / `fullPath` | `fullPath?: string` | `file_path: String` | 已有 |
| `summary` | `summary: string` | **缺失** | **需新增** |
| `firstPrompt` | `firstPrompt?: string` | **缺失** | **需新增** |
| `gitBranch` | `gitBranch?: string` | **缺失** | **需新增** |
| `cwd` | `cwd?: string` | **缺失** | **需新增** |
| `tag` | `tag?: string` | **缺失** | **需新增** |
| `createdAt` | `createdAt?: number` | **缺失** | **需新增** |
| `fileSize` | `fileSize?: number` | **缺失** | **需新增** |
| `isSidechain` | `isSidechain: boolean` | **缺失** | **需新增** |
| `teamName` | `teamName?: string` | **缺失** | 可选 |
| `agentName` | `agentName?: string` | **缺失** | 可选 |
| `agentColor` | `agentColor?: string` | **缺失** | 可选 |
| `agentSetting` | `agentSetting?: string` | **缺失** | 可选 |
| `isTeammate` | `isTeammate?: boolean` | **缺失** | 可选 |
| `mode` | `mode?: string` | **缺失** | 可选 |
| `prNumber` | `prNumber?: number` | **缺失** | 可选 |
| `prUrl` | `prUrl?: string` | **缺失** | 可选 |
| `prRepository` | `prRepository?: string` | **缺失** | 可选 |
| `projectPath` | `projectPath?: string` | **缺失** | 可选 |

### 7.2 SessionMessage 模型对比

| 方面 | 源码 | CCR | 状态 |
|------|------|-----|------|
| 消息存储类型 | 强类型 `Message` union | `serde_json::Value` | CCR 设计合理 |
| 消息处理方式 | 运行时类型分支 | 运行时 JSON 值访问 | 等价 |

**CCR 使用 `serde_json::Value` 的设计是合理的**——它能自动兼容所有新增字段，无需修改 Rust struct。

### 7.3 DisplayMessage 模型对比

| 字段 | 源码行为 | CCR (DisplayMessage) | 状态 |
|------|----------|-----|------|
| `source_uuid` | 消息 UUID | 已有 | 已有 |
| `display_id` | React key | 已有 | 已有 |
| `display_type` | 消息显示类型 | 已有 | 已有 |
| `timestamp` | ISO 时间戳 | 已有 | 已有 |
| `content` | 内容块列表 | 已有 | 已有 |
| `editable` | 是否可编辑 | 已有 | 已有 |
| `model` | AI 模型 | 已有 | 已有 |
| `usage` | Token 统计 | 已有 | 已有 |
| `is_abandoned` | 非主链标记 | 已有 | 已有 |
| `cwd` | 工作目录 | 已有 | 已有 |
| `agentId` | 子 agent ID | **缺失** | **可选新增** |
| `gitBranch` | Git 分支 | **缺失** | **可选新增** |
| `sessionId` | 会话 ID | **缺失** | **可选新增** |
| `version` | CC 版本号 | **缺失** | **可选新增** |
| `entrypoint` | 入口点 | **缺失** | 低优先级 |

### 7.4 TokenStats 对比

| 字段 | 源码 (usage) | CCR (TokenStats) | 状态 |
|------|------|-----|------|
| `input_tokens` | 有 | 已有 | 已有 |
| `output_tokens` | 有 | 已有 | 已有 |
| `cache_creation_input_tokens` | 有 | 已有 | 已有 |
| `cache_read_input_tokens` | 有 | 已有 | 已有 |
| `server_tool_use.web_search_requests` | **新增** | **缺失** | **需新增** |
| `server_tool_use.web_fetch_requests` | **新增** | **缺失** | **需新增** |
| `service_tier` | **新增** | **缺失** | 低优先级 |
| `cache_creation.ephemeral_1h_input_tokens` | **新增** | **缺失** | 低优先级 |
| `cache_creation.ephemeral_5m_input_tokens` | **新增** | **缺失** | 低优先级 |
| `inference_geo` | **新增** | **缺失** | 低优先级 |
| `iterations` | **新增** | **缺失** | 低优先级 |
| `speed` | **新增** | **缺失** | 低优先级 |

### 7.5 scanner.rs 对比

| 方面 | 源码 (listSessionsImpl) | CCR (scanner.rs) | 差异 |
|------|---------|---------|------|
| 过滤 sidechain | 检查首行 `isSidechain:true` | 排除 `agent-` 前缀文件 | CCR 缺失侧链检测 |
| 提取标题 | head+tail 扫描 `customTitle`、`aiTitle` | 不提取 | **缺失** |
| 提取首条消息 | head 扫描首条 user 消息 | 不提取 | **缺失** |
| 提取 Git 分支 | head+tail 扫描 `gitBranch` | 不提取 | **缺失** |
| 提取标签 | tail 扫描 `tag` | 不提取 | **缺失** |
| 提取 cwd | head 扫描 `cwd` | 不提取 | **缺失** |
| 读取方式 | head(64KB) + tail(64KB) 轻量读取 | 仅 stat 元数据 | CCR 更轻量但信息少 |
| Worktree 支持 | 扫描 git worktree 路径 | 不支持 | 可选 |

### 7.6 消息分类器 (classifier.rs) 对比

| 分类 | 源码行为 | CCR | 状态 |
|------|----------|-----|------|
| user/assistant/system/attachment 四种核心类型 | 通过 `isTranscriptMessage` 过滤 | classifier.rs 已处理 user/assistant | **缺失 attachment** |
| `"progress"` 类型 | 已从 Entry 联合移除，旧转录兼容处理 | 被 classifier Skip | 已处理 |
| 元数据条目 | 通过 `type` 分支处理 | 由 `serde_json::Value` 自动保留 | 无问题 |
| `server_tool_use` 内容块 | 服务端工具调用 | classifier 未识别 | **可能需更新** |
| `web_search_tool_result` | 搜索结果展示 | classifier 未识别 | **可能需更新** |
| `citation` 内容块 | 引用展示 | classifier 未识别 | **可能需更新** |

---

## 8. 改动建议

### 8.1 高优先级（影响核心功能）

#### 1. 增强 Session 模型 — `models/project.rs`

为 `Session` 结构体添加以下字段：

```rust
pub struct Session {
    // ... 现有字段 ...
    pub summary: Option<String>,        // 会话摘要
    pub first_prompt: Option<String>,   // 首条用户消息
    pub git_branch: Option<String>,     // Git 分支
    pub cwd: Option<String>,            // 工作目录
    pub tag: Option<String>,            // 标签
    pub created_at: Option<String>,     // 创建时间
    pub file_size: Option<u64>,         // 文件大小
    pub is_sidechain: bool,             // 是否为侧链
}
```

#### 2. 增强 scanner.rs 轻量级元数据提取

参考源码的 `readSessionLite` 和 `parseSessionInfoFromLite` 策略：
- 对每个 JSONL 文件读取 **前 64KB** (head) 和 **后 64KB** (tail)
- 从 head 提取: `cwd`, `gitBranch`, `timestamp`(创建时间), `isSidechain`, `firstPrompt`
- 从 tail 提取: `customTitle`, `aiTitle`, `lastPrompt`, `summary`, `tag`, `gitBranch`
- 优先级: `customTitle` > `aiTitle` > `lastPrompt` > `summary` > `firstPrompt`

#### 3. 更新 TokenStats — `models/display.rs`

添加 `server_tool_use` 统计：

```rust
pub struct TokenStats {
    // ... 现有字段 ...
    pub web_search_requests: u64,       // 网页搜索请求次数
    pub web_fetch_requests: u64,        // 网页获取请求次数
}
```

### 8.2 中优先级（增强功能）

#### 4. 支持新的 content block 类型

在 `classifier.rs` 和 `transformer.rs` 中：
- 识别 `server_tool_use` 块（类似 `tool_use`）
- 识别 `web_search_tool_result` 块（类似 `tool_result`）
- 识别 `citation` 块（引用来源）

由于 CCR 使用 `serde_json::Value` 存储消息，新块类型不会导致反序列化失败——
只是在分类和显示时可能被忽略。需要更新前端渲染逻辑。

#### 5. DisplayMessage 添加可选字段

```rust
pub struct DisplayMessage {
    // ... 现有字段 ...
    pub agent_id: Option<String>,       // 子 agent ID
    pub git_branch: Option<String>,     // Git 分支
    pub session_id: Option<String>,     // 会话 ID
    pub version: Option<String>,        // Claude Code 版本号
}
```

#### 6. 支持 `ai-title` 类型

当前 CCR 只支持 `custom-title`（用户标题），应增加 `ai-title`（AI 生成标题）的支持。
优先级：`customTitle` > `aiTitle`。

### 8.3 低优先级（可选增强）

#### 7. 支持更多元数据条目

如果需要在 CCR 中展示以下信息：
- PR 链接 (`pr-link`)
- Agent 团队信息 (`agent-name`, `agent-color`, `agent-setting`)
- 会话模式 (`mode`)
- Worktree 状态 (`worktree-state`)

#### 8. 支持 context collapse

源码中的 `marble-origami-commit` 和 `marble-origami-snapshot` 用于上下文折叠优化。
CCR 作为阅读器暂时不需要支持，但应注意这些条目存在于 JSONL 中。

#### 9. 支持 agent 元数据文件

读取 `.meta.json` 文件以获取子 agent 的类型和描述信息。

---

## 9. 需要更新的具体文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src-tauri/src/models/project.rs` | 扩展 | Session 结构体添加新字段 |
| `src-tauri/src/models/display.rs` | 扩展 | TokenStats 添加 web_search 字段；DisplayMessage 添加可选字段 |
| `src-tauri/src/services/scanner.rs` | 重构 | 从 stat-only 升级为 head+tail 轻量读取 |
| `src-tauri/src/services/classifier.rs` | 扩展 | 支持新的 content block 类型 |
| `src-tauri/src/services/transformer.rs` | 扩展 | 提取新字段；处理新 content block 类型 |
| `src-tauri/src/commands/projects.rs` | 调整 | 适配 Session 新字段 |
| `src-tauri/src/commands/messages.rs` | 可能调整 | 适配 DisplayMessage 新字段 |

---

## 10. 总结

### CCR 现有架构的优势

1. **`serde_json::Value` 策略正确**：消息体使用 Value 存储，自动兼容所有新增字段，无需为每个新增字段修改 Rust struct。
2. **DisplayMessage 分离架构良好**：显示层与存储层完全解耦，扩展性好。
3. **并行扫描架构良好**：scanner.rs 使用 JoinSet 并行扫描，性能好。

### 主要差距

1. **会话列表信息缺失**：scanner.rs 仅获取文件名和修改时间，缺少标题、摘要、标签等关键信息。这是用户体验最大的差距——源码通过 head+tail 轻量读取策略获取这些信息，CCR 应跟进。
2. **新 usage 字段缺失**：`server_tool_use` (web search/fetch) 统计未累计，影响 token 统计准确性。
3. **新 content block 类型**：`server_tool_use`、`web_search_tool_result`、`citation` 等新块类型在渲染时可能被忽略。
4. **AI 标题**：源码支持 `ai-title`（AI 自动生成标题），CCR 尚未支持。

### 风险评估

- **Session 模型变更**：影响前端 TypeScript 接口，需要同步更新前端类型定义
- **scanner.rs 重构**：从 stat-only 升级为 head+tail 读取，性能影响需测试
- **classifier.rs 扩展**：新增 content block 类型是增量变更，低风险
