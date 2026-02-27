# 项目架构文档

## 项目简介

ClaudeCodeReader (CCR) 是一个基于 Tauri 的跨平台桌面应用程序，用于浏览和管理 Claude Code 的会话记录与配置。用户可以通过图形界面查看项目列表、浏览聊天会话、编辑/删除消息、管理环境变量配置，并在不同环境配置之间快速切换。

- **版本**：2.1.0-rc.1
- **许可证**：MIT
- **作者**：墨叶染千枝 (MoYeRanQianZhi)

## 技术栈

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 前端框架 | React | 19.2.0 | UI 组件与状态管理 |
| 类型系统 | TypeScript | 5.9.3 | 静态类型检查 |
| 构建工具 | Vite | 7.2.4 | 前端打包与热更新开发服务器 |
| CSS 框架 | Tailwind CSS | 4.1.18 | 原子化 CSS 样式 |
| 动画引擎 | motion/react (Framer Motion) | — | 组件动画、过渡效果、共享布局动画 |
| 图标库 | lucide-react | — | 语义化 SVG 图标组件 |
| 桌面框架 | Tauri | 2.9.5 | 原生桌面应用容器 |
| 后端语言 | Rust | 2024 edition (≥1.85) | Tauri 原生层（MVC 架构，~3000 行） |
| Markdown 渲染 | react-markdown + remark-gfm | — | Markdown 内容渲染与 GFM 支持 |
| 语法高亮 | 自定义 rehype 插件 | — | 190+ 编程语言代码高亮 |
| CSS 处理 | PostCSS + Autoprefixer | 8.5.6 / 10.4.22 | CSS 后处理与浏览器兼容 |
| 代码检查 | ESLint | 9.39.1 | 代码风格与质量检查 |
| CI/CD | GitHub Actions | — | 自动化构建与发布 |
| 包管理 | npm | — | 前端依赖管理与全局 CLI 分发 |

## 目录结构

```
claude-code-reader/
├── src/                           # 前端源码（React + TypeScript）
│   ├── main.tsx                   # 应用入口：React DOM 渲染
│   ├── App.tsx                    # 根组件：全局状态管理与布局
│   ├── index.css                  # 全局样式：主题变量、内容块样式、渐变、滚动条
│   ├── types/
│   │   └── claude.ts              # TypeScript 类型定义（20+ 个接口）
│   ├── hooks/
│   │   ├── useCollapsible.ts      # 统一折叠/展开 hook（搜索导航自动展开）
│   │   └── useProgressiveRender.ts # 视口驱动渐进式渲染 hook
│   ├── utils/
│   │   ├── claudeData.ts          # 数据访问层：调用 Rust Commands
│   │   ├── toolFormatter.ts       # 工具参数格式化（15+ 种工具）
│   │   ├── messageTransform.ts    # 消息转换与路径简化工具
│   │   └── rehypeHighlight.ts     # 自定义 rehype 语法高亮插件
│   └── components/
│       ├── index.ts               # 桶导出
│       ├── Sidebar.tsx            # 侧边栏：项目/会话导航、搜索、会话删除
│       ├── ChatView.tsx           # 聊天视图：消息渲染、搜索导航、编辑、多选
│       ├── SettingsPanel.tsx      # 设置面板：4 标签页模态对话框
│       ├── EnvSwitcher.tsx        # 环境切换器：配置下拉选择与管理
│       ├── MessageBlockList.tsx   # 消息内容块列表入口（React.memo 优化）
│       ├── MessageContentRenderer.tsx  # 内容块渲染器（5 种类型 + ThinkingBlock）
│       ├── ToolUseRenderer.tsx    # 工具调用渲染器（紧凑格式 + diff + Raw）
│       ├── ToolResultRenderer.tsx # 工具结果渲染器（折叠 + 打开文件位置）
│       ├── HighlightedText.tsx    # 搜索高亮文本组件（3 种匹配模式）
│       └── MarkdownRenderer.tsx   # Markdown 渲染器（react-markdown + 语法高亮）
│
├── src-tauri/                     # Rust 后端（Tauri 原生层，MVC 架构）
│   ├── src/
│   │   ├── main.rs                # 原生入口：Windows 子系统配置
│   │   ├── lib.rs                 # 应用初始化：插件注册 + Commands 注册 + 缓存初始化
│   │   ├── commands/              # Command 层（IPC 接口）
│   │   │   ├── mod.rs             # 模块索引
│   │   │   ├── projects.rs        # 项目扫描 commands
│   │   │   ├── messages.rs        # 消息读写/搜索/导出 commands
│   │   │   └── settings.rs        # 设置和配置 commands
│   │   ├── models/                # 数据模型层
│   │   │   ├── mod.rs             # 模块索引
│   │   │   ├── project.rs         # Project、Session、FileHistorySnapshot
│   │   │   ├── message.rs         # SessionMessage、MessageContent、ToolUseResult
│   │   │   ├── display.rs         # DisplayMessage、ToolUseInfo、TokenStats、TransformedSession
│   │   │   └── settings.rs        # ClaudeSettings、EnvProfile、EnvSwitcherConfig
│   │   ├── services/              # 业务逻辑层
│   │   │   ├── mod.rs             # 模块索引
│   │   │   ├── scanner.rs         # 项目/会话文件系统扫描（并行 I/O）
│   │   │   ├── parser.rs          # JSONL 解析与写入
│   │   │   ├── classifier.rs      # 消息分类（user/assistant/system/compact_summary）
│   │   │   ├── transformer.rs     # 消息转换管线（DisplayMessage 生成）
│   │   │   ├── cache.rs           # LRU 缓存 + TTL 缓存 + 搜索缓存
│   │   │   └── export.rs          # Markdown/JSON 导出
│   │   └── utils/                 # 工具函数
│   │       └── path.rs            # 路径编解码
│   ├── build.rs                   # Cargo 构建脚本
│   ├── Cargo.toml                 # Rust 依赖配置
│   ├── tauri.conf.json            # Tauri 应用配置
│   ├── capabilities/
│   │   └── default.json           # Tauri 安全权限配置
│   └── icons/                     # 多平台应用图标
│
├── npm/                           # NPM 全局包分发
│   ├── bin/ccr.js                 # CLI 入口
│   ├── scripts/postinstall.js     # 安装后脚本
│   └── package.json               # NPM 包配置
│
├── docs/development/              # 开发文档
│
├── .github/workflows/
│   └── release.yml                # CI/CD 流水线
│
├── package.json                   # 前端项目配置
├── vite.config.ts                 # Vite 构建配置
├── tailwind.config.js             # Tailwind CSS 主题配置
├── postcss.config.js              # PostCSS 插件管道
├── eslint.config.js               # ESLint 代码检查配置
├── tsconfig.json                  # TypeScript 项目引用配置
├── tsconfig.app.json              # TypeScript 应用编译配置
├── tsconfig.node.json             # TypeScript Node 编译配置
├── index.html                     # HTML 入口页面
├── README.md                      # 英文说明文档
├── README_CN.md                   # 中文说明文档
└── LICENSE                        # MIT 许可证
```

