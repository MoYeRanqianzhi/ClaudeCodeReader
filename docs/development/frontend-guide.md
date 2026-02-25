# 前端开发指南

本文档为 ClaudeCodeReader (CCR) 前端部分的开发指南，涵盖开发环境搭建、项目结构、编码约定、状态管理模式、Tauri API 调用方式以及添加新功能的标准流程。

---

## 开发环境搭建

### 所需工具

| 工具 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | 24+ | JavaScript 运行时 |
| npm | 随 Node.js 安装 | 包管理器 |
| Rust + Cargo | 最新稳定版 | Tauri 后端编译所需 |
| Tauri CLI | 2.x | 通过 `@tauri-apps/cli` 在 devDependencies 中安装 |

### 安装步骤

1. 克隆仓库后，进入前端项目目录：

```bash
cd claude-code-reader
```

2. 安装所有依赖：

```bash
npm install
```

此命令会同时安装以下核心依赖：
- **react** `^19.2.0` — UI 框架
- **react-dom** `^19.2.0` — React DOM 渲染器
- **@tauri-apps/api** `^2.9.1` — Tauri 前端 API
- **@tauri-apps/plugin-fs** `^2.4.4` — Tauri 文件系统插件
- **@tauri-apps/plugin-dialog** `^2.4.2` — Tauri 对话框插件
- **@tauri-apps/plugin-shell** `^2.3.3` — Tauri Shell 插件
- **motion** (motion/react) — 动画引擎（Framer Motion），用于侧边栏、设置面板、消息卡片等动画
- **lucide-react** — 图标库，替代所有内联 SVG 图标
- **tailwindcss** `^4.1.18` — CSS 工具框架
- **vite** `^7.2.4` — 构建工具
- **typescript** `~5.9.3` — TypeScript 编译器

### 启动开发服务器

#### 纯前端模式（Vite 开发服务器）

```bash
npm run dev
```

此命令启动 Vite 开发服务器，默认监听 `http://localhost:5173`。适用于纯 UI 开发和调试，但此模式下 Tauri API 调用不可用（因为没有 Tauri 运行时环境）。

#### 带 Tauri 的完整开发模式

```bash
npm run tauri dev
```

此命令同时启动 Vite 前端开发服务器和 Tauri 桌面窗口。前端的热模块替换（HMR）仍然有效，同时可以使用完整的 Tauri 文件系统等原生 API。**这是日常开发的推荐方式。**

### 其他常用命令

| 命令 | 说明 |
|------|------|
| `npm run build` | 先运行 TypeScript 编译检查（`tsc -b`），再执行 Vite 生产构建 |
| `npm run lint` | 运行 ESLint 代码风格检查 |
| `npm run preview` | 预览生产构建产物 |
| `npm run tauri build` | 构建可分发的桌面安装包 |

---

## 项目结构

```
claude-code-reader/src/
├── main.tsx                    # 应用入口文件，挂载 React 根组件
├── App.tsx                     # 根组件，集中管理全局状态和回调函数
├── index.css                   # 全局样式，Tailwind CSS 导入 + 主题变量 + 内容块样式
├── types/
│   └── claude.ts               # TypeScript 类型定义（20+ 个接口）
├── hooks/
│   ├── useCollapsible.ts       # 统一折叠/展开 hook（搜索导航自动展开）
│   └── useProgressiveRender.ts # 视口驱动渐进式渲染 hook
├── utils/
│   ├── claudeData.ts           # 数据访问层，调用 Rust Commands
│   ├── toolFormatter.ts        # 工具参数格式化（15+ 种工具）
│   ├── messageTransform.ts     # 消息转换与路径简化工具
│   └── rehypeHighlight.ts      # 自定义 rehype 语法高亮插件
├── components/
│   ├── index.ts                # 组件统一导出桶文件
│   ├── Sidebar.tsx             # 侧边栏（项目列表、搜索、环境切换、会话删除）
│   ├── ChatView.tsx            # 聊天视图（消息渲染、搜索导航、编辑、多选、导出）
│   ├── SettingsPanel.tsx       # 设置面板（模态框，四个标签页）
│   ├── EnvSwitcher.tsx         # 环境配置切换器（下拉菜单）
│   ├── MessageBlockList.tsx    # 消息内容块列表入口（React.memo 优化）
│   ├── MessageContentRenderer.tsx # 内容块渲染器（5 种类型 + ThinkingBlock）
│   ├── ToolUseRenderer.tsx     # 工具调用渲染器（紧凑格式 + diff + Raw）
│   ├── ToolResultRenderer.tsx  # 工具结果渲染器（折叠 + 打开文件位置）
│   ├── HighlightedText.tsx     # 搜索高亮文本组件（3 种匹配模式）
│   └── MarkdownRenderer.tsx    # Markdown 渲染器（react-markdown + 语法高亮）
└── assets/
    └── react.svg               # React logo 静态资源
```

