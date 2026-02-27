# 更新日志

所有版本变更记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/) 规范。

---

## [未发布] — 2025（基于 v2.0.1-beta.1）

以下变更尚未发布为正式版本，基于 v2.0.1-beta.1 持续开发。

### 新增

#### Rust 后端全量计算迁移（架构重构）

- **MVC 架构**：Rust 后端从"零自定义 Command"重构为完整的 MVC 分层架构
  - `commands/` — Tauri IPC 命令层（projects、messages、settings 三个子模块）
  - `models/` — 数据模型层（project、message、display、settings 四个子模块）
  - `services/` — 业务逻辑层（scanner、parser、classifier、transformer、cache、export 六个子模块）
  - `utils/` — 工具函数层（path 路径处理）
- **15 个自定义 Tauri Commands**：
  - 设置：`get_claude_data_path`、`read_settings`、`save_settings`、`read_env_config`、`save_env_config`、`read_history`、`check_file_exists`
  - 项目：`scan_projects`
  - 消息：`read_session_messages`、`delete_message`、`delete_messages`、`edit_message_content`、`delete_session`、`search_session`、`export_session`
- **AppCache 全局状态**：LRU 缓存（最多 20 个会话）+ 项目列表 TTL 缓存（30 秒）
- **新增 Rust 依赖**：`tokio`（异步 I/O）、`dirs`（主目录获取）、`regex`（正则匹配）、`rayon`（数据并行）、`memchr`（SIMD 子串搜索）、`tauri-plugin-opener`（文件管理器集成）
- **Rust edition 升级**：从 2021 升级到 2024，rust-version 从 1.77.2 升级到 1.85

#### 消息处理管线

- **消息分类器**（classifier.rs）：将原始 SessionMessage 精确分类为 user/assistant/system/compact_summary 等类型，识别系统消息子类型（skill、plan、plan_execution 等）
- **消息转换器**（transformer.rs）：将原始消息转换为前端可渲染的 DisplayMessage，构建 toolUseMap，计算 TokenStats
- **JSONL 解析器**（parser.rs）：高性能 JSONL 解析，支持容错（跳过无效行）
- **项目扫描器**（scanner.rs）：并行 I/O 扫描项目和会话，支持路径编解码
- **会话导出**（export.rs）：Markdown/JSON 格式导出

#### VSCode 风格导航搜索系统

- **NavSearchBar 组件**：Ctrl+F 唤起的搜索栏，支持 4 种搜索模式
  - 字面量（大小写不敏感，默认）
  - 字面量（大小写敏感）
  - 正则表达式
  - 全词匹配
- **搜索结果导航**：Enter/Shift+Enter 或上下箭头在匹配结果间跳转
- **闪烁动画**：导航跳转时目标消息闪烁 3 次高亮（CSS @keyframes，脱离 React 渲染周期）
- **搜索高亮**：匹配文本在消息内容、工具参数、diff 内容、Raw JSON 中均高亮显示
- **自动展开**：搜索跳转到折叠内容时自动展开（thinking、tool_use、tool_result、compact_summary、system）
- **性能优化**：searchAutoExpandId 从 useMemo 派生，MessageItem React.memo 自定义比较器，仅 0~2 条消息重渲染

#### 搜索高亮系统

- **HighlightedText 共享组件**：支持 3 种匹配模式（字面量大小写敏感/不敏感、正则表达式）
- **SearchHighlight 类型**：`{ query, caseSensitive, useRegex }` 穿透到所有渲染组件
- **工具块高亮**：ToolUseRenderer 中工具名称、参数、diff 行、Raw JSON 均支持搜索高亮
- **工具结果高亮**：ToolResultRenderer 中工具名称、参数、结果内容均支持搜索高亮

#### 统一折叠系统

- **useCollapsible hook**：提取为独立 hook（`src/hooks/useCollapsible.ts`），统一管理所有可折叠组件
  - 支持搜索导航自动展开（searchAutoExpand 信号）
  - 导航离开时自动收起（仅自动展开的，手动展开不受影响）
  - 使用 `useEffect`（非渲染阶段状态派生）确保 React.memo 下行为可靠
- **适用组件**：CompactSummaryBlock、SystemMessageBlock、ThinkingBlock、ToolUseRenderer（diff 折叠）、ToolResultRenderer
- **Raw 面板自动展开**：非 Write/Edit 工具（如 AskUserQuestion）搜索导航时自动展开 Raw JSON 面板

#### 视口驱动渐进式渲染

- **useProgressiveRender hook**：基于 IntersectionObserver 的虚拟化渲染
- 仅渲染视口内及附近的消息，视口外显示占位符
- 300+ 消息会话首屏渲染时间从秒级降到毫秒级

#### Markdown 渲染