## 模块依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                        index.html                            │
│                     (HTML 入口页面)                           │
└─────────────┬───────────────────────────────────────────────┘
              │ 加载
              ▼
┌─────────────────────────────────────────────────────────────┐
│                        main.tsx                              │
│                  (React DOM 渲染入口)                         │
└─────────────┬───────────────────────────────────────────────┘
              │ 渲染
              ▼
┌─────────────────────────────────────────────────────────────┐
│                        App.tsx                               │
│              (根组件 · 全局状态管理中心)                       │
└──────┬──────────┬──────────────┬────────────────────────────┘
       │          │              │
       ▼          ▼              ▼
┌──────────┐ ┌──────────────────────────┐ ┌──────────────┐
│ Sidebar  │ │       ChatView           │ │SettingsPanel │
│(motion)  │ │  (搜索导航 + 渐进渲染)    │ │  (模态框)     │
│ ┌──────┐ │ │ ┌──────────────────────┐ │ └──────────────┘
│ │Env   │ │ │ │  NavSearchBar        │ │
│ │Switch│ │ │ │  (VSCode 风格搜索)    │ │
│ │er    │ │ │ └──────────────────────┘ │
│ └──────┘ │ │ ┌──────────────────────┐ │
└──────────┘ │ │  MessageBlockList    │ │
             │ │  (React.memo)        │ │
             │ │  ┌──────────────────┐│ │
             │ │  │MessageContent    ││ │
             │ │  │Renderer          ││ │
             │ │  │ ├─ ThinkingBlock ││ │
             │ │  │ ├─ ToolUse       ││ │
             │ │  │ │  Renderer      ││ │
             │ │  │ ├─ ToolResult    ││ │
             │ │  │ │  Renderer      ││ │
             │ │  │ ├─ Markdown      ││ │
             │ │  │ │  Renderer      ││ │
             │ │  │ └─ Highlighted   ││ │
             │ │  │    Text          ││ │
             │ │  └──────────────────┘│ │
             │ └──────────────────────┘ │
             └──────────────────────────┘
       │          │              │
       └──────────┴──────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   utils/claudeData.ts                        │
│              (数据访问层 · invoke() 调用)                     │
│                                                              │
│  路径工具 | 设置读写 | 项目/会话 | 消息操作 | 环境配置管理   │
└─────────────┬───────────────────────────────────────────────┘
              │ invoke() IPC 调用
              ▼