### 各文件职责详述

| 文件 | 职责 |
|------|------|
| `main.tsx` | 创建 React 根节点，使用 `StrictMode` 包裹 `App` 组件 |
| `App.tsx` | 全局状态管理中枢；协调子组件间的数据流 |
| `index.css` | 定义浅色/深色模式的 CSS 自定义属性；引入 Tailwind CSS 4；定义内容块样式、渐变、滚动条、动画等自定义类 |
| `types/claude.ts` | 定义所有 TypeScript 接口（20+ 个），与 Rust Models 层一一对应 |
| `hooks/useCollapsible.ts` | 统一折叠/展开逻辑，支持搜索导航自动展开/收起 |
| `hooks/useProgressiveRender.ts` | 基于 IntersectionObserver 的视口驱动渐进式渲染 |
| `utils/claudeData.ts` | 数据访问层，通过 `invoke()` 调用 Rust Commands |
| `utils/toolFormatter.ts` | 格式化 15+ 种工具参数为紧凑显示字符串 |
| `utils/messageTransform.ts` | 消息转换工具（路径简化、文本提取等） |
| `utils/rehypeHighlight.ts` | 自定义 rehype 插件，190+ 编程语言语法高亮 |
| `Sidebar.tsx` | 左侧导航栏：搜索过滤、项目展开/折叠、会话选择/删除、环境配置切换器 |
| `ChatView.tsx` | 主内容区域：消息渲染、VSCode 风格搜索导航、编辑/删除、多选、导出 |
| `SettingsPanel.tsx` | 模态设置面板：主题切换、模型、环境变量管理、权限查看 |
| `EnvSwitcher.tsx` | 环境配置选择器：下拉列表、保存/编辑/删除配置 |
| `MessageBlockList.tsx` | 消息内容渲染入口（React.memo 优化），接收 Rust 预处理的 content 数组 |
| `MessageContentRenderer.tsx` | 按 type 分类渲染 text、tool_use、tool_result、thinking、image 五种内容块 |
| `ToolUseRenderer.tsx` | 工具调用紧凑渲染：`Tool(args)` 格式 + diff 预览 + Raw JSON 切换 |
| `ToolResultRenderer.tsx` | 工具结果折叠渲染 + 打开文件位置按钮 |
| `HighlightedText.tsx` | 搜索高亮共享组件：字面量/正则 3 种匹配模式 |
| `MarkdownRenderer.tsx` | Markdown 渲染：react-markdown + remark-gfm + 语法高亮 |

---

## React 开发约定

### 函数组件 + Hooks

项目全程使用函数组件和 React Hooks，不使用类组件。常用 Hook 包括：

- **`useState`** — 管理组件本地状态
- **`useEffect`** — 处理副作用（初始化数据加载、DOM 操作、事件监听）
- **`useCallback`** — 缓存事件处理函数，避免子组件不必要的重渲染
- **`useRef`** — 引用 DOM 元素（如消息列表底部锚点、下拉菜单容器、拖动状态追踪）
- **`useMemo`** — 缓存计算结果（如 Token 统计汇总）

### useCallback 用于事件处理器

在 `App.tsx` 中，所有传递给子组件的事件处理函数均使用 `useCallback` 包裹，并明确声明依赖数组：

```tsx
// 正确示例：使用 useCallback 包裹事件处理器
const handleSelectSession = useCallback(async (session: Session) => {
  setCurrentSession(session);
  setSelectedMessages(new Set());
  setSelectionMode(false);
  try {
    const msgs = await readSessionMessages(session.filePath);
    setMessages(msgs);
  } catch (err) {
    console.error('加载消息失败:', err);
    setMessages([]);
  }
}, []);  // 依赖数组中列出所有外部依赖
```

### 类型导入语法

使用 `import type` 语法导入仅作为类型使用的接口和类型，确保在编译产物中不会产生额外的运行时代码：

