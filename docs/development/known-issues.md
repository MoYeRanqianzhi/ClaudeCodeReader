# 已知问题与限制

本文档记录 ClaudeCodeReader (CCR) 当前版本（0.1.0-beta.4）中已知的功能限制、设计注意事项、平台差异和 UI/UX 局限性。

---

## 功能限制

### 权限管理为只读显示

设置面板中的「权限」标签页（Permissions）仅以只读方式展示 `settings.json` 中 `permissions.allow` 和 `permissions.deny` 的内容，不提供添加、编辑或删除权限规则的交互操作。

**相关代码：** `src/components/SettingsPanel.tsx` 中权限标签页的渲染逻辑使用 `<div>` 静态展示而非 `<input>` 可编辑元素。

### agent 文件被过滤

在获取项目会话列表时，`getProjectSessions()` 函数会跳过所有以 `agent-` 开头的 `.jsonl` 文件。这些文件通常是 Claude Code 的 Agent 子任务会话记录，当前不在 CCR 的显示范围内。

**相关代码：** `src/utils/claudeData.ts` 第 190 行：
```typescript
if (entry.isFile && entry.name?.endsWith('.jsonl') && !entry.name.startsWith('agent-'))
```

### readHistory 函数未被使用

`src/utils/claudeData.ts` 中定义了 `readHistory()` 函数，可以读取 `~/.claude/history.jsonl` 中的命令历史记录。该函数已完整实现，但当前没有任何 UI 组件调用它，历史记录功能尚未暴露给用户。

### AppState 接口未被使用

`src/types/claude.ts` 中定义了 `AppState` 接口，描述了应用的完整状态结构（settings、projects、currentProject、currentSession、messages、theme、claudeDataPath）。但实际的状态管理在 `App.tsx` 中通过多个独立的 `useState` Hook 实现，未使用该统一接口。

**可能的意图：** 该接口可能是为未来引入集中式状态管理（如 Context、Zustand 等）预留的类型定义。

### 消息内容不支持 Markdown 渲染

聊天视图中的消息内容使用 `<pre>` 标签包裹并以纯文本方式显示，不支持 Markdown 语法渲染。Claude 助手的回复中通常包含 Markdown 格式（标题、代码块、列表等），但在 CCR 中只会以原始文本形式展示。

**相关代码：** `src/components/ChatView.tsx` 第 306 行：
```tsx
<pre className="whitespace-pre-wrap break-words text-sm font-sans">
  {getMessageText(msg)}
</pre>
```

---

## 设计注意事项

### readEnvSwitcherConfig 的 _claudePath 参数

`readEnvSwitcherConfig()` 和 `saveEnvSwitcherConfig()` 函数签名中接收 `_claudePath` 参数（以下划线前缀标记为未使用），但实际并不使用该参数。环境配置文件的存储路径已硬编码为 `~/.mo/CCR/env-profiles.json`。

**保留原因：** 该参数是为向前兼容保留的。未来可能需要支持多 Claude 实例或自定义数据路径场景，届时可直接利用此参数而无需变更函数签名。

### 环境变量敏感字段检测

设置面板中对环境变量值的显示/隐藏控制基于 key 名称的模糊匹配：

```typescript
key.toLowerCase().includes('token') || key.toLowerCase().includes('key')
```

**潜在问题：**
- **误判隐藏**：名称包含 `key` 但非敏感的变量（如 `KEYBOARD_LAYOUT`）会被错误地以密码模式显示
- **遗漏暴露**：不包含 `token` 或 `key` 的敏感变量（如 `SECRET`、`PASSWORD`）不会被自动隐藏

### decodeProjectPath 路径编码依赖

`decodeProjectPath()` 函数负责将 Claude Code 的编码项目路径名还原为实际文件系统路径。该函数依赖 Claude Code 使用的特定路径编码规则：

```typescript
// "G--ClaudeProjects-Test" → "G:\ClaudeProjects\Test"
return encodedName
  .replace(/^([A-Za-z])--/, '$1:\\')
  .replace(/--/g, '\\')
  .replace(/-/g, '\\');
```

