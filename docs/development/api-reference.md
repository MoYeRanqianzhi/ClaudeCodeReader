# API 参考文档

本文档详细说明 CCR 的 API 接口，包括：
- **Rust Commands API**：后端通过 Tauri IPC 暴露的 15 个命令
- **前端数据访问层**：`src/utils/claudeData.ts` 中封装的调用函数
- **工具函数**：`toolFormatter.ts`、`messageTransform.ts` 等工具模块

---

## Rust Commands API

前端通过 `invoke()` 调用 Rust 后端命令。所有命令均为异步，返回 `Result<T, String>`。

### 项目扫描

#### `scan_projects`

扫描所有项目及其会话列表。

```typescript
const projects = await invoke<Project[]>('scan_projects');
```

- 使用 TTL 缓存（30 秒），重复调用直接返回缓存
- 项目按最新会话时间降序排序

### 消息操作

#### `read_session_messages`

读取并转换会话消息。

```typescript
const session = await invoke<TransformedSession>('read_session_messages', {
  sessionPath: string,
  projectPath: string,
});
```

返回 `TransformedSession`：
- `messages: DisplayMessage[]` — 前端可直接渲染的消息列表
- `tool_use_map: Record<string, ToolUseInfo>` — 工具调用信息映射
- `token_stats: TokenStats` — Token 使用量统计
- `project_path: string` — 项目路径

#### `delete_message`

删除单条消息。

```typescript
const session = await invoke<TransformedSession>('delete_message', {
  sessionPath: string,
  messageUuid: string,
  projectPath: string,
});
```

#### `delete_messages`

批量删除消息。

```typescript
const session = await invoke<TransformedSession>('delete_messages', {
  sessionPath: string,
  messageUuids: string[],
  projectPath: string,
});
```

#### `edit_message_content`

按内容块编辑消息。

```typescript
const session = await invoke<TransformedSession>('edit_message_content', {
  sessionPath: string,
  messageUuid: string,
  blockEdits: { index: number; type: string; text: string }[],
  projectPath: string,
});
```

#### `delete_session`

删除会话文件。

```typescript
await invoke('delete_session', { sessionPath: string });
```

#### `search_session`

4 模式全文搜索。

```typescript
const matchIds = await invoke<string[]>('search_session', {
  sessionPath: string,
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
});
```

返回匹配的 `displayId` 列表。使用 memchr SIMD 加速搜索。

#### `export_session`

导出会话。

```typescript
const content = await invoke<string>('export_session', {
  sessionPath: string,
  format: 'markdown' | 'json',
});
```

### 设置管理

#### `get_claude_data_path`

```typescript
const path = await invoke<string>('get_claude_data_path');
```

#### `read_settings` / `save_settings`

```typescript
const settings = await invoke<ClaudeSettings>('read_settings', { claudePath: string });
await invoke('save_settings', { claudePath: string, settings: ClaudeSettings });
```

#### `read_env_config` / `save_env_config`

```typescript
const config = await invoke<EnvSwitcherConfig>('read_env_config');
await invoke('save_env_config', { config: EnvSwitcherConfig });
```

#### `read_history`

```typescript
const history = await invoke<Value[]>('read_history', { claudePath: string });
```

#### `check_file_exists`

```typescript
const exists = await invoke<boolean>('check_file_exists', { filePath: string });
```

---

## 前端数据访问层 (`claudeData.ts`)

以下函数封装了对 Rust Commands 的调用，提供更友好的 TypeScript 接口。

---

## 目录