```tsx
// 正确：使用 import type
import type { Project, Session, SessionMessage } from './types/claude';

// 避免：使用普通 import 导入纯类型
import { Project, Session, SessionMessage } from './types/claude';
```

### 组件导出约定

- **子组件**：使用命名导出（named export），通过 `components/index.ts` 桶文件统一重新导出
- **App 组件**：使用默认导出（`export default App`），因为它是 `main.tsx` 中唯一导入的组件

```tsx
// 子组件：命名导出
export function Sidebar({ ... }: SidebarProps) { ... }
export function ChatView({ ... }: ChatViewProps) { ... }

// App：默认导出
function App() { ... }
export default App;
```

### Props 接口定义

每个组件在同文件内定义对应的 `Props` 接口，命名规范为 `组件名 + Props`：

```tsx
interface ChatViewProps {
  session: Session | null;
  messages: SessionMessage[];
  onEditMessage: (uuid: string, newContent: string) => void;
  onDeleteMessage: (uuid: string) => void;
  onRefresh: () => void;
  onExport: (format: 'markdown' | 'json') => void;
  // ... 更多属性
}
```

### 动画约定

项目使用 **motion/react**（Framer Motion）作为统一的动画引擎：

- **布局动画**：使用 `layoutId` 实现共享布局动画（如主题切换指示器、标签页指示条）
- **进出场动画**：使用 `AnimatePresence` + `initial`/`animate`/`exit` 实现进出场
- **悬停/点击反馈**：使用 `whileHover` 和 `whileTap` 实现微交互
- **Variant 传播**：父元素 `whileHover="hover"` 传播给子 `motion.*` 的 `variants`（用于图标旋转动画）
- **拖动时禁用动画**：`transition={{ duration: 0 }}` 确保拖动操作的实时反馈

### 图标约定

项目使用 **lucide-react** 作为统一的图标库：

- 所有图标均为语义化组件（如 `<Settings />`、`<Search />`、`<Trash2 />`）
- 图标大小通过 `className="w-N h-N"` 控制
- 使用 `shrink-0` 防止图标在 flex 布局中被压缩

---

## 状态管理模式

### 集中式状态管理

本项目采用 **"提升状态到根组件"** 的策略。所有全局状态集中定义在 `App.tsx` 中，通过 props 逐级下传到子组件。未使用 Redux、Zustand、Jotai 等第三方状态管理库。

### 16 个状态变量一览

| 变量名 | 类型 | 初始值 | 用途 |
|--------|------|--------|------|
| `claudeDataPath` | `string` | `''` | Claude 数据目录路径（`~/.claude`） |
| `projects` | `Project[]` | `[]` | 所有项目列表 |
| `currentProject` | `Project \| null` | `null` | 当前选中的项目 |
| `currentSession` | `Session \| null` | `null` | 当前选中的会话 |
| `messages` | `SessionMessage[]` | `[]` | 当前会话的消息列表 |
| `settings` | `ClaudeSettings` | `{}` | Claude Code 设置 |
| `envConfig` | `EnvSwitcherConfig` | `{ profiles: [], activeProfileId: null }` | 环境配置切换器状态 |
| `showSettings` | `boolean` | `false` | 设置面板是否显示 |
| `editingEnvProfile` | `EnvProfile \| null` | `null` | 正在编辑的环境配置 |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | 当前主题模式 |
| `loading` | `boolean` | `true` | 应用初始化加载状态 |
| `error` | `string \| null` | `null` | 初始化错误信息 |
| `selectedMessages` | `Set<string>` | `new Set()` | 已选中的消息 UUID 集合 |
| `selectionMode` | `boolean` | `false` | 选择模式开关 |
| `sidebarCollapsed` | `boolean` | `false` | 侧边栏折叠状态 |
| `sidebarWidth` | `number` | `320` | 侧边栏宽度（px） |
| `isResizingSidebar` | `boolean` | `false` | 是否正在拖动调整宽度 |

### Props 向下传递策略

```
App (所有状态)
├── Sidebar         ← projects, currentProject, currentSession, envConfig,
│                     width, isResizing + 9 个回调
├── ChatView        ← session, messages, selectionMode, selectedMessages,
│                     sidebarCollapsed + 10 个回调
└── SettingsPanel   ← settings, claudeDataPath, theme, editingProfile + 3 个回调
    └── （条件渲染，仅 showSettings 为 true 时显示）
```

