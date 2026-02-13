# 已知问题与限制

本文档记录 ClaudeCodeReader (CCR) 当前版本中已知的功能限制、设计注意事项、平台差异和 UI/UX 局限性。

---

## 功能限制

### 权限管理为只读显示

设置面板中的「权限」标签页（Permissions）仅以只读方式展示 `settings.json` 中 `permissions.allow` 和 `permissions.deny` 的内容，不提供添加、编辑或删除权限规则的交互操作。

**相关代码：** `src/components/SettingsPanel.tsx` 中权限标签页的渲染逻辑使用 `<div>` 静态展示而非 `<input>` 可编辑元素。

### agent 文件被过滤

在获取项目会话列表时，`getProjectSessions()` 函数会跳过所有以 `agent-` 开头的 `.jsonl` 文件。这些文件通常是 Claude Code 的 Agent 子任务会话记录，当前不在 CCR 的显示范围内。

**相关代码：** `src/utils/claudeData.ts`：
```typescript
if (entry.isFile && entry.name?.endsWith('.jsonl') && !entry.name.startsWith('agent-'))
```

### readHistory 函数未被使用

`src/utils/claudeData.ts` 中定义了 `readHistory()` 函数，可以读取 `~/.claude/history.jsonl` 中的命令历史记录。该函数已完整实现，但当前没有任何 UI 组件调用它，历史记录功能尚未暴露给用户。

### AppState 接口未被使用

`src/types/claude.ts` 中定义了 `AppState` 接口，描述了应用的完整状态结构。但实际的状态管理在 `App.tsx` 中通过多个独立的 `useState` Hook 实现，未使用该统一接口。

---

## 已修复的历史问题

以下问题已在 UI 重构中修复，记录于此供参考：

### [已修复] 侧边栏被长内容撑开

- **原症状**：打开包含长行工具结果的会话时，侧边栏宽度被撑开超过设定值
- **根因**：flex 子项默认 `min-width: auto`，ChatView 的固有最小宽度超过剩余空间
- **修复**：ChatView 根 div 添加 `min-w-0`；Sidebar 设置 `flexShrink: 0, minWidth: 0`

### [已修复] EnvSwitcher 下拉菜单被遮挡

- **原症状**：展开环境配置下拉菜单后，菜单被下方的项目列表条目遮挡
- **根因**：侧边栏头部 `overflow-hidden` 裁剪了 `absolute` 定位的下拉菜单
- **修复**：头部改为 `relative z-10`

### [已修复] 搜索框焦点环残影

- **原症状**：ChatView 搜索框聚焦后失焦，底部残留一条紫色细线
- **根因**：`focus:ring-2` 的 `box-shadow` 在 Chromium WebView 中失焦后未及时重绘
- **修复**：改用 `focus:border-ring`（基于 border-color）

### [已修复] 消息内容不支持结构化渲染

- **原症状**：工具调用、思考过程等内容块以纯文本形式显示
- **修复**：新增 MessageBlockList / MessageContentRenderer 组件，支持 text、tool_use、tool_result、thinking、image 五种内容类型的结构化渲染

---

## 设计注意事项

### Flex 布局 `min-width: auto` 陷阱

**关键知识**：在 flex 行布局中，子项默认 `min-width: auto`，意味着其最小宽度等于内容的固有最小宽度（intrinsic min-content width）。当子项内容包含长行不可换行文本时，flex 算法无法将该子项压缩到比内容更窄，导致布局被撑开。

**项目中的应对**：
- Sidebar：`style={{ flexShrink: 0, minWidth: 0, overflow: 'hidden' }}`
- ChatView 根 div：`className="flex-1 flex flex-col bg-background min-w-0"`
- 内容块 CSS：`.tool-use-block`、`.tool-result-block`、`.thinking-block` 均设置 `overflow: hidden`

### 侧边栏拖动调整宽度的闭包问题

拖动事件使用全局 `document.addEventListener('mousemove', ...)` 监听。由于事件监听器在 `useEffect` 中注册且依赖数组为空，回调闭包中的 state 永远是初始值。

**解决方案**：使用 `useRef`（`isResizingRef`）追踪拖动状态，`setSidebarWidth` 使用函数式更新避免读取陈旧 state。

### motion variant 传播机制

主题切换和设置图标的悬停旋转动画使用 motion/react 的 variant 传播：
- 父元素设置 `whileHover="hover"` 传播 variant 名称
- 子 `motion.div` 设置 `variants={{ hover: { rotate: 180 } }}` 接收状态

这确保鼠标悬停在按钮任意位置（包括文字区域）时都能触发图标旋转，而非仅悬停在图标上。

### readEnvSwitcherConfig 的 _claudePath 参数

`readEnvSwitcherConfig()` 和 `saveEnvSwitcherConfig()` 函数签名中接收 `_claudePath` 参数（以下划线前缀标记为未使用），但实际并不使用该参数。环境配置文件的存储路径已硬编码为 `~/.mo/CCR/env-profiles.json`。

### 环境变量敏感字段检测

设置面板中对环境变量值的显示/隐藏控制基于 key 名称的模糊匹配：

```typescript
key.toLowerCase().includes('token') || key.toLowerCase().includes('key')
```

**潜在问题：**
- **误判隐藏**：名称包含 `key` 但非敏感的变量（如 `KEYBOARD_LAYOUT`）会被错误地以密码模式显示
- **遗漏暴露**：不包含 `token` 或 `key` 的敏感变量（如 `SECRET`、`PASSWORD`）不会被自动隐藏

### decodeProjectPath 路径编码依赖

`decodeProjectPath()` 函数依赖 Claude Code 使用的特定路径编码规则。如果 Claude Code 在未来版本中变更路径编码格式，CCR 将无法正确解码项目路径。

### 无自定义 Tauri Command

当前 Rust 层未注册任何自定义 Tauri Command。所有文件系统操作均通过前端直接调用 `@tauri-apps/plugin-fs` 插件完成。

### CSP 安全策略已禁用

`tauri.conf.json` 中 Content Security Policy 设置为 `null`，前端页面没有 CSP 限制。

---

## 平台差异

### Windows 路径处理

- Windows 文件路径使用反斜杠（`\`）作为分隔符
- `decodeProjectPath()` 的编码/解码逻辑专门针对 Windows 风格路径设计
- macOS/Linux 路径使用正斜杠（`/`），编码行为可能不同

### macOS 安装需要解压

macOS 版本以 `.app.tar.gz` 格式分发，`postinstall.js` 在 macOS 上调用系统 `tar` 命令解压。

### Linux AppImage 权限

Linux 版本使用 AppImage 格式分发，下载后需要 `chmod` 设置可执行权限（`0o755`）。`postinstall.js` 会自动完成此步骤。

---

## UI/UX 局限

### 使用浏览器原生对话框

| 操作 | 使用的 API | 局限 |
|------|-----------|------|
| 添加环境变量 | `window.prompt()` | 无法自定义样式、无校验反馈 |
| 删除环境配置确认 | `window.confirm()` | 无法自定义按钮文案和样式 |

### 无撤销/重做功能

消息编辑和删除操作是不可逆的。操作直接写入 `.jsonl` 文件。

### 无分页加载

会话消息一次性全量加载到内存中。对于包含大量消息的会话，可能影响性能。

### 主题持久化未实现

主题选择仅保存在 React 状态中，不会持久化到本地存储。应用重启后重置为「跟随系统」模式。

### 窗口布局

应用窗口最小宽度 800px / 最小高度 600px。在接近最小宽度时，工具栏按钮可能溢出可视区域（右侧按钮组设置了 `shrink-0` 防止变形，但可能被裁剪）。
