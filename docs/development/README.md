# ClaudeCodeReader 开发文档

本目录包含 ClaudeCodeReader (CCR) 项目的完整开发文档，面向协作开发者和 LLM 阅读。

## 文档索引

### 架构与设计

- [项目架构](architecture.md) — 技术栈、目录结构、模块关系图、数据存储方案
- [数据流文档](data-flow.md) — 应用初始化、会话浏览、消息操作、设置保存、环境配置切换的完整数据流

### 前端开发

- [前端开发指南](frontend-guide.md) — 开发环境搭建、React 开发约定、状态管理模式、Tauri API 调用方式
- [组件文档](components.md) — 5 个 React 组件的 Props、State、功能描述与渲染结构
- [样式与主题指南](styling-guide.md) — 主题系统、CSS 变量表、Tailwind CSS 使用约定、自定义样式类

### 后端开发

- [Rust 后端开发指南](backend-guide.md) — 后端架构、文件说明、插件配置、Tauri 配置详解

### API 与类型

- [API 参考文档](api-reference.md) — `claudeData.ts` 中全部导出函数的签名、参数、返回值、使用示例
- [类型定义文档](type-definitions.md) — `claude.ts` 中全部 13 个 TypeScript 接口的字段级文档

### 功能模块

- [环境配置管理](environment-management.md) — 环境配置（EnvProfile）系统的功能概述、数据存储、生命周期、UI 交互

### 构建与发布

- [构建与部署](build-deploy.md) — 本地开发、生产构建、CI/CD 流水线、版本发布流程
- [NPM 分发文档](npm-distribution.md) — NPM 包信息、安装流程、二进制下载逻辑、CLI 启动方式

### 项目管理

- [已知问题](known-issues.md) — 功能限制、设计注意事项、平台差异、UI/UX 局限
- [更新日志](changelog.md) — 版本发布历史与变更记录

## 项目概览

ClaudeCodeReader 是一个基于 **Tauri 2.9.5** 的跨平台桌面应用程序，用于浏览和管理 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 的聊天会话记录与配置。

**技术栈**：React 19 + TypeScript 5.9 + Vite 7 + Tailwind CSS 4 + Rust + Tauri 2

**源代码仓库**：[github.com/MoYeRanQianZhi/ClaudeCodeReader](https://github.com/MoYeRanQianZhi/ClaudeCodeReader)