- **MarkdownRenderer 组件**：基于 react-markdown + remark-gfm
- **rehypeHighlight 插件**：自定义 rehype 插件，支持 190+ 编程语言语法高亮
- 代码块带行号显示

#### 工具渲染增强

- **ToolUseRenderer 组件**：紧凑 `Tool(args)` 格式 + Raw JSON 切换 + diff 预览
  - Write 工具：绿色新增行
  - Edit 工具：红色删除行 + 绿色新增行
  - 超过 5 行自动折叠
- **ToolResultRenderer 组件**：折叠式结果展示 + 打开文件位置按钮
- **toolFormatter 工具**：格式化 15+ 种工具参数为紧凑显示（Read、Write、Edit、Bash、Glob、Grep、Task、LSP、AskUserQuestion、WebSearch、WebFetch、NotebookEdit、TodoWrite 等）

#### 系统消息识别

- **精确分类**：识别 skill、plan、plan_execution、compact_summary 等系统消息子类型
- **计划执行消息**：支持会话跳转按钮，点击可导航到关联会话
- **压缩摘要消息**：默认折叠，显示分割线"--已压缩--"

### 修复

- **编辑消息保存后不再跳到底部**：保存编辑后保持当前滚动位置
- **进入会话不在底部及滚动条异常**：修复首次加载会话时的滚动定位
- **计划消息标题匹配**：放宽为一级或二级标题均可匹配
- **计划消息跳转按钮**：始终显示，不再条件隐藏
- **搜索闪烁动画 CSS 冲突**：隔离闪烁动画 CSS，避免与其他动画冲突
- **animationend 事件冒泡**：阻止子元素动画结束事件冒泡导致闪烁提前终止
- **搜索导航闪烁丢失**：闪烁动画脱离 React 渲染周期，改用直接 DOM 操作
- **搜索导航改用 instant 滚动**：确保闪烁动画在定位完成后播放
- **搜索导航定位到匹配位置**：展开折叠内容后滚动到实际 `<mark>` 元素而非消息容器
- **非 Write/Edit 工具搜索展开**：AskUserQuestion 等工具搜索导航时自动展开 Raw 面板

### 性能优化

- **全量计算迁移至 Rust 后端**：消息解析、分类、转换、Token 统计全部在 Rust 端完成
- **React.memo 三层防护**：MessageBlockList、MessageContentRenderer、MessageItem 均使用 memo
- **MessageItem 自定义比较器**：搜索导航时仅 0~2 条消息重渲染，其余 298+ 条跳过
- **searchAutoExpandId 派生值**：从 useState 改为 useMemo，消除二次重渲染
- **消除三大前端渲染瓶颈**：消息列表虚拟化、memo 优化、状态派生

### 技术变更

- Rust edition 从 2021 升级到 2024
- Rust 后端从 2 个文件（main.rs + lib.rs）扩展为完整 MVC 架构（~3000 行）
- 前端新增依赖：`react-markdown`、`remark-gfm`
- 前端新增组件：NavSearchBar、ToolUseRenderer、ToolResultRenderer、HighlightedText、MarkdownRenderer
- 前端新增 hooks：useCollapsible、useProgressiveRender
- 前端新增 utils：toolFormatter、messageTransform、rehypeHighlight
- 前端数据层从直接调用 Tauri 插件改为调用 Rust 自定义 Commands（通过 `invoke()`）

---

## [2.0.1-beta.1] — 2025

### 新增

#### UI 重构：动画与图标系统

- 引入 **motion/react**（Framer Motion）作为动画引擎，替代原有的 CSS 动画
  - 侧边栏展开/折叠带有宽度 + 透明度过渡
  - 项目展开/折叠带有高度 + 透明度过渡，会话列表使用交错动画（staggered animation）
  - 设置面板使用缩放 + 位移入场/退场动画，标签页切换带有左滑/右滑过渡
  - 消息卡片使用淡入 + 上移入场动画
  - 按钮普遍添加 `whileHover` 缩放和 `whileTap` 回弹效果
- 引入 **lucide-react** 图标库，替代所有内联 SVG 图标
  - 使用语义化图标组件（Settings、Search、Trash2、Filter、Download 等），提升可读性和可维护性
- 设置齿轮图标悬停时旋转 180°（弹簧动画，`stiffness: 300, damping: 15`）
- 主题切换图标悬停时旋转 180°，使用 motion variant 传播机制驱动子元素动画

#### 消息内容渲染系统