---

## Tauri API 调用方式

### invoke() 调用 Rust Commands

数据操作通过 `invoke()` 调用 Rust 后端的自定义 Commands，而非直接调用 Tauri 插件 API：

```typescript
import { invoke } from '@tauri-apps/api/core';

// 调用 Rust command 读取会话
const session = await invoke<TransformedSession>('read_session_messages', {
  sessionPath: '/path/to/session.jsonl',
  projectPath: '/path/to/project',
});

// 调用 Rust command 搜索
const matchIds = await invoke<string[]>('search_session', {
  sessionPath: '/path/to/session.jsonl',
  query: 'search term',
  caseSensitive: false,
  useRegex: false,
});
```

### 仍使用插件 API 的场景

部分操作仍通过 Tauri 插件 API 完成：

| API | 用途 |
|-----|------|
| `@tauri-apps/plugin-dialog` | 文件保存对话框（导出功能） |
| `@tauri-apps/plugin-fs` | 导出文件写入 |
| `@tauri-apps/plugin-opener` | 在文件管理器中定位文件 |

### 数据访问层：`utils/claudeData.ts`

所有数据操作函数集中封装在 `claudeData.ts` 中，内部调用 `invoke()` 与 Rust 后端通信。

### 数据文件路径约定

| 文件 | 路径 | 格式 |
|------|------|------|
| Claude 设置 | `~/.claude/settings.json` | JSON |
| 项目目录 | `~/.claude/projects/<编码项目路径>/` | 目录 |
| 会话文件 | `~/.claude/projects/<编码项目路径>/<session-id>.jsonl` | JSONL |
| 历史记录 | `~/.claude/history.jsonl` | JSONL |
| CCR 环境配置 | `~/.mo/CCR/env-profiles.json` | JSON |

---

## 添加新功能的开发流程

遵循以下标准步骤来添加新功能：

### 1. 定义类型

在 `src/types/claude.ts` 中定义相关的 TypeScript 接口：

```tsx
// 示例：添加一个新的书签功能
export interface Bookmark {
  id: string;
  sessionId: string;
  messageUuid: string;
  label: string;
  createdAt: string;
}
```

### 2. 实现数据函数

在 `src/utils/claudeData.ts` 中实现数据的读取和持久化逻辑：

```tsx
export async function readBookmarks(claudePath: string): Promise<Bookmark[]> {
  const { join } = await import('@tauri-apps/api/path');
  const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
  // ... 读取逻辑
}
```

### 3. 在 App.tsx 添加状态和处理器

在根组件中添加新的状态变量和 `useCallback` 回调函数：

```tsx
const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

const handleAddBookmark = useCallback(async (bookmark: Bookmark) => {
  // ... 业务逻辑
}, [claudeDataPath]);
```

### 4. 创建或修改组件

创建新组件或修改现有组件，接收 App 传下来的 props：

```tsx
interface BookmarkListProps {
  bookmarks: Bookmark[];
  onRemoveBookmark: (id: string) => void;
}

export function BookmarkList({ bookmarks, onRemoveBookmark }: BookmarkListProps) {
  // ... 组件实现
}
```

### 5. 在桶文件中导出

在 `src/components/index.ts` 中添加导出：

```tsx
export { BookmarkList } from './BookmarkList';
```

### 6. 在 App.tsx 中使用

在根组件的 JSX 中引入新组件，传递对应的 props：

```tsx
<BookmarkList
  bookmarks={bookmarks}
  onRemoveBookmark={handleRemoveBookmark}
/>
```

### 7. 添加动画（可选）

使用 motion/react 为新组件添加动画效果：

```tsx
import { motion, AnimatePresence } from 'motion/react';

// 进出场动画
<AnimatePresence>
  {visible && (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
    >
      ...
    </motion.div>
  )}
</AnimatePresence>

// 悬停/点击微交互
<motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
  ...
</motion.button>
```

---

## 注意事项

- **错误处理**：所有异步操作使用 `try/catch` 包裹，错误信息输出到 `console.error`
- **中文日志**：错误日志和 UI 文本均使用中文
- **ESLint**：提交前运行 `npm run lint` 确保代码风格一致
- **TypeScript 严格模式**：所有代码必须通过 TypeScript 编译检查（`tsc -b`）
- **动画性能**：拖动操作时使用 `transition={{ duration: 0 }}` 禁用动画；使用 `useRef` 追踪频繁变化的状态避免闭包问题
- **Flex 布局**：注意 flex 子项默认 `min-width: auto` 的陷阱，需要添加 `min-w-0` 防止内容撑开布局