- [路径工具函数](#路径工具函数)
- [环境配置管理](#环境配置管理)
- [设置管理](#设置管理)
- [历史记录](#历史记录)
- [项目与会话](#项目与会话)
- [消息操作](#消息操作)
- [格式化工具](#格式化工具)
- [内部工具](#内部工具)

---

## 路径工具函数

### `getClaudeDataPath()`

获取 Claude Code 数据目录的绝对路径。

```typescript
export async function getClaudeDataPath(): Promise<string>
```

**参数**：无

**返回值**：`Promise<string>` — Claude Code 数据目录的绝对路径，即 `~/.claude`。

**说明**：
- 通过 `@tauri-apps/api/path` 的 `homeDir()` 获取用户主目录。
- 路径拼接使用 `join()` 确保跨平台兼容性。
- 返回的路径不保证目录实际存在。

**异常**：如果无法获取用户主目录（极端情况），将抛出 Tauri API 错误。

**使用示例**：

```typescript
const claudePath = await getClaudeDataPath();
// Windows: "C:\\Users\\username\\.claude"
// macOS/Linux: "/home/username/.claude"
```

---

### `getCCRConfigPath()` (内部函数)

获取 CCR 自身配置目录的路径，并确保目录存在。

```typescript
async function getCCRConfigPath(): Promise<string>
```

**参数**：无

**返回值**：`Promise<string>` — CCR 配置目录的绝对路径，即 `~/.mo/CCR`。

**说明**：
- 此函数为模块内部函数（未导出），仅供 `getEnvSwitcherConfigPath()` 调用。
- 如果 `~/.mo/CCR` 目录不存在，会自动递归创建（`recursive: true`）。
- 使用 `@tauri-apps/plugin-fs` 的 `mkdir` 和 `exists` 函数。

**异常**：如果无法创建目录（如权限不足），将抛出文件系统错误。

**使用示例**：

```typescript
// 仅在模块内部使用
const ccrPath = await getCCRConfigPath();
// 返回: "~/.mo/CCR" (目录已确保存在)
```

---

### `getEnvSwitcherConfigPath()` (内部函数)

获取环境切换器配置文件的路径。

```typescript
async function getEnvSwitcherConfigPath(): Promise<string>
```

**参数**：无

**返回值**：`Promise<string>` — 配置文件的绝对路径，即 `~/.mo/CCR/env-profiles.json`。

**说明**：
- 此函数为模块内部函数（未导出）。
- 内部调用 `getCCRConfigPath()` 获取目录路径，因此会自动确保目录存在。
- 返回的文件路径不保证文件实际存在。

**异常**：继承自 `getCCRConfigPath()` 可能抛出的异常。

**使用示例**：

```typescript
// 仅在模块内部使用
const configPath = await getEnvSwitcherConfigPath();
// 返回: "~/.mo/CCR/env-profiles.json"
```

---

### `decodeProjectPath(encodedName)`

将 Claude Code 编码的项目目录名解码为实际文件系统路径。

```typescript
function decodeProjectPath(encodedName: string): string
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `encodedName` | `string` | Claude Code 项目目录的编码名称 |

**返回值**：`string` — 解码后的实际文件系统路径。

**说明**：

Claude Code 在 `~/.claude/projects/` 下使用编码后的目录名存储项目数据。编码规则如下：

| 原始字符 | 编码形式 | 说明 |
|---------|---------|------|
| `X:\` (盘符) | `X--` | 盘符后的 `:\` 编码为 `--` |
| `\` (路径分隔符) | `-` | 单个连字符表示路径分隔符 |

解码过程（按正则替换顺序）：
1. `^([A-Za-z])--` → `$1:\` — 将行首的盘符编码 `X--` 还原为 `X:\`
2. `--` → `\` — 将双连字符还原为反斜杠（此规则在第 1 步之后执行，避免冲突）
3. `-` → `\` — 将单连字符还原为反斜杠

**异常**：此函数为纯同步函数，不会抛出异常。

**使用示例**：

```typescript
decodeProjectPath("G--ClaudeProjects-Test");
// 返回: "G:\\ClaudeProjects\\Test"

decodeProjectPath("C--Users-username-projects-my-app");
// 返回: "C:\\Users\\username\\projects\\my\\app"
```

> **注意**：当前的解码规则针对 Windows 路径设计。由于单连字符 `-` 和路径分隔符共用编码，如果原始路径中包含连字符（如 `my-app`），解码结果会不正确。这是 Claude Code 编码格式的固有局限。

---

## 环境配置管理

### `readEnvSwitcherConfig(_claudePath)`

读取环境切换器配置。

```typescript
export async function readEnvSwitcherConfig(_claudePath: string): Promise<EnvSwitcherConfig>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `_claudePath` | `string` | Claude 数据目录路径（**注意：此参数当前未使用**） |

**返回值**：`Promise<EnvSwitcherConfig>` — 环境切换器配置对象。

**说明**：
- 从 `~/.mo/CCR/env-profiles.json` 读取配置文件。
- 如果文件不存在，返回默认的空配置 `{ profiles: [], activeProfileId: null }`。
- `_claudePath` 参数保留在函数签名中是为了保持 API 接口的一致性（其他函数都接受 `claudePath`），但实际上配置文件路径是固定的 (`~/.mo/CCR/env-profiles.json`)，不依赖此参数。

**异常**：如果文件存在但内容不是有效的 JSON，`JSON.parse()` 将抛出 `SyntaxError`。

**使用示例**：

```typescript
const config = await readEnvSwitcherConfig(claudePath);
console.log(config.profiles);       // EnvProfile[]
console.log(config.activeProfileId); // string | null
```

---

### `saveEnvSwitcherConfig(_claudePath, config)`

保存环境切换器配置。

```typescript
export async function saveEnvSwitcherConfig(_claudePath: string, config: EnvSwitcherConfig): Promise<void>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `_claudePath` | `string` | Claude 数据目录路径（**当前未使用**） |
| `config` | `EnvSwitcherConfig` | 要保存的配置对象 |

**返回值**：`Promise<void>`

**说明**：
- 将配置对象序列化为格式化的 JSON（2 空格缩进）写入 `~/.mo/CCR/env-profiles.json`。
- 覆盖写入，不做合并。
- 同样，`_claudePath` 参数未被实际使用。

**异常**：如果无法写入文件（如目录不存在、权限不足），将抛出文件系统错误。

**使用示例**：

```typescript
const config: EnvSwitcherConfig = {
  profiles: [myProfile],
  activeProfileId: myProfile.id,
};
await saveEnvSwitcherConfig(claudePath, config);
```

---

### `createEnvProfile(name, env)`

创建一个新的环境配置对象。

```typescript
export function createEnvProfile(name: string, env: Record<string, string>): EnvProfile
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 配置名称（用户可见的显示名） |
| `env` | `Record<string, string>` | 环境变量键值对 |

**返回值**：`EnvProfile` — 新创建的环境配置对象。

**说明**：
- 这是一个纯同步函数，仅构建对象，不涉及文件操作。
- `id` 通过 `generateId()` 生成，具有唯一性。
- `createdAt` 和 `updatedAt` 均设为当前时间的 ISO 8601 字符串。

**异常**：不会抛出异常。

**使用示例**：

```typescript
const profile = createEnvProfile("生产环境", {
  ANTHROPIC_API_KEY: "sk-ant-xxx",
  ANTHROPIC_BASE_URL: "https://api.anthropic.com",
});
// 返回:
// {
//   id: "m1a2b3c4d5e6f",
//   name: "生产环境",
//   env: { ANTHROPIC_API_KEY: "sk-ant-xxx", ... },
//   createdAt: "2025-01-15T08:30:00.000Z",
//   updatedAt: "2025-01-15T08:30:00.000Z"
// }
```

---

### `applyEnvProfile(claudePath, profile)`

将指定的环境配置应用到 Claude Code 的 settings 文件。

```typescript
export async function applyEnvProfile(
  claudePath: string,
  profile: EnvProfile
): Promise<ClaudeSettings>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `claudePath` | `string` | Claude 数据目录路径 |
| `profile` | `EnvProfile` | 要应用的环境配置 |

**返回值**：`Promise<ClaudeSettings>` — 更新后的完整设置对象。

**说明**：
- 读取当前的 `~/.claude/settings.json`。
- 用 `profile.env` 替换 `settings.env` 字段（展开拷贝，不是引用赋值）。
- 保留 settings 中的其他字段（如 `model`、`permissions`、`apiKey`）不变。
- 将更新后的 settings 写回文件。

**异常**：继承自 `readSettings()` 和 `saveSettings()` 可能抛出的异常。

**使用示例**：

```typescript
const updatedSettings = await applyEnvProfile(claudePath, selectedProfile);
// settings.json 已被更新，settings.env 现在是 selectedProfile.env 的内容
```

---

### `saveCurrentAsProfile(claudePath, name)`

将当前 Claude Code 的环境变量保存为一个新的环境配置。

```typescript
export async function saveCurrentAsProfile(
  claudePath: string,
  name: string
): Promise<EnvProfile>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `claudePath` | `string` | Claude 数据目录路径 |
| `name` | `string` | 新配置的名称 |

**返回值**：`Promise<EnvProfile>` — 新创建并保存的环境配置对象。

**说明**：

执行以下步骤：
1. 从 `~/.claude/settings.json` 读取当前设置。
2. 使用 `settings.env`（如果不存在则使用空对象 `{}`）创建新的 `EnvProfile`。
3. 读取环境切换器配置。
4. 将新配置追加到 `profiles` 数组。
5. 将 `activeProfileId` 设为新配置的 ID。
6. 保存环境切换器配置。

**异常**：继承自 `readSettings()`、`readEnvSwitcherConfig()`、`saveEnvSwitcherConfig()` 可能抛出的异常。

**使用示例**：

```typescript
const newProfile = await saveCurrentAsProfile(claudePath, "当前配置备份");
console.log(newProfile.id);   // 新生成的 ID
console.log(newProfile.env);  // 从 settings.json 快照的环境变量
```

---

## 设置管理

### `readSettings(claudePath)`

读取 Claude Code 的设置文件。

```typescript
export async function readSettings(claudePath: string): Promise<ClaudeSettings>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `claudePath` | `string` | Claude 数据目录路径（如 `~/.claude`） |

**返回值**：`Promise<ClaudeSettings>` — Claude Code 设置对象。

**说明**：
- 读取 `{claudePath}/settings.json` 文件。
- 如果文件不存在，返回空对象 `{}`。
- 不做模式校验，直接将 JSON 解析为 `ClaudeSettings` 类型。

**异常**：如果文件存在但内容不是有效 JSON，`JSON.parse()` 将抛出 `SyntaxError`。

**使用示例**：

```typescript
const settings = await readSettings(claudePath);
console.log(settings.env);         // Record<string, string> | undefined
console.log(settings.model);       // string | undefined
console.log(settings.permissions); // { allow?: string[], deny?: string[] } | undefined
console.log(settings.apiKey);      // string | undefined
```

---

### `saveSettings(claudePath, settings)`

保存 Claude Code 的设置文件。

```typescript
export async function saveSettings(claudePath: string, settings: ClaudeSettings): Promise<void>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `claudePath` | `string` | Claude 数据目录路径 |
| `settings` | `ClaudeSettings` | 要保存的设置对象 |

**返回值**：`Promise<void>`

**说明**：
- 将设置对象序列化为格式化的 JSON（2 空格缩进）写入 `{claudePath}/settings.json`。
- 覆盖写入，不做增量合并。
- **注意**：此函数会直接修改 Claude Code 的配置文件，影响 Claude Code 的运行行为。

**异常**：如果无法写入文件，将抛出文件系统错误。

**使用示例**：

```typescript
const settings = await readSettings(claudePath);
settings.model = "claude-sonnet-4-20250514";
await saveSettings(claudePath, settings);
```

---

## 历史记录

### `readHistory(claudePath)`

读取 Claude Code 的命令历史记录。

```typescript
export async function readHistory(claudePath: string): Promise<HistoryEntry[]>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `claudePath` | `string` | Claude 数据目录路径 |

**返回值**：`Promise<HistoryEntry[]>` — 历史记录条目数组。

**说明**：
- 读取 `{claudePath}/history.jsonl` 文件（JSONL 格式，每行一个 JSON 对象）。
- 如果文件不存在，返回空数组 `[]`。
- 每行独立解析为一个 `HistoryEntry` 对象。
- 空行会被自动过滤。

> **注意**：此函数已实现且可正常调用，但当前 UI 中 **尚未使用**。预留用于未来的历史记录浏览功能。

**异常**：如果某行不是有效的 JSON，`JSON.parse()` 将抛出 `SyntaxError`（当前实现未做逐行错误处理）。

**使用示例**：

```typescript
const history = await readHistory(claudePath);
for (const entry of history) {
  console.log(entry.display);    // 用户输入的命令文本
  console.log(entry.timestamp);  // Unix 时间戳
  console.log(entry.project);    // 关联的项目路径
  console.log(entry.sessionId);  // 关联的会话 ID
}
```

---

## 项目与会话

### `getProjects(claudePath)`

获取所有项目列表及其会话信息。

```typescript
export async function getProjects(claudePath: string): Promise<Project[]>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `claudePath` | `string` | Claude 数据目录路径 |

**返回值**：`Promise<Project[]>` — 项目列表，按最新会话时间降序排序。

**说明**：

执行以下步骤：
1. 读取 `{claudePath}/projects/` 目录下的所有子目录。
2. 对每个子目录，使用 `decodeProjectPath()` 解码目录名为实际项目路径。
3. 调用 `getProjectSessions()` 获取该项目下的所有会话。
4. 组装 `Project` 对象并按最新会话的时间戳降序排序。

- 如果 `{claudePath}/projects/` 目录不存在，返回空数组 `[]`。
- 排序逻辑：取每个项目的第一个会话（已按时间降序排列）的时间戳，没有会话的项目排在最后。

**异常**：如果无法读取目录，将抛出文件系统错误。

**使用示例**：

```typescript
const projects = await getProjects(claudePath);
for (const project of projects) {
  console.log(project.name);     // 编码后的目录名
  console.log(project.path);     // 解码后的实际路径
  console.log(project.sessions); // Session[]
}
```

---

### `getProjectSessions(projectPath)` (内部函数)

获取指定项目目录下的所有会话。

```typescript
async function getProjectSessions(projectPath: string): Promise<Session[]>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `projectPath` | `string` | 项目在 `~/.claude/projects/` 下的完整路径（编码目录名） |

**返回值**：`Promise<Session[]>` — 会话列表，按文件修改时间降序排序。

**说明**：
- 此函数为模块内部函数（未导出）。
- 读取项目目录下的所有文件，筛选出 `.jsonl` 后缀且不以 `agent-` 开头的文件。
- 排除 `agent-` 前缀文件是因为这些是 Claude Code 的 Agent 子任务会话，不作为独立会话展示。
- 使用 `stat()` 获取文件修改时间 (`mtime`) 作为会话时间戳。
- `messageCount` 固定设为 `0`，实际消息数在读取会话内容时才能确定。

**异常**：如果无法读取目录或获取文件状态，将抛出文件系统错误。

**使用示例**：

```typescript
// 仅在模块内部使用
const sessions = await getProjectSessions(fullProjectDirPath);
for (const session of sessions) {
  console.log(session.id);        // 会话 ID（文件名去掉 .jsonl 后缀）
  console.log(session.timestamp);  // 文件修改时间
  console.log(session.filePath);   // JSONL 文件的完整路径
}
```

---

### `readSessionMessages(sessionFilePath)`

读取指定会话文件中的所有消息。

```typescript
export async function readSessionMessages(sessionFilePath: string): Promise<SessionMessage[]>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `sessionFilePath` | `string` | 会话 JSONL 文件的绝对路径 |

**返回值**：`Promise<SessionMessage[]>` — 消息数组，保持文件中的原始顺序。

**说明**：
- 读取 JSONL 文件，每行解析为一个 `SessionMessage` 对象。
- 空行会被过滤。
- 解析失败的行会被静默忽略（`catch` 返回 `null`，随后被 `filter` 移除），不会导致整个读取失败。
- 如果文件不存在，返回空数组 `[]`。

**异常**：如果无法读取文件（权限问题等），将抛出文件系统错误。JSON 解析错误会被静默处理。

**使用示例**：

```typescript
const messages = await readSessionMessages(session.filePath);
for (const msg of messages) {
  console.log(msg.type);      // 'user' | 'assistant' | ...
  console.log(msg.uuid);      // 消息唯一标识
  console.log(msg.timestamp);  // 时间戳字符串
}
```

---

## 消息操作

### `saveSessionMessages(sessionFilePath, messages)`

将消息数组写入会话文件。

```typescript
export async function saveSessionMessages(sessionFilePath: string, messages: SessionMessage[]): Promise<void>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `sessionFilePath` | `string` | 会话 JSONL 文件的绝对路径 |
| `messages` | `SessionMessage[]` | 要写入的消息数组 |

**返回值**：`Promise<void>`

**说明**：
- 将每条消息序列化为单行 JSON，用换行符 `\n` 连接，末尾追加一个换行符。
- 覆盖写入，不做增量追加。
- **注意**：此函数会直接修改 Claude Code 的会话文件。

**异常**：如果无法写入文件，将抛出文件系统错误。

**使用示例**：

```typescript
await saveSessionMessages(session.filePath, updatedMessages);
```

---

### `deleteMessage(sessionFilePath, messageUuid)`

从会话中删除指定消息。

```typescript
export async function deleteMessage(sessionFilePath: string, messageUuid: string): Promise<SessionMessage[]>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `sessionFilePath` | `string` | 会话 JSONL 文件的绝对路径 |
| `messageUuid` | `string` | 要删除的消息的 UUID |

**返回值**：`Promise<SessionMessage[]>` — 删除后的完整消息列表。

**说明**：

执行以下步骤：
1. 读取会话文件中的所有消息。
2. 过滤掉 `uuid` 匹配的消息。
3. 将过滤后的消息列表写回文件。
4. 返回过滤后的消息列表。

- 如果指定的 `messageUuid` 不存在，不会报错，消息列表保持不变。
- 不处理消息之间的父子关系 (`parentUuid`)，删除父消息不会级联删除子消息。

**异常**：继承自 `readSessionMessages()` 和 `saveSessionMessages()` 可能抛出的异常。

**使用示例**：

```typescript
const remainingMessages = await deleteMessage(session.filePath, "msg-uuid-123");
```

---

### `editMessageContent(sessionFilePath, messageUuid, newContent)`

编辑指定消息的文本内容。

```typescript
export async function editMessageContent(
  sessionFilePath: string,
  messageUuid: string,
  newContent: string
): Promise<SessionMessage[]>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `sessionFilePath` | `string` | 会话 JSONL 文件的绝对路径 |
| `messageUuid` | `string` | 要编辑的消息的 UUID |
| `newContent` | `string` | 新的文本内容 |

**返回值**：`Promise<SessionMessage[]>` — 编辑后的完整消息列表。

**说明**：

此函数会根据消息的 `message.content` 原始格式来决定更新策略：

#### 当 `content` 为字符串格式时

直接将 `content` 替换为 `newContent`。

#### 当 `content` 为 `MessageContent[]` 数组格式时

- 遍历数组，将所有 `type === 'text'` 的条目的 `text` 字段替换为 `newContent`。
- 保留非 `text` 类型的条目不变（如 `tool_use`、`tool_result` 等）。
- 特殊情况：如果原始数组中没有 `text` 类型的条目，则用 `[{ type: 'text', text: newContent }]` 替换整个数组。

#### 匹配条件

只有同时满足以下条件的消息才会被编辑：
1. `msg.uuid === messageUuid`
2. `msg.message` 存在（非 `undefined`）

**异常**：继承自 `readSessionMessages()` 和 `saveSessionMessages()` 可能抛出的异常。

**使用示例**：

```typescript
const updatedMessages = await editMessageContent(
  session.filePath,
  "msg-uuid-456",
  "这是修改后的消息内容"
);
```

---

## 格式化工具

### `getMessageText(message)`

提取消息的纯文本内容。

```typescript
export function getMessageText(message: SessionMessage): string
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `message` | `SessionMessage` | 会话消息对象 |

**返回值**：`string` — 消息的纯文本内容。

**说明**：

根据 `message.message.content` 的类型返回不同结果：

| `content` 类型 | 处理方式 | 返回值 |
|----------------|---------|--------|
| 不存在 (`message.message` 为 `undefined`) | 直接返回 | `""` (空字符串) |
| `string` | 直接返回字符串值 | 原始字符串 |
| `MessageContent[]` | 过滤出 `type === 'text'` 的条目，提取 `text` 字段，用换行符连接 | 拼接后的文本 |

**异常**：不会抛出异常。

**使用示例**：

```typescript
const text = getMessageText(message);
if (text) {
  console.log("消息内容:", text);
}
```

---

### `formatTimestamp(timestamp)`

将时间戳格式化为中文本地化的日期时间字符串。

```typescript
export function formatTimestamp(timestamp: string | number | Date): string
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `timestamp` | `string \| number \| Date` | 时间戳，支持 ISO 字符串、Unix 毫秒数或 Date 对象 |

**返回值**：`string` — 格式化后的日期时间字符串。

**说明**：
- 使用 `toLocaleString('zh-CN', ...)` 进行中文本地化格式化。
- 输出格式：`YYYY/MM/DD HH:mm:ss`（具体格式取决于运行时的 `zh-CN` locale 实现）。

**异常**：如果传入无法解析的时间戳，`new Date()` 会返回 `Invalid Date`，格式化结果将为 `"Invalid Date"`。

**使用示例**：

```typescript
formatTimestamp("2025-01-15T08:30:00.000Z");
// 返回: "2025/01/15 16:30:00" (UTC+8 时区)

formatTimestamp(1705312200000);
// 返回: "2025/01/15 16:30:00"

formatTimestamp(new Date());
// 返回: 当前时间的格式化字符串
```

---

## 内部工具

### `generateId()`

生成唯一的字符串标识符。

```typescript
function generateId(): string
```

**参数**：无

**返回值**：`string` — 唯一的字符串 ID。

**说明**：

此函数为模块内部函数（未导出），用于生成环境配置 (`EnvProfile`) 的 `id` 字段。

**算法**：
```
ID = Date.now().toString(36) + Math.random().toString(36).substring(2)
```

分为两部分拼接：
1. **时间戳部分**：`Date.now().toString(36)` — 将当前的 Unix 毫秒时间戳转为 36 进制字符串（约 8-9 个字符）。
2. **随机部分**：`Math.random().toString(36).substring(2)` — 将 `[0, 1)` 范围的随机数转为 36 进制，去掉前缀 `"0."` 后取剩余字符（约 10-11 个字符）。

**生成结果示例**：`"m1a2b3c4dxyz789qr"`

**唯一性保障**：
- 时间戳部分确保毫秒级别的时间区分。
- 随机部分提供额外的碰撞防护。
- 对于 CCR 的使用场景（用户手动创建环境配置，频率极低），此算法的唯一性是充分的。
- 这不是加密安全的随机生成器，不应用于安全敏感场景。

**异常**：不会抛出异常。

---

## 工具函数模块

### `toolFormatter.ts` — 工具参数格式化

位于 `src/utils/toolFormatter.ts`，将工具调用的 input 参数提取为紧凑的显示字符串。

#### `formatToolArgs(toolName, input, projectPath)`

```typescript
export function formatToolArgs(
  toolName: string,
  input: Record<string, unknown>,
  projectPath: string
): ToolFormatResult
```

返回 `{ args: string, filePath: string | null }`。

支持的工具：

| 工具 | 显示格式 | filePath |
|------|---------|----------|
| Read / Write / Edit | 相对文件路径 | 原始路径 |
| Bash | 命令内容（截断 80 字符） | null |
| Glob | 搜索模式 | null |
| Grep | `pattern, path` | null |
| Task | 任务描述（截断 60 字符） | null |
| LSP | `operation, file:line` | 文件路径 |
| AskUserQuestion | 问题内容（截断 80 字符） | null |
| WebSearch | 搜索查询（截断 80 字符） | null |
| WebFetch | URL（截断 80 字符） | null |
| NotebookEdit | 笔记本路径 | 笔记本路径 |
| TodoWrite | `N 项` | null |
| 其他 | 第一个字符串参数或 `...` | null |

### `messageTransform.ts` — 消息转换工具

位于 `src/utils/messageTransform.ts`。

#### `toRelativePath(absolutePath, projectPath)`

将绝对路径简化为相对于项目目录的路径。

```typescript
export function toRelativePath(absolutePath: string, projectPath: string): string
```

### `rehypeHighlight.ts` — 语法高亮插件

位于 `src/utils/rehypeHighlight.ts`，自定义 rehype 插件，支持 190+ 编程语言的语法高亮。基于 highlight.js 库。