- 新增 **MessageBlockList** 组件：消息内容块列表入口，处理 string / MessageContent[] 两种格式
- 新增 **MessageContentRenderer** 组件：按 type 分类渲染 5 种内容块
  - `text`：预格式化文本，保留空白符并自动换行
  - `tool_use`：蓝色左边框可折叠面板，显示工具名称和 JSON 参数
  - `tool_result`：绿色左边框（错误时红色），支持嵌套内容递归渲染
  - `thinking`：紫色虚线左边框，默认折叠，斜体淡色显示
  - `image`：Base64 data URI 内联图片渲染

#### 侧边栏增强

- **拖动调整宽度**：侧边栏右边缘可拖动调整宽度（绝对定位手柄，`z-20`）
  - 拖动时禁用过渡动画，确保实时跟手
  - 使用 `useRef` 追踪拖动状态，避免全局事件监听器中的闭包陈旧问题
- **自动折叠**：拖动宽度低于 160px 后松开鼠标自动折叠，低于 220px 回弹到最小宽度
- **折叠/展开**：侧边栏折叠时在 ChatView 顶部显示展开按钮
- **渐变背景**：天蓝色到淡紫色的线性渐变（`#eef6ff → #f3eeff`，暗色模式 `#0f1a2e → #1a1530`）
- **渐变标题**：「Claude Code Reader」标题使用紫色到粉色渐变文字 + 流动动画
- **会话删除**：每个会话条目悬停时显示删除按钮
- 底部统计信息栏显示项目总数和会话总数

#### 聊天视图增强

- **多选模式**：支持复选框选择、全选/取消全选、批量删除已选消息
- **消息搜索**：工具栏搜索框支持按消息文本模糊过滤（大小写不敏感）
- **自定义过滤器下拉菜单**：替代原生 `<select>`，带有动画和图标
- **导出功能**：下拉菜单支持 Markdown 和 JSON 两种格式导出（使用 Tauri 文件保存对话框）
- **Token 统计汇总**：工具栏显示整个会话的输入/输出/缓存 Token 总计
- **动画空状态**：未选择会话时显示呼吸 + 摇摆动画的聊天气泡图标 + 渐变文字

#### 设置面板增强

- **三模式主题切换**：分段控制按钮（浅色 Sun / 自动 SunMoon / 深色 Moon），使用 `layoutId` 实现滑动指示器动画
- **固定面板高度**：`h-[80vh]`，内容区垂直滚动，外层 `overflow-hidden` 确保圆角裁剪正确
- **标签页滑动指示条**：活动标签下方的紫色指示条使用 `layoutId` 实现跨标签滑动动画

#### 环境配置切换器增强

- 下拉菜单宽度改为 `w-full`，与触发按钮宽度保持一致

#### 主题与样式

- **紫色主题滚动条**：全局自定义滚动条使用紫色调（`#c4b5fd` / `#a78bfa`，暗色 `#4c3a8a` / `#7c5cbf`）
- **渐变加载旋转器**：紫粉渐变替代单色 border 旋转器
- **内容块样式**：工具调用、工具结果、思考过程使用独立配色的左边框卡片样式

### 修复

#### 侧边栏被长内容撑开

- **根因**：ChatView 主视图根 div 缺少 `min-w-0`，flex 子项默认 `min-width: auto` 导致内容的固有最小宽度撑开整个布局
- **修复**：在 ChatView 两个返回路径的根 div 均添加 `min-w-0`；Sidebar 的 motion.div 设置 `flexShrink: 0, minWidth: 0, overflow: hidden`

#### EnvSwitcher 下拉菜单被遮挡

- **根因**：侧边栏头部区域使用了 `overflow-hidden`，裁剪了下拉菜单
- **修复**：将头部改为 `relative z-10`，不使用 `overflow-hidden`

#### 设置面板圆角穿透

- **根因**：内部 `bg-card` 元素的直角矩形在 `rounded-xl` 父容器的圆角处穿透可见
- **修复**：面板主体添加 `overflow-hidden`

#### 搜索框焦点环残影

- **根因**：`focus:ring-2` 使用 `box-shadow` 实现，Chromium WebView 失焦后 `box-shadow` 未及时重绘，在底部留下一条紫色细线
- **修复**：将 `focus:ring-2 focus:ring-ring` 改为 `focus:border-ring`（基于 border-color，不使用 box-shadow）

#### 内容块溢出

- **修复**：CSS 中 `.tool-use-block`、`.tool-result-block`、`.thinking-block` 均添加 `overflow: hidden`，防止内容撑开容器

### 技术变更

- 前端新增依赖：`motion`（motion/react）、`lucide-react`
- App.tsx 新增 5 个状态变量（`selectedMessages`、`selectionMode`、`sidebarCollapsed`、`sidebarWidth`、`isResizingSidebar`）和 1 个 ref（`isResizingRef`）
- App.tsx 新增 8 个 `useCallback` 回调和 1 个 `useEffect`（拖动事件监听）
- 组件总数从 4 个增加到 6 个（新增 MessageBlockList、MessageContentRenderer）
- ChatView Props 从 5 个扩展到 14 个
- Sidebar Props 从 8 个扩展到 14 个