**风险：** 如果 Claude Code 在未来版本中变更路径编码格式，CCR 将无法正确解码项目路径，导致项目列表显示异常。

### 无自定义 Tauri Command

当前 Rust 层（`src-tauri/src/lib.rs`）未注册任何自定义 Tauri Command（`#[tauri::command]`）。所有文件系统操作（读取设置、读写会话消息、管理环境配置等）均通过前端直接调用 `@tauri-apps/plugin-fs` 插件完成。

**影响：**
- 前端直接操作文件系统，无 Rust 层的数据校验或业务逻辑封装
- 如需添加复杂的原生功能（如文件监听、系统通知等），需要新增 Tauri Command

### CSP 安全策略已禁用

`tauri.conf.json` 中 Content Security Policy 设置为 `null`：

```json
"security": {
  "csp": null
}
```

这意味着前端页面没有 CSP 限制，可以加载任意来源的资源。对于本地桌面应用，风险较低，但不符合安全最佳实践。

---

## 平台差异

### Windows 路径处理

- Windows 文件路径使用反斜杠（`\`）作为分隔符
- `decodeProjectPath()` 的编码/解码逻辑专门针对 Windows 风格路径设计
- 包含盘符的路径编码格式为 `{盘符}--{路径段}`（如 `G--ClaudeProjects`）
- macOS/Linux 路径使用正斜杠（`/`），编码行为可能不同

### macOS 安装需要解压

macOS 版本的二进制文件以 `.app.tar.gz` 格式分发。`postinstall.js` 在 macOS 上执行额外步骤：

1. 下载 `.app.tar.gz` 压缩包
2. 调用系统 `tar` 命令解压为 `ClaudeCodeReader.app` 目录
3. 删除压缩包原文件

已安装检测也因此不同：检查 `ClaudeCodeReader.app` 目录是否存在，而非检查压缩包。

### Linux AppImage 权限

Linux 版本使用 AppImage 格式分发。下载后需要通过 `chmod` 设置可执行权限（`0o755`），否则无法直接运行。`postinstall.js` 会自动完成此步骤。

---

## UI/UX 局限

### 使用浏览器原生对话框

以下交互操作使用浏览器原生 API 而非自定义 UI 组件：

| 操作 | 使用的 API | 局限 |
|------|-----------|------|
| 添加环境变量 | `window.prompt()` | 无法自定义样式、无校验反馈、无法取消后重试 |
| 删除消息确认 | `window.confirm()` | 无法自定义按钮文案和样式，与应用主题不一致 |

### 无撤销/重做功能

消息编辑和删除操作是不可逆的。一旦保存编辑或确认删除，没有撤销（Undo）或重做（Redo）机制来恢复之前的状态。操作直接写入 `.jsonl` 文件。

### 无分页加载

会话消息一次性全量加载到内存中。对于包含大量消息的会话（数千条），可能导致：

- 初始加载时间较长
- 内存占用较高
- 滚动渲染性能下降

**相关代码：** `readSessionMessages()` 读取整个 `.jsonl` 文件并解析所有行，`ChatView` 组件渲染全部 `filteredMessages`。

### 窗口布局

应用窗口有以下尺寸约束（定义在 `tauri.conf.json`）：

| 属性 | 值 |
|------|-----|
| 默认宽度 | 1200px |
| 默认高度 | 800px |
| 最小宽度 | 800px |
| 最小高度 | 600px |
| 可调整大小 | 是 |
| 居中显示 | 是 |

布局采用左右分栏结构（Sidebar + ChatView），在接近最小宽度时内容区域可能显示较为拥挤，不完全适配小屏幕场景。

### 主题持久化未实现

当前主题选择（浅色/深色/跟随系统）仅保存在 React 状态中（`App.tsx` 的 `useState`），不会持久化到本地存储。应用重启后，主题会重置为默认的「跟随系统」模式。