┌─────────────────────────────────────────────────────────────┐
│              Rust 后端 (MVC 架构)                             │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Commands 层 (IPC 接口)                               │    │
│  │  projects.rs | messages.rs | settings.rs             │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │ Services 层 (业务逻辑)                               │    │
│  │  scanner | parser | classifier | transformer         │    │
│  │  cache | export                                      │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │ Models 层 (数据结构)                                 │    │
│  │  project | message | display | settings              │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Tauri 插件: fs | dialog | shell | opener | log             │
└─────────────────────────────────────────────────────────────┘
```

## 动画架构

本项目使用 **motion/react**（Framer Motion）作为统一的动画引擎，替代原有的 CSS 动画：

### 动画类型

| 动画类型 | 使用方式 | 应用场景 |
|---------|---------|---------|
| 进出场动画 | `AnimatePresence` + `initial`/`animate`/`exit` | 侧边栏展开/折叠、设置面板、下拉菜单 |
| 共享布局动画 | `layoutId` | 主题切换指示器、标签页指示条 |
| 悬停/点击微交互 | `whileHover`/`whileTap` | 所有按钮的缩放回弹效果 |
| Variant 传播 | 父 `whileHover="hover"` → 子 `variants` | 设置齿轮旋转、主题图标旋转 |
| 交错动画 | `transition.delay: index * N` | 会话列表 staggered 入场 |
| 宽度动画 | `animate={{ width }}` | 侧边栏拖动宽度调整 |

### 性能优化

- 拖动操作时使用 `transition={{ duration: 0 }}` 禁用过渡动画
- 使用 `useRef` 追踪拖动状态，避免全局事件监听器的闭包陈旧问题
- 消息卡片使用轻量级 `opacity` + `transform` 动画，利用 GPU 加速

## 数据存储

应用涉及两个数据存储位置：

### Claude Code 原始数据（只读 + 写回）

- **路径**：`~/.claude/`
- **settings.json**：Claude Code 配置文件（环境变量、模型、权限、API Key）
- **projects/{编码路径}/*.jsonl**：会话记录文件，每行一个 JSON 对象（SessionMessage）
- **history.jsonl**：命令历史记录（已实现读取但未在 UI 中使用）

### CCR 自身配置数据

- **路径**：`~/.mo/CCR/`
- **env-profiles.json**：环境配置模板列表与当前激活的模板 ID

### 路径编码规则

Claude Code 将项目路径编码为目录名，规则如下：
- 驱动器号后的 `:\` 替换为 `--`，例如 `G:\` → `G--`
- 路径分隔符 `\` 替换为 `-`，例如 `ClaudeProjects\Test` → `ClaudeProjects-Test`
- 完整示例：`G:\ClaudeProjects\Test` → `G--ClaudeProjects-Test`

解码函数 `decodeProjectPath()` 在 `utils/claudeData.ts` 中实现。

## 应用架构特点

1. **Rust 后端驱动架构**：核心计算（消息解析、分类、转换、搜索、Token 统计）全部在 Rust 后端完成，前端通过 `invoke()` 调用 15 个自定义 Tauri Commands 获取处理后的数据
2. **MVC 分层架构**：Rust 后端采用 Commands（接口层）→ Services（业务层）→ Models（数据层）三层架构，各层职责清晰
3. **集中式状态管理**：前端全部应用状态集中在 `App.tsx` 根组件中，通过 props 向下传递给子组件，未使用 Redux/Zustand 等状态库
4. **多级缓存系统**：AppCache 包含项目列表 TTL 缓存（30 秒）和会话消息 LRU 缓存（最多 20 个），搜索结果也有独立缓存
5. **CSS 变量主题系统**：使用 Tailwind CSS 4 的 `@theme inline` + CSS 自定义属性 + `.dark` 类切换实现浅色/深色主题
6. **JSONL 数据格式**：会话数据使用 JSON Lines 格式，Rust 端高性能解析，支持容错跳过无效行
7. **渐进式渲染**：useProgressiveRender hook 基于 IntersectionObserver 实现视口驱动的虚拟化渲染，300+ 消息会话无卡顿
8. **统一折叠系统**：useCollapsible hook 统一管理所有可折叠组件，支持搜索导航自动展开/收起
9. **React.memo 多层防护**：MessageBlockList、MessageContentRenderer、MessageItem 均使用 memo + 自定义比较器，搜索导航时仅 0~2 条消息重渲染
10. **结构化消息渲染**：通过 MessageBlockList → MessageContentRenderer → ToolUseRenderer/ToolResultRenderer/MarkdownRenderer/HighlightedText 组件链实现 5 种内容类型的分类渲染

## 目标平台

| 平台 | 构建产物 | 安装方式 |
|------|---------|---------|
| Windows (x64) | `.exe` NSIS 安装包 + 裸二进制 | 安装包 / NPM 全局安装 |
| macOS (ARM64) | `.app.tar.gz` + `.dmg` | 解压 / NPM 全局安装 |
| macOS (x86_64) | `.app.tar.gz` + `.dmg` | 解压 / NPM 全局安装 |
| Linux (amd64) | `.AppImage` / `.deb` | 直接运行 / NPM 全局安装 |
