# ClaudeCodeReader 开发文档

本目录包含 ClaudeCodeReader (CCR) 项目的完整开发文档，面向协作开发者和 LLM 阅读。

## 文档索引

### 架构与设计

- [项目架构](architecture.md) — 技术栈、目录结构、模块关系图（含 Rust MVC 架构）、数据存储方案

### 前端开发

- [前端开发指南](frontend-guide.md) — 开发环境搭建、React 开发约定、状态管理、Tauri Commands 调用、搜索系统、自定义 Hooks、性能优化
- [组件文档](components.md) — 12 个 React 组件的 Props、State、功能描述与渲染结构

### 后端开发

- [Rust 后端开发指南](backend-guide.md) — MVC 架构、Commands/Services/Models 层、15 个 Tauri Commands、缓存系统、依赖配置

### API 与类型

- [API 参考文档](api-reference.md) — Rust Commands API、前端数据访问层函数、工具函数模块

### 构建与发布

- [构建与部署](build-deploy.md) — 本地开发、生产构建、CI/CD 流水线、版本发布流程
- [NPM 分发文档](npm-distribution.md) — NPM 包信息、安装流程、二进制下载逻辑、CLI 启动方式

### 项目管理

- [已知问题](known-issues.md) — 功能限制、设计注意事项、平台差异、近期已修复问题
- [更新日志](changelog.md) — 版本发布历史与变更记录

## 项目概览

ClaudeCodeReader 是一个基于 **Tauri 2.9.5** 的跨平台桌面应用程序，用于浏览和管理 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 的聊天会话记录与配置。

**技术栈**：React 19 + TypeScript 5.9 + Vite 7 + Tailwind CSS 4 + Rust (2024 edition) + Tauri 2

**源代码仓库**：[github.com/MoYeRanQianZhi/ClaudeCodeReader](https://github.com/MoYeRanQianZhi/ClaudeCodeReader)
