# 项目架构文档

## 项目简介

ClaudeCodeReader (CCR) 是一个基于 Tauri 的跨平台桌面应用程序，用于浏览和管理 Claude Code 的会话记录与配置。用户可以通过图形界面查看项目列表、浏览聊天会话、编辑/删除消息、管理环境变量配置，并在不同环境配置之间快速切换。

- **版本**：0.2.0-beta.1
- **许可证**：MIT
- **作者**：墨叶染千枝 (MoYeRanQianZhi)

## 技术栈

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 前端框架 | React | 19.2.0 | UI 组件与状态管理 |
| 类型系统 | TypeScript | 5.9.3 | 静态类型检查 |
| 构建工具 | Vite | 7.2.4 | 前端打包与热更新开发服务器 |
| CSS 框架 | Tailwind CSS | 4.1.18 | 原子化 CSS 样式 |
| 桌面框架 | Tauri | 2.9.5 | 原生桌面应用容器 |
| 后端语言 | Rust | 2021 edition (≥1.77.2) | Tauri 原生层 |
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
│   ├── index.css                  # 全局样式：主题变量与基础样式
│   ├── types/
│   │   └── claude.ts              # TypeScript 类型定义（13 个接口）
│   ├── utils/
│   │   └── claudeData.ts          # 数据访问层：Tauri API 调用与文件操作
│   └── components/
│       ├── index.ts               # 桶导出：统一导出所有组件
│       ├── Sidebar.tsx            # 侧边栏：项目/会话导航与搜索
│       ├── ChatView.tsx           # 聊天视图：消息展示、编辑、删除
│       ├── SettingsPanel.tsx      # 设置面板：4 标签页模态对话框
│       └── EnvSwitcher.tsx        # 环境切换器：配置下拉选择与管理
│
├── src-tauri/                     # Rust 后端（Tauri 原生层）
│   ├── src/
│   │   ├── main.rs                # 原生入口：Windows 子系统配置
│   │   └── lib.rs                 # 应用初始化：插件注册与事件循环
│   ├── build.rs                   # Cargo 构建脚本
│   ├── Cargo.toml                 # Rust 依赖配置
│   ├── tauri.conf.json            # Tauri 应用配置（窗口、安全、打包）
│   ├── capabilities/
│   │   └── default.json           # Tauri 安全权限配置
│   └── icons/                     # 多平台应用图标
│
├── npm/                           # NPM 全局包分发
│   ├── bin/ccr.js                 # CLI 入口：启动桌面应用进程
│   ├── scripts/postinstall.js     # 安装后脚本：下载平台二进制文件
│   └── package.json               # NPM 包配置
│
├── .github/workflows/
│   └── release.yml                # CI/CD：多平台构建与发布流水线
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
│                                                              │
│  状态: claudeDataPath, projects, currentSession,             │
│        messages, settings, envConfig, theme ...               │
└──────┬──────────┬──────────────┬────────────────────────────┘
       │          │              │
       ▼          ▼              ▼
┌──────────┐ ┌──────────┐ ┌──────────────┐
│ Sidebar  │ │ ChatView │ │SettingsPanel │
│          │ │          │ │  (模态框)     │
│ ┌──────┐ │ │ 消息列表  │ │ 4 个标签页   │
│ │Env   │ │ │ 编辑/删除 │ │ 常规/环境变量│
│ │Switch│ │ │ 过滤/复制 │ │ /权限/关于   │
│ └──────┘ │ │          │ │              │
└──────────┘ └──────────┘ └──────────────┘
       │          │              │
       └──────────┴──────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   utils/claudeData.ts                        │
│              (数据访问层 · 19 个工具函数)                     │
│                                                              │
│  路径工具 | 设置读写 | 项目/会话 | 消息操作 | 环境配置管理   │
└─────────────┬───────────────────────────────────────────────┘
              │ 调用
              ▼
┌─────────────────────────────────────────────────────────────┐
│              Tauri 插件 (原生桥接)                            │
│                                                              │
│  @tauri-apps/api/path    路径工具（homeDir, join）            │
│  @tauri-apps/plugin-fs   文件操作（读写、目录、存在性检查）   │
└─────────────┬───────────────────────────────────────────────┘
              │ IPC 通信
              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Rust / Tauri 原生层                          │
│                      (lib.rs)                                │
│                                                              │
│  tauri-plugin-fs       文件系统访问                           │
│  tauri-plugin-dialog   系统对话框                             │
│  tauri-plugin-shell    Shell 命令执行                         │
│  tauri-plugin-log      日志记录（仅调试模式）                 │
└─────────────────────────────────────────────────────────────┘
```

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

1. **前端驱动架构**：所有业务逻辑均在前端 TypeScript 中实现，Rust 后端仅负责 Tauri 插件初始化，不包含任何自定义 Tauri Command
2. **集中式状态管理**：全部应用状态集中在 `App.tsx` 根组件中，通过 props 向下传递给子组件，未使用 Redux/Zustand 等状态库
3. **插件化文件访问**：所有文件系统操作通过 `@tauri-apps/plugin-fs` 进行，前端直接调用插件 API 而非自定义后端命令
4. **CSS 变量主题系统**：使用 CSS 自定义属性 + `.dark` 类切换实现浅色/深色主题，遵循 shadcn/ui 设计系统的颜色语义
5. **JSONL 数据格式**：会话数据使用 JSON Lines 格式，每行独立解析，支持增量读写

## 目标平台

| 平台 | 构建产物 | 安装方式 |
|------|---------|---------|
| Windows (x64) | `.exe` NSIS 安装包 + 裸二进制 | 安装包 / NPM 全局安装 |
| macOS (ARM64) | `.app.tar.gz` | 解压 / NPM 全局安装 |
| macOS (x86_64) | `.app.tar.gz` | 解压 / NPM 全局安装 |
| Linux (amd64) | `.AppImage` / `.deb` | 直接运行 / NPM 全局安装 |
