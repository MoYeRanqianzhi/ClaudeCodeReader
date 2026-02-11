# 组件文档

本文档详细记录 ClaudeCodeReader (CCR) 前端的 5 个 React 组件，包括每个组件的概述、Props 接口、内部状态、功能特性、关键逻辑和渲染结构。

---

## 目录

1. [App — 根组件](#1-app--根组件)
2. [Sidebar — 侧边栏](#2-sidebar--侧边栏)
3. [ChatView — 聊天视图](#3-chatview--聊天视图)
4. [SettingsPanel — 设置面板](#4-settingspanel--设置面板)
5. [EnvSwitcher — 环境切换器](#5-envswitcher--环境切换器)

---

## 1. App — 根组件

**文件路径：** `src/App.tsx`

### 组件概述

App 是应用的根组件，也是唯一使用默认导出（`export default`）的组件。它承担全局状态管理中枢的角色，定义了 11 个状态变量、2 个 `useEffect` 副作用和 10 个 `useCallback` 回调函数，协调所有子组件之间的数据流。

### Props 接口

App 是根组件，不接收任何 Props。

### 内部 State（11 个状态变量）

| 变量名 | 类型 | 初始值 | 说明 |
|--------|------|--------|------|
| `claudeDataPath` | `string` | `''` | Claude 数据目录的绝对路径（`~/.claude`），在初始化时获取 |
| `projects` | `Project[]` | `[]` | 从文件系统读取的所有项目列表，每个项目包含其下属会话 |
| `currentProject` | `Project \| null` | `null` | 用户在侧边栏中当前选中的项目 |
| `currentSession` | `Session \| null` | `null` | 用户当前选中的会话，选中后加载对应的消息列表 |
| `messages` | `SessionMessage[]` | `[]` | 当前选中会话的消息列表，从 JSONL 文件解析而来 |
| `settings` | `ClaudeSettings` | `{}` | Claude Code 的设置数据，对应 `settings.json` |
| `envConfig` | `EnvSwitcherConfig` | `{ profiles: [], activeProfileId: null }` | 环境配置切换器的完整状态，包括所有配置和当前激活的配置 ID |
| `showSettings` | `boolean` | `false` | 控制设置面板模态框的显示/隐藏 |
| `editingEnvProfile` | `EnvProfile \| null` | `null` | 正在编辑的环境配置对象；非 null 时，设置面板切换为"配置编辑模式" |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | 当前主题模式，影响全局 CSS 类 |
| `loading` | `boolean` | `true` | 应用初始化加载中标志 |
| `error` | `string \| null` | `null` | 初始化过程中的错误信息，非 null 时显示错误页面 |

### 功能特性

- **应用初始化**：启动时并行加载设置、项目列表和环境配置
- **主题切换**：支持浅色/深色/跟随系统三种模式
- **会话选择与消息加载**：选中会话后从文件系统异步加载消息
- **消息编辑**：调用 `editMessageContent` 修改消息内容并更新状态
- **消息删除**：弹出确认对话框后调用 `deleteMessage` 删除消息
- **设置保存**：将修改后的设置写回 `settings.json`
- **环境配置切换**：应用指定的环境配置到 settings 并持久化
- **环境配置保存**：将当前环境变量快照保存为新配置
- **环境配置编辑**：打开设置面板并预填充选定配置的环境变量
- **环境配置删除**：从配置列表中移除指定配置

### 关键逻辑

#### useEffect #1 — 主题应用

监听 `theme` 状态变化，在 `document.documentElement` 上切换 `dark` CSS 类：

```tsx
useEffect(() => {
  const root = document.documentElement;
  if (theme === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', isDark);
  } else {
    root.classList.toggle('dark', theme === 'dark');
  }
}, [theme]);
```

#### useEffect #2 — 应用初始化

组件挂载后执行一次（空依赖数组），并行加载三项数据：

```tsx
const [loadedSettings, loadedProjects, loadedEnvConfig] = await Promise.all([
  readSettings(path),
  getProjects(path),
  readEnvSwitcherConfig(path),
]);
```

#### 10 个 useCallback 回调

| 回调函数 | 依赖 | 说明 |
|----------|------|------|
| `handleSelectSession` | `[]` | 选中会话 → 读取消息 → 更新 messages |
| `handleRefresh` | `[currentSession]` | 重新读取当前会话的消息 |
| `handleEditMessage` | `[currentSession]` | 编辑指定 UUID 的消息内容 |
| `handleDeleteMessage` | `[currentSession]` | 确认后删除指定 UUID 的消息 |
| `handleSaveSettings` | `[claudeDataPath]` | 保存设置到文件系统 |
| `handleSwitchEnvProfile` | `[claudeDataPath, envConfig]` | 切换到指定环境配置 |
| `handleSaveEnvProfile` | `[claudeDataPath]` | 将当前环境保存为新配置 |
| `handleDeleteEnvProfile` | `[claudeDataPath, envConfig]` | 删除指定环境配置 |
| `handleEditEnvProfile` | `[]` | 设置 editingEnvProfile 并打开设置面板 |
| `handleSaveEditedProfile` | `[claudeDataPath, envConfig]` | 保存编辑后的配置，并在激活时同步更新 settings |

#### SettingsPanel 双模式逻辑

通过 `editingEnvProfile` 是否为 null 来决定设置面板的行为模式：

```tsx
<SettingsPanel
  settings={editingEnvProfile ? { ...settings, env: editingEnvProfile.env } : settings}
  onSaveSettings={editingEnvProfile ?
    (newSettings) => handleSaveEditedProfile({ ...editingEnvProfile, env: newSettings.env || {} })
    : handleSaveSettings
  }
/>
```

- **普通模式**（`editingEnvProfile === null`）：显示并编辑全局 settings
- **配置编辑模式**（`editingEnvProfile !== null`）：显示选定配置的 env，保存时仅更新该配置

### 渲染结构

```
App
├── [loading 状态] → 加载动画（旋转圆圈 + 提示文字）
├── [error 状态]   → 错误页面（警告图标 + 错误信息 + 重试按钮）
└── [正常状态]     → flex 水平布局
    ├── Sidebar         → 左侧固定宽度（18rem / w-72）
    ├── ChatView        → 右侧弹性区域（flex-1）
    └── SettingsPanel   → 全屏模态覆盖层（条件渲染，仅 showSettings 时显示）
```

---

## 2. Sidebar — 侧边栏

**文件路径：** `src/components/Sidebar.tsx`

### 组件概述

Sidebar 是应用的左侧导航组件，宽度固定为 `w-72`（18rem）。它提供项目浏览、会话选择、搜索过滤和环境配置切换功能。内部嵌入了 `EnvSwitcher` 子组件。

### Props 接口

```tsx
interface SidebarProps {
  projects: Project[];
  currentProject: Project | null;
  currentSession: Session | null;
  envConfig: EnvSwitcherConfig;
  onSelectProject: (project: Project) => void;
  onSelectSession: (session: Session) => void;
  onOpenSettings: () => void;
  onSwitchEnvProfile: (profile: EnvProfile) => void;
  onSaveEnvProfile: (name: string) => void;
  onDeleteEnvProfile: (profileId: string) => void;
  onEditEnvProfile: (profile: EnvProfile) => void;
}
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `projects` | `Project[]` | 所有项目列表数据 |
| `currentProject` | `Project \| null` | 当前选中的项目，用于高亮显示 |
| `currentSession` | `Session \| null` | 当前选中的会话，用于高亮显示 |
| `envConfig` | `EnvSwitcherConfig` | 环境配置数据，传递给 EnvSwitcher 子组件 |
| `onSelectProject` | `(project: Project) => void` | 点击项目时的回调，更新 currentProject |
| `onSelectSession` | `(session: Session) => void` | 点击会话时的回调，触发消息加载 |
| `onOpenSettings` | `() => void` | 点击设置按钮的回调 |
| `onSwitchEnvProfile` | `(profile: EnvProfile) => void` | 切换环境配置的回调，透传给 EnvSwitcher |
| `onSaveEnvProfile` | `(name: string) => void` | 保存当前环境为新配置的回调，透传给 EnvSwitcher |
| `onDeleteEnvProfile` | `(profileId: string) => void` | 删除环境配置的回调，透传给 EnvSwitcher |
| `onEditEnvProfile` | `(profile: EnvProfile) => void` | 编辑环境配置的回调，透传给 EnvSwitcher |

### 内部 State

| 变量名 | 类型 | 初始值 | 说明 |
|--------|------|--------|------|
| `searchTerm` | `string` | `''` | 搜索输入框的当前值 |
| `expandedProjects` | `Set<string>` | `new Set()` | 已展开项目的路径集合 |

### 功能特性

- **搜索过滤**：支持按项目路径和会话 ID 进行模糊搜索（大小写不敏感）
- **项目展开/折叠**：点击项目头部切换展开状态，使用 `Set` 管理多个项目的展开状态
- **会话数量徽章**：每个项目右侧显示会话数量
- **项目路径显示**：主文字显示路径最后一段（项目名），副文字显示完整路径
- **选中高亮**：当前选中的项目和会话添加 `bg-accent` 背景色
- **底部统计**：显示总项目数和总会话数
- **环境切换器嵌入**：在头部区域嵌入 EnvSwitcher 组件

### 关键逻辑

#### 搜索过滤

```tsx
const filteredProjects = projects.filter(
  (p) =>
    p.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sessions.some((s) => s.id.toLowerCase().includes(searchTerm.toLowerCase()))
);
```

同时匹配项目路径和项目下的会话 ID，只要有任一匹配则保留整个项目。

#### 展开/折叠切换

```tsx
const toggleProject = (projectPath: string) => {
  const newExpanded = new Set(expandedProjects);
  if (newExpanded.has(projectPath)) {
    newExpanded.delete(projectPath);
  } else {
    newExpanded.add(projectPath);
  }
  setExpandedProjects(newExpanded);
};
```

使用 `Set` 的不可变更新模式——创建新 `Set`，修改后 `setState`。

#### 项目名称提取

从 Windows 风格的路径中提取最后一段作为显示名：

```tsx
{project.path.split('\\').pop() || project.path}
```

### 渲染结构

```
Sidebar (w-72, flex-col, bg-card)
├── 头部区域 (border-b)
│   ├── 标题行（"Claude Code Reader" + 设置齿轮图标按钮）
│   ├── EnvSwitcher 组件
│   └── 搜索输入框（带搜索图标前缀）
├── 项目列表区域 (flex-1, overflow-y-auto)
│   ├── [空状态提示]（"没有找到匹配的项目"或"没有找到任何项目"）
│   └── 项目条目（循环渲染）
│       ├── 项目头按钮（展开箭头 + 项目名 + 路径 + 会话数徽章）
│       └── [展开时] 会话列表
│           └── 会话按钮（会话名/ID + 时间戳）
└── 底部信息栏 (border-t)
    └── "共 X 个项目，Y 个会话"
```

---

## 3. ChatView — 聊天视图

**文件路径：** `src/components/ChatView.tsx`

### 组件概述

ChatView 是应用的主内容区域，占据侧边栏右侧的全部剩余空间。它负责展示当前会话的消息列表，支持消息过滤、编辑、删除、复制和自动滚动。

### Props 接口

```tsx
interface ChatViewProps {
  session: Session | null;
  messages: SessionMessage[];
  onEditMessage: (uuid: string, newContent: string) => void;
  onDeleteMessage: (uuid: string) => void;
  onRefresh: () => void;
}
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `session` | `Session \| null` | 当前选中的会话对象；为 null 时显示空状态占位 |
| `messages` | `SessionMessage[]` | 当前会话的完整消息列表（含所有类型） |
| `onEditMessage` | `(uuid: string, newContent: string) => void` | 编辑消息完成后的回调 |
| `onDeleteMessage` | `(uuid: string) => void` | 删除消息的回调（App 层处理确认弹窗） |
| `onRefresh` | `() => void` | 刷新当前会话消息的回调 |

### 内部 State

| 变量名 | 类型 | 初始值 | 说明 |
|--------|------|--------|------|
| `editingId` | `string \| null` | `null` | 正在编辑的消息 UUID，非 null 时该消息切换为编辑模式 |
| `editContent` | `string` | `''` | 编辑输入框中的当前文本内容 |
| `filter` | `'all' \| 'user' \| 'assistant'` | `'all'` | 消息过滤器，控制显示哪些类型的消息 |

### Ref

| Ref 名 | 类型 | 说明 |
|--------|------|------|
| `messagesEndRef` | `HTMLDivElement` | 消息列表底部的锚点元素，用于滚动到底部 |

### 功能特性

- **消息过滤**：通过下拉选择器过滤消息类型（全部 / 仅用户 / 仅助手）。过滤逻辑先排除非 `user`/`assistant` 类型的消息（如 `file-history-snapshot`、`tag` 等），再按选定的过滤条件筛选
- **消息编辑**：点击编辑按钮后，消息内容区域变为可调整大小的 `<textarea>`，支持保存和取消
- **消息删除**：点击删除按钮触发 `onDeleteMessage` 回调
- **消息复制**：点击复制按钮将消息纯文本内容写入系统剪贴板
- **自动滚动**：消息列表更新时自动平滑滚动到底部
- **手动滚动**：工具栏提供"滚动到底部"按钮
- **刷新功能**：工具栏提供"刷新"按钮重新读取当前会话文件
- **Token 显示**：助手消息底部显示输入/输出 Token 使用量
- **模型标识**：在消息头部显示使用的模型名称

### 关键逻辑

#### 消息过滤

```tsx
const filteredMessages = messages.filter((msg) => {
  if (msg.type !== 'user' && msg.type !== 'assistant') return false;
  if (filter === 'all') return true;
  return msg.type === filter;
});
```

第一步排除所有非对话消息（如 `file-history-snapshot`、`queue-operation`、`custom-title`、`tag`），第二步按用户选择的过滤条件筛选。

#### 编辑流程

1. `handleStartEdit(msg)` — 设置 `editingId` 为消息 UUID，用 `getMessageText` 提取消息文本填入 `editContent`
2. 用户在 `<textarea>` 中修改内容
3. `handleSaveEdit()` — 调用 `onEditMessage(editingId, editContent)`，然后重置编辑状态
4. `handleCancelEdit()` — 放弃修改，重置编辑状态

#### 剪贴板复制

```tsx
const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
};
```

使用浏览器原生 `navigator.clipboard` API。

#### 自动滚动到底部

```tsx
useEffect(() => {
  scrollToBottom();
}, [messages]);

const scrollToBottom = () => {
  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
};
```

每当 `messages` 数组变化时触发平滑滚动。

### 渲染结构

```
ChatView (flex-1, flex-col)
├── [session === null] → 空状态占位
│   └── 聊天气泡图标 + "选择一个会话来查看聊天记录"
└── [session !== null]
    ├── 头部工具栏 (border-b, bg-card)
    │   ├── 左侧：会话标题 + 时间戳 + 消息计数
    │   └── 右侧：过滤选择器 + 刷新按钮 + 滚动到底部按钮
    └── 消息列表 (flex-1, overflow-y-auto)
        ├── [空列表] → "没有消息"
        └── 消息条目（循环渲染，key=msg.uuid）
            ├── 消息头部
            │   ├── 左侧：角色标签（用户/助手）+ 时间戳 + 模型名
            │   └── 右侧：复制 / 编辑 / 删除 按钮
            ├── 消息内容
            │   ├── [编辑模式] → textarea + 取消/保存按钮
            │   └── [阅读模式] → <pre> 预格式化文本
            └── [有 usage 数据] → Token 使用量（输入 / 输出）
```

---

## 4. SettingsPanel — 设置面板

**文件路径：** `src/components/SettingsPanel.tsx`

### 组件概述

SettingsPanel 是一个模态对话框组件，通过全屏半透明覆盖层显示在页面上方。它包含四个标签页（常规、环境变量、权限、关于），并支持两种工作模式：普通设置模式和环境配置编辑模式。

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
| `settings` | `ClaudeSettings` | 当前设置数据。普通模式下为全局 settings；配置编辑模式下 env 部分被替换为编辑中配置的 env |
| `claudeDataPath` | `string` | Claude 数据目录路径，在"常规"标签页中只读显示 |
| `theme` | `'light' \| 'dark' \| 'system'` | 当前主题模式 |
| `editingProfile` | `EnvProfile \| null \| undefined` | 正在编辑的环境配置对象。非 null 时面板进入配置编辑模式 |
| `onSaveSettings` | `(settings: ClaudeSettings) => void` | 保存设置的回调。普通模式下写入 settings.json；编辑模式下更新配置的 env |
| `onThemeChange` | `(theme: 'light' \| 'dark' \| 'system') => void` | 主题变更回调，在"常规"标签页的主题下拉选择器中触发 |
| `onClose` | `() => void` | 关闭面板回调。同时重置 editingEnvProfile |

### 内部 State

| 变量名 | 类型 | 初始值 | 说明 |
|--------|------|--------|------|
| `editedSettings` | `ClaudeSettings` | `settings`（props） | 面板内部的设置副本，用于暂存用户的修改 |
| `activeTab` | `'general' \| 'env' \| 'permissions' \| 'about'` | `editingProfile ? 'env' : 'general'` | 当前激活的标签页。配置编辑模式下默认打开"环境变量"标签 |
| `hasChanges` | `boolean` | `false` | 是否有未保存的修改，控制"保存更改"按钮的启用/禁用状态 |
| `showApiKey` | `boolean` | `false` | 是否明文显示 API Key / Token 类型的环境变量值 |

### 功能特性

- **四个标签页**：常规 / 环境变量 / 权限 / 关于
- **双工作模式**：
  - 普通设置模式：编辑全局 Claude Code 设置
  - 配置编辑模式：仅编辑选定配置的环境变量
- **主题切换**：在常规标签页中提供三种主题模式的下拉选择
- **模型设置**：文本输入框编辑默认模型
- **环境变量管理**：添加、修改、删除环境变量键值对
- **敏感信息遮罩**：自动检测变量名中包含 `token` 或 `key` 的条目，默认使用 `password` 类型输入框遮罩，可点击切换显示
- **权限查看**：只读显示 `allow` 和 `deny` 权限列表
- **应用信息**：显示版本号（v0.2.0-beta.1）、开发者信息和 GitHub 仓库链接
- **变更检测**：只有当用户实际修改了内容后"保存更改"按钮才可用

### 关键逻辑

#### 环境变量增删改

```tsx
// 修改环境变量值
const handleEnvChange = (key: string, value: string) => {
  setEditedSettings((prev) => ({
    ...prev,
    env: { ...prev.env, [key]: value },
  }));
  setHasChanges(true);
};

// 删除环境变量
const handleRemoveEnv = (key: string) => {
  setEditedSettings((prev) => {
    const newEnv = { ...prev.env };
    delete newEnv[key];
    return { ...prev, env: newEnv };
  });
  setHasChanges(true);
};

// 添加环境变量（使用 prompt 对话框获取变量名）
const handleAddEnv = () => {
  const key = prompt('输入环境变量名称:');
  if (key) handleEnvChange(key, '');
};
```

#### 敏感信息自动检测

通过变量名关键字判断是否为敏感信息：

```tsx
type={key.toLowerCase().includes('token') || key.toLowerCase().includes('key')
  ? (showApiKey ? 'text' : 'password')
  : 'text'}
```

#### Settings 同步

当 props 中的 `settings` 变化时（例如切换了环境配置），自动同步到内部编辑状态：

```tsx
useEffect(() => {
  setEditedSettings(settings);
}, [settings]);
```

### 渲染结构

```
SettingsPanel (fixed 全屏覆盖层, z-50)
├── 半透明黑色背景 (bg-black/50)
└── 模态对话框 (bg-card, w-[600px], max-h-[80vh])
    ├── 头部 (border-b)
    │   ├── 标题（"设置"或"编辑配置: {name}"）
    │   └── 关闭按钮（X 图标）
    ├── 标签页导航 (border-b)
    │   └── 4 个标签按钮：常规 / 环境变量 / 权限 / 关于
    ├── 内容区域 (flex-1, overflow-y-auto)
    │   ├── [常规] → 主题选择 + 模型输入 + 数据路径（只读）
    │   ├── [环境变量] → 变量列表（key-value 编辑）+ 添加变量按钮
    │   ├── [权限] → 允许/拒绝操作列表（只读）
    │   └── [关于] → 应用名称 + 版本 + 开发者 + GitHub 链接
    └── 底部操作栏 (border-t)
        ├── 取消按钮
        └── 保存更改按钮（有变更时启用，无变更时禁用灰显）
```

---

## 5. EnvSwitcher — 环境切换器

**文件路径：** `src/components/EnvSwitcher.tsx`

### 组件概述

EnvSwitcher 是一个嵌入在 Sidebar 头部的下拉菜单组件，用于在多个环境配置之间快速切换。它显示当前激活的配置名称，点击展开下拉列表，支持选择、保存、编辑和删除配置。

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
| `config` | `EnvSwitcherConfig` | 完整的环境配置数据，包含 `profiles` 数组和 `activeProfileId` |
| `onSwitchProfile` | `(profile: EnvProfile) => void` | 点击配置条目切换环境的回调 |
| `onSaveCurrentAsProfile` | `(name: string) => void` | 保存当前环境为新配置的回调，参数为用户输入的配置名 |
| `onDeleteProfile` | `(profileId: string) => void` | 删除配置的回调 |
| `onEditProfile` | `(profile: EnvProfile) => void` | 编辑配置的回调，触发后会打开 SettingsPanel 的配置编辑模式 |

### 内部 State

| 变量名 | 类型 | 初始值 | 说明 |
|--------|------|--------|------|
| `showDropdown` | `boolean` | `false` | 控制下拉菜单的显示/隐藏 |
| `showSaveDialog` | `boolean` | `false` | 控制"保存当前配置"内联表单的显示/隐藏 |
| `newProfileName` | `string` | `''` | 新配置名称输入框的当前值 |

### Ref

| Ref 名 | 类型 | 说明 |
|--------|------|------|
| `dropdownRef` | `HTMLDivElement` | 下拉菜单容器引用，用于"点击外部关闭"功能 |

### 功能特性

- **当前配置显示**：按钮始终显示当前激活的配置名称，无激活配置时显示"默认配置"
- **下拉菜单**：点击按钮展开/收起配置列表
- **点击外部关闭**：通过 `useEffect` 监听全局 `mousedown` 事件，点击组件外部时自动关闭下拉菜单
- **配置选择**：点击配置条目立即切换并关闭下拉菜单
- **激活标识**：当前激活的配置左侧显示对勾图标
- **变量计数**：每个配置下方显示"N 个变量"
- **编辑/删除操作**：鼠标悬停在配置条目时，右侧显示编辑和删除图标按钮（`opacity-0 → group-hover:opacity-100` 过渡效果）
- **删除确认**：删除操作前弹出 `confirm()` 确认对话框
- **保存当前配置**：下拉菜单底部提供"保存当前配置"按钮，点击后展开内联输入框
- **快捷键支持**：保存输入框中按 `Enter` 确认保存，按 `Escape` 取消

### 关键逻辑

#### 点击外部关闭

```tsx
useEffect(() => {
  const handleClickOutside = (event: MouseEvent) => {
    if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
      setShowDropdown(false);
    }
  };
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, []);
```

使用 `mousedown` 而非 `click` 事件，确保在冒泡到其他点击处理器之前关闭菜单。

#### 事件冒泡阻止

编辑和删除按钮使用 `e.stopPropagation()` 防止触发父级配置条目的点击（切换配置）事件：

```tsx
<button onClick={(e) => {
  e.stopPropagation();
  onEditProfile(profile);
  setShowDropdown(false);
}}>
```

#### 保存配置流程

1. 点击"保存当前配置" → `setShowSaveDialog(true)`
2. 输入框自动聚焦（`autoFocus`）
3. 输入配置名称 → 按 Enter 或点击确认按钮
4. `handleSaveProfile()` — 校验非空 → 调用 `onSaveCurrentAsProfile` → 重置状态

### 渲染结构

```
EnvSwitcher (relative 定位容器)
├── 触发器按钮（当前配置名 + 展开/收起箭头）
└── [showDropdown] 下拉菜单 (absolute, z-50, shadow-xl)
    ├── 标题区 ("环境配置")
    ├── 配置列表 (max-h-60, overflow-y-auto)
    │   ├── [空列表] → "暂无保存的配置"
    │   └── 配置条目（循环渲染）
    │       ├── 左侧：[激活时] 对勾图标 + 配置名 + 变量计数
    │       └── 右侧：[悬停显示] 编辑按钮 + 删除按钮
    └── 底部操作区 (border-t)
        ├── [showSaveDialog === false] → "保存当前配置"按钮
        └── [showSaveDialog === true] → 输入框 + 确认按钮 + 取消按钮
```

---

## 组件依赖关系总览

```
App (根组件)
├── Sidebar
│   └── EnvSwitcher
├── ChatView
└── SettingsPanel (条件渲染)
```

所有组件均为无状态（受控）或仅包含 UI 相关的本地状态（如搜索词、展开状态、编辑模式）。业务数据和持久化逻辑完全由 App 组件通过 Props 和回调函数控制。