---

## [2.0.1-beta.1] — 2025

### 新增

#### 核心功能
- 基于 Tauri 2.9.5 构建的跨平台桌面应用（React 19 + Rust）
- 自动检测并读取 `~/.claude/` 目录下的 Claude Code 数据
- 项目列表浏览：解码 Claude Code 的编码路径名，按最近活跃时间排序显示
- 会话列表浏览：每个项目下的 `.jsonl` 会话文件按修改时间排序展示
- 会话消息查看：解析并渲染 user/assistant 类型的聊天消息
- 会话消息编辑：内联编辑消息文本内容，支持字符串和数组两种 content 格式的保持
- 会话消息删除：单条消息删除，操作前弹出确认对话框
- 消息复制到剪贴板：一键提取消息文本并写入系统剪贴板
- 消息过滤：按角色筛选（全部消息 / 仅用户 / 仅助手）
- Token 使用量显示：展示每条助手消息的输入/输出 Token 数

#### 环境配置管理
- 环境配置（EnvProfile）系统：独立于 Claude Code 原生 settings 的配置管理
- 创建环境配置：将当前 `settings.json` 中的环境变量保存为命名配置
- 切换环境配置：一键应用已保存的配置到 `settings.json`
- 编辑环境配置：通过设置面板修改配置中的环境变量
- 删除环境配置：移除不再需要的配置
- 配置数据存储在 `~/.mo/CCR/env-profiles.json`，与 Claude Code 数据目录分离

#### 设置面板
- 常规设置：主题切换、默认模型配置、Claude 数据路径显示
- 环境变量管理：添加、编辑、删除环境变量，敏感字段（含 token/key）自动隐藏
- 权限查看：只读展示 Claude Code 的 allow/deny 权限规则
- 关于页面：显示应用版本、开发者信息和开源仓库链接

#### 主题与界面
- 浅色 / 深色 / 跟随系统三种主题模式
- 基于 TailwindCSS 4 的 CSS 变量主题系统
- 项目和会话搜索过滤
- 消息列表自动滚动到最新消息
- 加载状态和错误状态的友好提示界面

#### 分发与安装
- NPM 全局安装支持：`npm install -g claude-code-reader`
- `ccr` CLI 命令：以 detached 模式启动桌面应用
- postinstall 脚本自动从 GitHub Releases 下载平台对应的二进制文件
- 下载进度显示和已安装检测（幂等）

#### CI/CD 与多平台支持
- GitHub Actions 自动化构建与发布流水线，支持三种触发方式：
  - **Tag 推送** (`v*`)：构建并发布正式版 Release + NPM 发布
  - **分支推送**（任意分支）：自动构建并发布预发布版 Pre-release（不发布到 NPM）
  - **手动触发** (`workflow_dispatch`)：指定 Tag 补发历史版本，用于修复发布失败等场景
- 并发控制：同一分支/标签的多次推送自动取消旧构建，仅保留最新一次
- `prepare` Job 统一处理发布类型判断、版本信息提取和变更日志生成
- 自动变更日志：从上一个 `v*` tag 到 HEAD 的 Git 提交历史自动生成
- 4 平台/架构并行构建矩阵：
  - Windows x64（NSIS 安装包 + 独立 .exe）
  - macOS ARM64（.app.tar.gz + .dmg）
  - macOS x86_64（.app.tar.gz + .dmg）
  - Linux amd64（.AppImage + .deb）
- 正式版构建完成后自动发布到 NPM（beta/alpha 版使用 `--tag beta`）
- 预发布版 Release 包含分支、提交 SHA、构建时间等元信息
- 正式版 Release 包含自动生成的更新内容和 GitHub Release Notes

#### 技术架构
- 前端：React 19 + TypeScript 5.9 + Vite 7 + TailwindCSS 4
- 原生层：Rust (edition 2021) + Tauri 2.9.5
- Tauri 插件：plugin-fs（文件操作）、plugin-dialog（系统对话框）、plugin-shell（Shell 操作）、plugin-log（调试日志）
- 所有文件操作通过 `@tauri-apps/plugin-fs` 在前端完成，无自定义 Tauri Command

### 已知限制

- 权限管理为只读显示，不支持编辑
- 不显示 agent-*.jsonl 子任务会话文件
- 无分页加载，大型会话可能影响性能
- 主题偏好不持久化，重启后重置为跟随系统
- 添加环境变量和删除确认使用浏览器原生对话框
- 无撤销/重做功能
- CSP 安全策略已禁用
- 详见 [已知问题与限制](known-issues.md)
