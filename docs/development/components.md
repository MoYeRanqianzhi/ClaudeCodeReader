# 组件文档

本文档详细记录 ClaudeCodeReader (CCR) 前端的 7 个 React 组件，包括每个组件的概述、Props 接口、内部状态、功能特性、关键逻辑和渲染结构。

---

## 目录

1. [App — 根组件](#1-app--根组件)
2. [Sidebar — 侧边栏](#2-sidebar--侧边栏)
3. [ChatView — 聊天视图](#3-chatview--聊天视图)
4. [SettingsPanel — 设置面板](#4-settingspanel--设置面板)
5. [EnvSwitcher — 环境切换器](#5-envswitcher--环境切换器)
6. [MessageBlockList — 消息内容块列表](#6-messageblocklist--消息内容块列表)
7. [MessageContentRenderer — 消息内容块渲染器](#7-messagecontentrenderer--消息内容块渲染器)

---

## 1. App — 根组件

**文件路径：** `src/App.tsx`

### 组件概述

App 是应用的根组件，也是唯一使用默认导出（`export default`）的组件。它承担全局状态管理中枢的角色，定义了 16 个状态变量、1 个 ref、3 个 `useEffect` 副作用和 18 个 `useCallback` 回调函数，协调所有子组件之间的数据流。

### Props 接口

App 是根组件，不接收任何 Props。

### 常量

| 常量名 | 值 | 说明 |
|--------|-----|------|
| `SIDEBAR_COLLAPSE_THRESHOLD` | `160` | 侧边栏自动折叠阈值（px）：拖动宽度低于此值松开后自动折叠 |
| `SIDEBAR_MIN_WIDTH` | `220` | 侧边栏最小宽度（px）：宽度回弹下限 |
| `SIDEBAR_DEFAULT_WIDTH` | `320` | 侧边栏默认宽度（px）：初始宽度，折叠后重新展开时恢复此值 |

### 内部 State（16 个状态变量）

| 变量名 | 类型 | 初始值 | 说明 |
|--------|------|--------|------|
| `claudeDataPath` | `string` | `''` | Claude 数据目录的绝对路径（`~/.claude`），在初始化时获取 |
| `projects` | `Project[]` | `[]` | 从文件系统读取的所有项目列表，每个项目包含其下属会话 |
| `currentProject` | `Project \| null` | `null` | 用户在侧边栏中当前选中的项目 |
| `currentSession` | `Session \| null` | `null` | 用户当前选中的会话，选中后加载对应的消息列表 |
| `messages` | `SessionMessage[]` | `[]` | 当前选中会话的消息列表，从 JSONL 文件解析而来 |
| `settings` | `ClaudeSettings` | `{}` | Claude Code 的设置数据，对应 `settings.json` |
| `envConfig` | `EnvSwitcherConfig` | `{ profiles: [], activeProfileId: null }` | 环境配置切换器的完整状态 |
| `showSettings` | `boolean` | `false` | 控制设置面板模态框的显示/隐藏 |
| `editingEnvProfile` | `EnvProfile \| null` | `null` | 正在编辑的环境配置对象；非 null 时设置面板进入"配置编辑模式" |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | 当前主题模式 |
| `loading` | `boolean` | `true` | 应用初始化加载中标志 |
| `error` | `string \| null` | `null` | 初始化过程中的错误信息 |
| `selectedMessages` | `Set<string>` | `new Set()` | 已选中的消息 UUID 集合（多选模式） |
| `selectionMode` | `boolean` | `false` | 选择模式开关 |
| `sidebarCollapsed` | `boolean` | `false` | 侧边栏折叠状态 |
| `sidebarWidth` | `number` | `320`（`SIDEBAR_DEFAULT_WIDTH`） | 侧边栏宽度（像素），可拖动调整 |
| `isResizingSidebar` | `boolean` | `false` | 是否正在拖动调整侧边栏宽度 |

### Ref

| Ref 名 | 类型 | 说明 |
|--------|------|------|
| `isResizingRef` | `boolean` | 追踪拖动状态，避免全局事件监听器中的闭包陈旧问题 |

### 功能特性

- **应用初始化**：启动时并行加载设置、项目列表和环境配置
- **主题切换**：支持浅色/深色/跟随系统三种模式
- **会话选择与消息加载**：选中会话后从文件系统异步加载消息
- **消息编辑**：调用 `editMessageContent` 修改消息内容并更新状态
- **消息删除**：直接调用 `deleteMessage` 删除消息
- **消息多选**：切换选择模式、全选/取消、批量删除
- **会话删除**：从文件系统删除会话文件，刷新项目列表
- **会话导出**：支持 Markdown 和 JSON 两种格式导出到本地文件
- **设置保存**：将修改后的设置写回 `settings.json`
- **环境配置管理**：切换、保存、编辑、删除环境配置
- **侧边栏拖动调整宽度**：全局鼠标事件监听实现拖动，支持自动折叠和最小宽度回弹
- **侧边栏折叠/展开**：点击按钮或拖动低于阈值自动折叠

### 关键逻辑

#### useEffect #1 — 侧边栏拖动调整

全局 `document.addEventListener('mousemove' / 'mouseup')` 监听，使用 `isResizingRef`（ref）判断拖动状态避免闭包陈旧问题。`mouseup` 时根据最终宽度决定：

- `< SIDEBAR_COLLAPSE_THRESHOLD`（160px）→ 自动折叠，重置宽度为默认值
- `< SIDEBAR_MIN_WIDTH`（220px）→ 回弹到最小宽度

#### useEffect #2 — 主题应用

监听 `theme` 状态变化，在 `document.documentElement` 上切换 `dark` CSS 类。`'system'` 模式通过 `window.matchMedia` 检测系统偏好。

#### useEffect #3 — 应用初始化

组件挂载后执行一次，并行加载三项数据：

```tsx
const [loadedSettings, loadedProjects, loadedEnvConfig] = await Promise.all([
  readSettings(path),
  getProjects(path),
  readEnvSwitcherConfig(path),
]);
```

#### 18 个 useCallback 回调

| 回调函数 | 依赖 | 说明 |
|----------|------|------|
| `handleSidebarResizeStart` | `[]` | 开始拖动，设置标志和全局光标 |
| `handleSelectSession` | `[]` | 选中会话 → 读取消息，清空多选状态 |
| `handleRefresh` | `[currentSession]` | 重新读取当前会话的消息 |
| `handleEditMessage` | `[currentSession]` | 编辑指定 UUID 的消息内容 |
| `handleDeleteMessage` | `[currentSession]` | 删除指定 UUID 的消息 |
| `handleToggleSelect` | `[]` | 切换单条消息的选中状态 |
| `handleSelectAll` | `[]` | 全选传入的所有消息 UUID |
| `handleDeselectAll` | `[]` | 取消所有消息的选中状态 |
| `handleDeleteSelected` | `[currentSession, selectedMessages]` | 批量删除已选消息 |
| `handleToggleSelectionMode` | `[]` | 切换选择模式 |
| `handleDeleteSession` | `[claudeDataPath, currentSession]` | 删除会话文件并刷新项目列表 |
| `handleExport` | `[currentSession, messages]` | 导出会话为 Markdown/JSON |
| `handleSaveSettings` | `[claudeDataPath]` | 保存设置到文件系统 |
| `handleSwitchEnvProfile` | `[claudeDataPath, envConfig]` | 切换到指定环境配置 |
| `handleSaveEnvProfile` | `[claudeDataPath]` | 将当前环境保存为新配置 |
| `handleDeleteEnvProfile` | `[claudeDataPath, envConfig]` | 删除指定环境配置 |
| `handleEditEnvProfile` | `[]` | 设置 editingEnvProfile 并打开设置面板 |
| `handleSaveEditedProfile` | `[claudeDataPath, envConfig]` | 保存编辑后的配置 |

#### SettingsPanel 双模式逻辑

通过 `editingEnvProfile` 是否为 null 来决定设置面板的行为模式：

- **普通模式**（`editingEnvProfile === null`）：显示并编辑全局 settings
- **配置编辑模式**（`editingEnvProfile !== null`）：显示选定配置的 env，保存时仅更新该配置

### 渲染结构

```
App (h-screen w-screen overflow-hidden flex relative)
├── [loading 状态] → 加载动画（渐变旋转器 + 提示文字）
├── [error 状态]   → 错误页面（警告图标 + 错误信息 + 重试按钮）
└── [正常状态]     → flex 水平布局
    ├── AnimatePresence
    │   └── [!sidebarCollapsed] Sidebar (motion.div, 动态宽度)
    ├── 拖动手柄 (absolute, z-20, cursor-col-resize)
    ├── ChatView (flex-1, min-w-0)
    └── AnimatePresence
        └── [showSettings] SettingsPanel (fixed, z-50 模态覆盖层)
```

---

## 2. Sidebar — 侧边栏

**文件路径：** `src/components/Sidebar.tsx`

### 组件概述

Sidebar 是应用的左侧导航组件，使用 `motion.div` 实现可动画化的宽度控制。它提供项目浏览、会话选择、搜索过滤、会话删除和环境配置切换功能。内部嵌入了 `EnvSwitcher` 子组件。侧边栏采用天蓝色到淡紫色的渐变背景，标题使用紫粉渐变流动动画。

### Props 接口（14 个属性）

```tsx
interface SidebarProps {
  projects: Project[];
  currentProject: Project | null;
  currentSession: Session | null;
  envConfig: EnvSwitcherConfig;
  width: number;
  isResizing: boolean;
  onSelectProject: (project: Project) => void;
  onSelectSession: (session: Session) => void;
  onDeleteSession: (sessionFilePath: string) => void;
  onOpenSettings: () => void;
  onSwitchEnvProfile: (profile: EnvProfile) => void;
  onSaveEnvProfile: (name: string) => void;
  onDeleteEnvProfile: (profileId: string) => void;
  onEditEnvProfile: (profile: EnvProfile) => void;
  onCollapse: () => void;
}
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `projects` | `Project[]` | 所有项目列表数据 |
| `currentProject` | `Project \| null` | 当前选中的项目，用于高亮显示 |
| `currentSession` | `Session \| null` | 当前选中的会话，用于高亮显示 |
| `envConfig` | `EnvSwitcherConfig` | 环境配置数据，传递给 EnvSwitcher 子组件 |
| `width` | `number` | 侧边栏宽度（px），由父组件管理 |
| `isResizing` | `boolean` | 是否正在拖动调整宽度，为 true 时禁用过渡动画 |
| `onSelectProject` | `(project: Project) => void` | 点击项目时的回调 |
| `onSelectSession` | `(session: Session) => void` | 点击会话时的回调 |
| `onDeleteSession` | `(sessionFilePath: string) => void` | 删除会话的回调 |
| `onOpenSettings` | `() => void` | 点击设置按钮的回调 |
| `onSwitchEnvProfile` | `(profile: EnvProfile) => void` | 切换环境配置的回调 |
| `onSaveEnvProfile` | `(name: string) => void` | 保存当前环境为新配置的回调 |
| `onDeleteEnvProfile` | `(profileId: string) => void` | 删除环境配置的回调 |
| `onEditEnvProfile` | `(profile: EnvProfile) => void` | 编辑环境配置的回调 |
| `onCollapse` | `() => void` | 折叠侧边栏的回调 |

### 内部 State

| 变量名 | 类型 | 初始值 | 说明 |
|--------|------|--------|------|
| `searchTerm` | `string` | `''` | 搜索输入框的当前值 |
| `expandedProjects` | `Set<string>` | `new Set()` | 已展开项目的路径集合 |

### 功能特性

- **搜索过滤**：支持按项目路径和会话 ID 进行模糊搜索（大小写不敏感）
- **项目展开/折叠**：点击项目头部切换展开状态，使用 `Set` 管理多个项目的展开状态，展开/折叠带有高度+透明度过渡动画
- **会话列表交错动画**：展开项目时会话条目使用 staggered animation（`delay: sessionIndex * 0.03`）逐一入场
- **会话删除**：每个会话条目悬停时显示删除按钮（`opacity-0 → group-hover:opacity-100`）
- **会话数量徽章**：每个项目右侧显示会话数量
- **项目路径显示**：主文字显示路径最后一段（项目名），副文字显示完整路径
- **选中高亮**：当前选中的项目和会话添加 `bg-accent` 背景色，选中会话加左侧 `border-primary` 标记
- **底部统计**：显示总项目数和总会话数
- **环境切换器嵌入**：在头部区域嵌入 EnvSwitcher 组件
- **设置齿轮旋转**：设置按钮悬停时齿轮图标旋转 180°（spring 动画），使用 variant 传播机制
- **渐变背景与标题**：`sidebar-gradient` 渐变背景，`gradient-text animate-gradient` 流动标题

### 关键逻辑

#### 搜索过滤

```tsx
const filteredProjects = projects.filter(
  (p) =>
    p.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sessions.some((s) => s.id.toLowerCase().includes(searchTerm.toLowerCase()))
);
```

#### 设置图标旋转动画（variant 传播）

```tsx
<motion.button whileHover="hover" whileTap={{ scale: 0.95 }}>
  <motion.div
    variants={{ hover: { rotate: 180 } }}
    transition={{ type: "spring", stiffness: 300, damping: 15 }}
  >
    <Settings className="w-5 h-5" />
  </motion.div>
</motion.button>
```

父元素 `whileHover="hover"` 将 variant 名称传播给子 `motion.div`，确保鼠标在按钮任意区域悬停都能触发图标旋转。

#### 宽度约束

```tsx
<motion.div
  animate={{ width, opacity: 1 }}
  transition={isResizing ? { duration: 0 } : { duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
  style={{ flexShrink: 0, minWidth: 0, overflow: 'hidden' }}
>
```

- `minWidth: 0` 覆盖 flex 子项默认的 `min-width: auto`
- `flexShrink: 0` 防止被 flex 容器压缩
- `overflow: 'hidden'` 用于展开/收起动画时裁剪过渡帧
- 拖动时 `transition.duration: 0` 禁用动画，确保实时跟手

### 渲染结构

```
Sidebar (motion.div, 动态 width, sidebar-gradient, border-r)
├── 头部区域 (border-b, relative z-10)
│   ├── 标题行
│   │   ├── "Claude Code Reader" (gradient-text animate-gradient)
│   │   ├── 设置按钮 (motion.button + 齿轮旋转 motion.div)
│   │   └── 折叠按钮 (motion.button + ChevronLeft)
│   ├── EnvSwitcher 组件
│   └── 搜索输入框 (Search 图标 + input)
├── 项目列表区域 (flex-1, overflow-y/x-auto, custom-scrollbar)
│   ├── [空状态提示]
│   └── 项目条目（循环渲染）
│       ├── 项目头 (motion.button + 旋转箭头 + 项目名 + 路径 + 会话数徽章)
│       └── AnimatePresence > [展开时] motion.div (height auto 动画)
│           └── 会话条目 (motion.div, staggered animation)
│               ├── 会话名/ID + 时间戳
│               └── 删除按钮 (motion.button, group-hover 显示)
└── 底部信息栏 (border-t, whitespace-nowrap)
    └── "共 X 个项目，Y 个会话"
```

---

## 3. ChatView — 聊天视图

**文件路径：** `src/components/ChatView.tsx`

### 组件概述

ChatView 是应用的主内容区域，占据侧边栏右侧的全部剩余空间（`flex-1 min-w-0`）。它负责展示当前会话的消息列表，支持消息搜索、角色过滤、编辑、删除、复制、多选批量操作、导出和 Token 统计。消息内容通过 `MessageBlockList` 组件实现结构化渲染。

### Props 接口（15 个属性）

```tsx
interface ChatViewProps {
  session: Session | null;
  messages: SessionMessage[];
  onEditMessage: (uuid: string, newContent: string) => void;
  onDeleteMessage: (uuid: string) => void;
  onRefresh: () => void;
  onExport: (format: 'markdown' | 'json') => void;
  selectionMode: boolean;
  selectedMessages: Set<string>;
  onToggleSelect: (uuid: string) => void;
  onSelectAll: (uuids: string[]) => void;
  onDeselectAll: () => void;
  onDeleteSelected: () => void;
  onToggleSelectionMode: () => void;
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
}
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `session` | `Session \| null` | 当前选中的会话对象；为 null 时显示空状态占位 |
| `messages` | `SessionMessage[]` | 当前会话的完整消息列表 |
| `onEditMessage` | `(uuid, newContent) => void` | 编辑消息完成后的回调 |
| `onDeleteMessage` | `(uuid) => void` | 删除消息的回调 |
| `onRefresh` | `() => void` | 刷新当前会话消息的回调 |
| `onExport` | `(format) => void` | 导出会话的回调 |
| `selectionMode` | `boolean` | 多选模式开关 |
| `selectedMessages` | `Set<string>` | 已选中的消息 UUID 集合 |
| `onToggleSelect` | `(uuid) => void` | 切换单条消息选中状态 |
| `onSelectAll` | `(uuids) => void` | 全选可见消息 |
| `onDeselectAll` | `() => void` | 取消全选 |
| `onDeleteSelected` | `() => void` | 批量删除已选消息 |
| `onToggleSelectionMode` | `() => void` | 切换选择模式 |
| `sidebarCollapsed` | `boolean` | 侧边栏是否折叠 |
| `onExpandSidebar` | `() => void` | 展开侧边栏的回调 |

### 内部 State

| 变量名 | 类型 | 初始值 | 说明 |
|--------|------|--------|------|
| `editingId` | `string \| null` | `null` | 正在编辑的消息 UUID |
| `editContent` | `string` | `''` | 编辑输入框的当前文本 |
| `filter` | `'all' \| 'user' \| 'assistant'` | `'all'` | 消息过滤器 |
| `searchQuery` | `string` | `''` | 搜索关键词 |
| `showFilterDropdown` | `boolean` | `false` | 过滤器下拉菜单的显示状态 |
| `showExportDropdown` | `boolean` | `false` | 导出下拉菜单的显示状态 |

### Ref

| Ref 名 | 类型 | 说明 |
|--------|------|------|
| `messagesEndRef` | `HTMLDivElement` | 消息列表底部锚点，用于滚动到底部 |
| `isInitialLoadRef` | `boolean` | 首次加载标记：首次用 `instant`，后续用 `smooth` 滚动 |
| `filterRef` | `HTMLDivElement` | 过滤器下拉菜单容器，用于外部点击检测 |
| `exportRef` | `HTMLDivElement` | 导出下拉菜单容器，用于外部点击检测 |

### useMemo

| 变量名 | 依赖 | 说明 |
|--------|------|------|
| `tokenStats` | `[messages]` | 计算整个会话的 Token 使用量汇总（inputTokens、outputTokens、cacheReadTokens、cacheCreationTokens） |

### 功能特性

- **消息搜索**：工具栏搜索框，按消息文本模糊匹配（大小写不敏感）
- **消息过滤**：自定义下拉菜单按角色筛选（全部/仅用户/仅助手），替代原生 `<select>`，带动画和图标
- **消息编辑**：点击编辑按钮后消息内容区域变为可调整大小的 `<textarea>`
- **消息删除**：单条删除
- **消息复制**：使用 `navigator.clipboard.writeText()` API
- **多选模式**：复选框选择、全选/取消全选、批量删除
- **会话导出**：下拉菜单支持 Markdown 和 JSON 两种格式
- **自动滚动**：消息列表更新时自动滚动到底部，首次加载使用瞬间跳转，后续使用平滑滚动
- **Token 统计汇总**：工具栏显示整个会话的输入/输出/缓存 Token 总计
- **结构化消息渲染**：通过 `MessageBlockList` 组件渲染 text、tool_use、tool_result、thinking、image 五种内容类型
- **空状态动画**：未选择会话时显示呼吸+摇摆动画的聊天气泡图标+渐变文字
- **侧边栏展开按钮**：侧边栏折叠时在顶部显示展开按钮

### 关键逻辑

#### 消息过滤与搜索

```tsx
const filteredMessages = messages.filter((msg) => {
  if (msg.type !== 'user' && msg.type !== 'assistant') return false;
  if (filter !== 'all' && msg.type !== filter) return false;
  if (searchQuery.trim()) {
    const text = getMessageText(msg).toLowerCase();
    return text.includes(searchQuery.trim().toLowerCase());
  }
  return true;
});
```

第一步排除所有非对话消息，第二步按角色过滤，第三步按搜索关键词匹配。

#### 搜索框焦点样式

使用 `focus:border-ring` 替代 `focus:ring-2 focus:ring-ring`，避免 Chromium WebView 中 `box-shadow` 失焦后残留紫色细线的渲染问题。

#### 首次加载滚动优化

```tsx
const scrollToBottom = (instant = false) => {
  messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
};
```

首次加载会话使用 `instant` 避免从顶部滑到底部的动画，后续更新使用 `smooth`。

### 渲染结构

```
ChatView (flex-1, flex-col, bg-background, min-w-0)
├── [session === null] → 空状态占位
│   ├── [sidebarCollapsed] → 展开侧边栏按钮
│   └── 动画引导（呼吸摇摆聊天气泡 + 渐变文字）
└── [session !== null]
    ├── 头部工具栏 (border-b, bg-card, flex)
    │   ├── 左侧
    │   │   ├── [sidebarCollapsed] 展开按钮
    │   │   └── 会话标题 + 时间戳 + 消息计数 + Token 统计
    │   └── 右侧 (shrink-0)
    │       ├── 搜索输入框 (Search 图标 + input + 清除按钮)
    │       ├── 选择模式切换按钮 (CheckSquare)
    │       ├── AnimatePresence [selectionMode]
    │       │   ├── 全选按钮
    │       │   ├── 取消按钮
    │       │   └── 批量删除按钮 (显示已选数量)
    │       ├── 过滤器下拉菜单 (Filter 图标 + AnimatePresence 弹出)
    │       ├── 导出下拉菜单 (Download 图标 + Markdown/JSON 选项)
    │       ├── 刷新按钮 (RefreshCw, 悬停旋转 180°)
    │       └── 滚动到底部按钮 (ArrowDown)
    └── 消息列表 (flex-1, overflow-y-auto, overflow-x-hidden)
        ├── [空列表] → "没有消息"
        └── 消息卡片 (motion.div, 淡入+上移动画, 循环渲染)
            ├── 消息头部 (group)
            │   ├── [selectionMode] 复选框 (CheckSquare/Square)
            │   ├── 角色徽章 (User/Bot 图标 + 文字)
            │   ├── 时间戳 + 模型名
            │   └── [!selectionMode] 操作按钮 (group-hover 显示)
            │       ├── 复制 (Copy)
            │       ├── 编辑 (Edit2)
            │       └── 删除 (Trash2)
            ├── 消息内容
            │   ├── [编辑模式] → textarea + 取消/保存按钮
            │   └── [阅读模式] → MessageBlockList (结构化渲染)
            └── [有 usage] → Token 使用量
```

---

## 4. SettingsPanel — 设置面板

**文件路径：** `src/components/SettingsPanel.tsx`

### 组件概述

SettingsPanel 是一个模态对话框组件，通过全屏半透明覆盖层+背景模糊效果显示在页面上方。它包含四个标签页（常规、环境变量、权限、关于），并支持两种工作模式。面板使用固定高度 `h-[80vh]`，内容区垂直滚动。使用 motion/react 实现面板入场/退场动画和标签页切换动画。

### Props 接口

```tsx
interface SettingsPanelProps {
  settings: ClaudeSettings;
  claudeDataPath: string;
  theme: 'light' | 'dark' | 'system';
  editingProfile?: EnvProfile | null;
  onSaveSettings: (settings: ClaudeSettings) => void;
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
  onClose: () => void;
}
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `settings` | `ClaudeSettings` | 当前设置数据。配置编辑模式下 env 部分被替换 |
| `claudeDataPath` | `string` | Claude 数据目录路径，只读显示 |
| `theme` | `'light' \| 'dark' \| 'system'` | 当前主题模式 |
| `editingProfile` | `EnvProfile \| null \| undefined` | 正在编辑的环境配置对象 |
| `onSaveSettings` | `(settings: ClaudeSettings) => void` | 保存设置的回调 |
| `onThemeChange` | `(theme) => void` | 主题变更回调 |
| `onClose` | `() => void` | 关闭面板回调 |

### 内部 State

| 变量名 | 类型 | 初始值 | 说明 |
|--------|------|--------|------|
| `editedSettings` | `ClaudeSettings` | `settings`（props） | 面板内部的设置编辑副本 |
| `activeTab` | `'general' \| 'env' \| 'permissions' \| 'about'` | `editingProfile ? 'env' : 'general'` | 当前激活的标签页 |
| `hasChanges` | `boolean` | `false` | 是否有未保存的修改 |
| `showApiKey` | `boolean` | `false` | 是否明文显示敏感环境变量值 |

### 功能特性

- **四个标签页**：常规 / 环境变量 / 权限 / 关于，使用 lucide-react 图标（Palette、Bot、Shield、Info）
- **标签页滑动指示条**：活动标签下方的紫色指示条使用 `layoutId="activeTab"` 实现跨标签滑动动画
- **标签页切换动画**：`AnimatePresence mode="wait"` 实现左滑/右滑过渡
- **三模式主题切换**：分段控制按钮（Sun / SunMoon / Moon），`layoutId="themeSwitch"` 实现滑动指示器动画
- **主题图标悬停旋转**：使用 variant 传播机制，悬停时图标旋转 180°（spring 动画）
- **面板入场/退场动画**：缩放+位移+透明度动画，背景模糊效果
- **双工作模式**：普通设置模式 / 配置编辑模式
- **环境变量管理**：添加（`window.prompt()`）、修改、删除环境变量
- **敏感信息遮罩**：自动检测变量名中包含 `token` 或 `key` 的条目，使用 `password` 输入框
- **权限查看**：只读显示 `allow` 和 `deny` 权限列表
- **变更检测**：只有实际修改后"保存更改"按钮才可用

### 渲染结构

```
SettingsPanel (motion.div, fixed 全屏覆盖层, z-50, backdrop-blur-sm)
├── 半透明背景 (bg-black/50)
└── 模态对话框 (motion.div, bg-card, w-[600px], h-[80vh], overflow-hidden)
    ├── 头部 (border-b)
    │   ├── 标题（"设置"或"编辑配置: {name}"）
    │   └── 关闭按钮 (X 图标, motion.button)
    ├── 标签页导航 (border-b, relative)
    │   └── 4 个标签按钮 (motion.button + 图标)
    │       └── [activeTab] 滑动指示条 (motion.div, layoutId="activeTab")
    ├── 内容区域 (flex-1, overflow-y-auto, custom-scrollbar)
    │   └── AnimatePresence mode="wait"
    │       ├── [general] 常规设置 (motion.div, 左滑入场)
    │       │   ├── 主题三模式分段控制 (layoutId="themeSwitch" 滑动指示器)
    │       │   ├── 默认模型输入框
    │       │   └── 数据路径（只读）
    │       ├── [env] 环境变量 (motion.div)
    │       │   ├── 说明 + 添加按钮 (Plus)
    │       │   └── 变量列表
    │       │       └── 单项：标签 + 输入框 + [敏感] Eye/EyeOff + 删除 Trash2
    │       ├── [permissions] 权限（只读）(motion.div)
    │       │   ├── 允许列表
    │       │   └── 拒绝列表
    │       └── [about] 关于 (motion.div)
    │           ├── 版本 (v1.2.0-beta.1)
    │           ├── 开发者
    │           ├── GitHub 链接 (Github 图标)
    │           └── 简介
    └── 底部操作栏 (border-t)
        ├── 取消按钮 (motion.button)
        └── 保存更改按钮 (motion.button, hasChanges 控制可用状态)
```

---

## 5. EnvSwitcher — 环境切换器

**文件路径：** `src/components/EnvSwitcher.tsx`

### 组件概述

EnvSwitcher 是一个嵌入在 Sidebar 头部的下拉菜单组件，用于在多个环境配置之间快速切换。使用 motion/react 实现下拉菜单的进入/退出动画。下拉菜单宽度 `w-full` 与触发按钮保持一致。

### Props 接口

```tsx
interface EnvSwitcherProps {
  config: EnvSwitcherConfig;
  onSwitchProfile: (profile: EnvProfile) => void;
  onSaveCurrentAsProfile: (name: string) => void;
  onDeleteProfile: (profileId: string) => void;
  onEditProfile: (profile: EnvProfile) => void;
}
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `config` | `EnvSwitcherConfig` | 完整的环境配置数据 |
| `onSwitchProfile` | `(profile: EnvProfile) => void` | 切换环境的回调 |
| `onSaveCurrentAsProfile` | `(name: string) => void` | 保存当前环境为新配置的回调 |
| `onDeleteProfile` | `(profileId: string) => void` | 删除配置的回调 |
| `onEditProfile` | `(profile: EnvProfile) => void` | 编辑配置的回调 |

### 内部 State

| 变量名 | 类型 | 初始值 | 说明 |
|--------|------|--------|------|
| `showDropdown` | `boolean` | `false` | 下拉菜单的显示/隐藏 |
| `showSaveDialog` | `boolean` | `false` | "保存当前配置"内联表单的显示/隐藏 |
| `newProfileName` | `string` | `''` | 新配置名称输入框的当前值 |

### Ref

| Ref 名 | 类型 | 说明 |
|--------|------|------|
| `dropdownRef` | `HTMLDivElement` | 下拉菜单容器引用，用于外部点击检测 |

### 功能特性

- **当前配置显示**：按钮显示当前激活配置名称，无激活时显示"默认配置"
- **下拉箭头旋转**：随展开/收起状态平滑旋转 180°（motion.div animate）
- **下拉菜单动画**：AnimatePresence + motion.div 实现 opacity/y/scale 入场/退场
- **点击外部关闭**：`useEffect` 全局 `mousedown` 监听
- **配置选择**：点击条目立即切换并关闭下拉菜单
- **激活标识**：当前激活配置显示 Check 对勾图标
- **变量计数**：每个配置下方显示"N 个变量"
- **编辑/删除操作**：悬停显示操作按钮（Edit2 / Trash2），使用 `e.stopPropagation()` 防止冒泡
- **删除确认**：使用 `confirm()` 原生对话框
- **保存当前配置**：内联输入框，支持 `Enter` 确认、`Escape` 取消

### 渲染结构

```
EnvSwitcher (relative 定位容器)
├── 触发器按钮 (motion.button, w-full)
│   ├── Terminal 图标
│   ├── 配置名称 (truncate)
│   └── ChevronDown (motion.div 旋转)
└── AnimatePresence > [showDropdown] 下拉菜单 (motion.div, absolute, w-full, z-50)
    ├── 标题 ("环境配置")
    ├── 配置列表 (max-h-60, overflow-y-auto)
    │   ├── [空列表] → "暂无保存的配置"
    │   └── 配置条目（循环渲染）
    │       ├── 左侧：[激活时] Check + 配置名 + 变量计数
    │       └── 右侧：[group-hover] Edit2 + Trash2
    └── 底部操作区 (border-t)
        ├── [!showSaveDialog] "保存当前配置"按钮 (Plus)
        └── [showSaveDialog] 输入框 + Plus 确认 + X 取消
```

---

## 6. MessageBlockList — 消息内容块列表

**文件路径：** `src/components/MessageBlockList.tsx`

### 组件概述

MessageBlockList 是消息内容渲染的入口组件，负责将 `SessionMessage` 的 `content` 字段转换为可视化的内容块列表。根据 content 的数据格式（字符串 vs 数组）选择不同的渲染策略，替代原有的 `getMessageText()` + `<pre>` 方案。

### Props 接口

```tsx
interface MessageBlockListProps {
  message: SessionMessage;
}
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `message` | `SessionMessage` | 要渲染内容的会话消息对象 |

### 渲染逻辑

| 情况 | 渲染方式 |
|------|---------|
| `message.message` 不存在 | `[无消息内容]` 提示 |
| `content` 为 `string` | `<pre>` 预格式化文本（`whitespace-pre-wrap break-words`） |
| `content` 为 `MessageContent[]` | 遍历数组，每个元素渲染一个 `MessageContentRenderer` |
| 未知格式 | `[未知内容格式]` 提示 |

### 渲染结构

```
MessageBlockList
├── [无 message] → "[无消息内容]" (italic, muted)
├── [string content] → <pre> 预格式化文本
├── [array content] → <div className="space-y-3">
│   └── MessageContentRenderer × N (key=index)
└── [其他] → "[未知内容格式]" (italic, muted)
```

---

## 7. MessageContentRenderer — 消息内容块渲染器

**文件路径：** `src/components/MessageContentRenderer.tsx`

### 组件概述

MessageContentRenderer 负责根据 `MessageContent` 的 `type` 字段分类渲染不同类型的内容块。每种类型使用独立的视觉样式（颜色、边框、图标）便于区分。使用 motion/react 为各内容块添加进入动画，使用 lucide-react 图标（Wrench、CheckCircle2、XCircle、Lightbulb）替代 emoji。

### Props 接口

```tsx
interface MessageContentRendererProps {
  block: MessageContent;
}
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `block` | `MessageContent` | 要渲染的单个消息内容块 |

### 渲染逻辑（按 type 分类）

| type | 视觉样式 | 动画 | 说明 |
|------|---------|------|------|
| `text` | `<pre>` 预格式化文本，font-sans | 淡入 + 上移 | 保留空白符并自动换行 |
| `tool_use` | 蓝色左边框可折叠面板（`<details>`），`tool-use-block` CSS 类 | 缩放淡入 | 显示 Wrench 图标 + 工具名称 + JSON 参数 |
| `tool_result` | 绿色左边框（错误时红色），`tool-result-block` CSS 类 | 左滑淡入 | CheckCircle2/XCircle 图标，支持嵌套内容递归渲染 |
| `thinking` | 紫色虚线左边框可折叠面板，`thinking-block` CSS 类 | 缩放淡入 | Lightbulb 图标，默认折叠，斜体淡色显示 |
| `image` | 圆角阴影内联图片 | 缩放淡入 | Base64 data URI，`loading="lazy"` |
| 未知类型 | `<pre>` 提示文字 | 无 | 显示 `[type] 不支持的内容类型` |

### 递归渲染

`tool_result` 类型的 `content` 字段可以是嵌套的 `MessageContent[]` 数组，此时会递归调用 `MessageContentRenderer` 渲染每个嵌套块。

### CSS 类说明

以下 CSS 类定义在 `src/index.css` 中，每个类均设置了 `overflow: hidden` 防止内容撑开容器：

- `.tool-use-block`：蓝色左边框，浅蓝色背景
- `.tool-result-block`：绿色左边框，浅绿色背景
- `.tool-result-error`：红色左边框，浅红色背景
- `.thinking-block`：紫色虚线左边框
- `.content-block`：通用内容块基础样式（padding、圆角）
- `.code-block`：代码展示块样式

---

## 组件依赖关系总览

```
App (根组件)
├── Sidebar
│   └── EnvSwitcher
├── ChatView
│   └── MessageBlockList
│       └── MessageContentRenderer (可递归)
└── SettingsPanel (条件渲染)
```

### 数据流向

```
App (16 个状态变量, 18 个 useCallback)
├── Sidebar         ← projects, currentProject, currentSession, envConfig,
│                     width, isResizing + 9 个回调
├── ChatView        ← session, messages, selectionMode, selectedMessages,
│                     sidebarCollapsed + 10 个回调
└── SettingsPanel   ← settings, claudeDataPath, theme, editingProfile + 3 个回调
```

所有组件均为函数组件，业务数据和持久化逻辑完全由 App 组件通过 Props 和回调函数控制。子组件仅包含 UI 相关的本地状态（如搜索词、展开状态、编辑模式、下拉菜单可见性等）。
