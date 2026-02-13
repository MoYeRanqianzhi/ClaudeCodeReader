# 更新日志

所有版本变更记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/) 规范。

---

## [0.3.0-beta.2] — 2025

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
- 消息内容以纯文本渲染，不支持 Markdown 格式
- 不显示 agent-*.jsonl 子任务会话文件
- 无分页加载，大型会话可能影响性能
- 主题偏好不持久化，重启后重置为跟随系统
- 添加环境变量和删除确认使用浏览器原生对话框
- 无撤销/重做功能
- CSP 安全策略已禁用
- 详见 [已知问题与限制](known-issues.md)