---

## 自定义 Hooks

### useCollapsible — 统一折叠/展开

位于 `src/hooks/useCollapsible.ts`，统一管理所有可折叠组件的展开/收起逻辑。

```typescript
const { expanded, handleManualToggle } = useCollapsible(searchAutoExpand);
```

- `searchAutoExpand` 为 `true` 时自动展开，变为 `false` 时自动收起
- 手动点击展开后，`searchAutoExpand` 变化不再影响（通过 `wasAutoExpandedRef` 追踪）
- 使用 `useEffect`（非渲染阶段状态派生）确保在 React.memo 下行为可靠

使用组件：CompactSummaryBlock、SystemMessageBlock、ThinkingBlock、ToolUseRenderer、ToolResultRenderer

### useProgressiveRender — 渐进式渲染

位于 `src/hooks/useProgressiveRender.ts`，基于 IntersectionObserver 实现视口驱动的虚拟化渲染。

- 仅渲染视口内及附近的消息，视口外显示占位符 `<div>`
- 300+ 消息会话首屏渲染时间从秒级降到毫秒级
- 返回 `isRendered(index)` 函数供 `.map()` 中判断

---

## 搜索系统

### 架构概览

```
ChatView
├── NavSearchBar (Ctrl+F 唤起)
│   ├── 搜索输入框 + 4 模式切换按钮
│   └── 上/下导航按钮 + 匹配计数
├── searchHighlight: SearchHighlight (穿透到所有渲染组件)
├── searchAutoExpandId: string | null (useMemo 派生)
└── 导航 useEffect (滚动 + 闪烁 + 自动展开)
```

### 搜索模式

| 模式 | 说明 |
|------|------|
| 字面量（不敏感） | 默认模式，大小写不敏感匹配 |
| 字面量（敏感） | 大小写敏感精确匹配 |
| 正则表达式 | JavaScript RegExp 语法 |
| 全词匹配 | `\b` 边界匹配 |

### 搜索高亮穿透链路

```
ChatView → MessageItem → MessageBlockList → MessageContentRenderer
  → MarkdownRenderer (searchHighlight)
  → ToolUseRenderer (searchHighlight → 工具名/参数/diff/Raw)
  → ToolResultRenderer (searchHighlight → 工具名/参数/结果内容)
  → ThinkingBlock (searchHighlight → 思考内容)
```

### 自动展开机制

搜索导航跳转到折叠内容时：

1. **消息级折叠**（compact_summary、system）：`searchAutoExpandId` 触发 useCollapsible 展开，400ms 后滚动
2. **块级折叠**（thinking、tool_use、tool_result）：`searchAutoExpand` prop 穿透到子组件，300ms 后滚动
3. **Raw 面板**（非 Write/Edit 工具）：`searchAutoExpand && !diffData` 时自动展开 Raw JSON 面板

### 闪烁动画

导航跳转时目标消息闪烁 3 次高亮：
- 使用 CSS `@keyframes` 动画，脱离 React 渲染周期
- 通过直接 DOM 操作添加/移除 CSS 类
- `animationend` 事件清理，阻止子元素事件冒泡

---

## 性能优化要点

### React.memo 三层防护

| 组件 | 比较策略 | 效果 |
|------|---------|------|
| `MessageBlockList` | 默认浅比较 | content/toolUseMap 引用不变时跳过 |
| `MessageContentRenderer` | 默认浅比较 | 单个内容块级别跳过 |
| `MessageItem` | 自定义比较器 | 搜索导航时仅 0~2 条消息重渲染 |

### MessageItem 自定义比较器

将 `Set.has()` 和 `=== id` 判断提前到 `.map()` 调用处，传入 boolean 而非 Set/id：

```typescript
// 在 .map() 中预计算
searchAutoExpand={searchAutoExpandId === msg.displayId}  // boolean
isSelected={selectedMessages.has(msg.sourceUuid)}         // boolean
isEditing={editingId === msg.displayId}                   // boolean
```

比较器只比较数据 props，忽略函数 props（函数引用可能不稳定但行为不变）。
