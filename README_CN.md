# Claude Code Reader

![](https://img.shields.io/github/license/MoYeRanQianZhi/ClaudeCodeReader?style=flat-square&color=46C018)
![](https://img.shields.io/badge/version-0.1.0--beta.1-007ACC?style=flat-square&logo=git&logoColor=white)
![](https://img.shields.io/npm/v/claude-code-reader?style=flat-square&logo=npm&logoColor=white&color=CB3837)

![](https://img.shields.io/badge/Made%20with-Rust-black?style=flat-square&logo=rust&logoColor=E05D44&color=F00056)
![](https://img.shields.io/badge/Node.js-16%2B-brightgreen?style=flat-square)
![](https://img.shields.io/github/stars/MoYeRanQianZhi/ClaudeCodeReader?style=flat-square&logo=github)

简体中文 / [English](README.md)

用于查看和管理 Claude Code 会话记录与设置的桌面应用。

> 温馨提示: 当前正在进行重构，将存在性能上的重大更新，同时步入 2.x.x 版本。

## 安装

### NPM（推荐）

```bash
npm install -g claude-code-reader
ccr
```

由于缩写 `CCR` 可能与其他项目（如 ClaudeCodeRouter）冲突，还提供了以下别名命令：

| 命令 | 说明 |
|------|------|
| `ccr` | 默认命令 |
| `cr` | 短别名 |
| `ccrr` | ClaudeCodeReader 缩写 |
| `ClaudeCR` | Claude Code Reader |
| `ClaudeCodeR` | Claude Code Reader（完整前缀） |
| `CCReader` | CC + Reader |

所有别名功能完全等价，均可启动桌面应用。

### 手动下载

从 [Releases](https://github.com/MoYeRanQianZhi/ClaudeCodeReader/releases) 下载。

## 功能

- 浏览项目和聊天记录
- 查看和编辑会话消息
- 管理环境变量
- 环境配置切换
- 亮色/暗色主题
- **一键修复** — 一键修复 Claude Code 会话中的常见问题（如 thinking 块签名过期导致 400 错误）。可扩展框架，支持四个权限档位。

## 贡献修复方案

Claude Code 的会话文件可能遇到各种问题——签名过期、格式错乱、编码异常等等。我们诚挚地邀请每一位使用者贡献你发现的问题和修复方案。无论是你踩过的坑，还是你摸索出的修复方法，你的贡献都能帮助到整个社区。

详细指南请参阅：[贡献修复方案指南](docs/development/contributing-fixers.md)

**使用 Claude Code 贡献修复代码，请将以下内容复制给你的 AI Agent（如 Claude Code）：**

```
Please git clone https://github.com/MoYeRanQianZhi/ClaudeCodeReader.git, then read docs/development/contributing-fixers.md thoroughly, make sure you fully understand the bug you want to fix and the repair approach, and contribute code following all requirements in that guide.
```

## 构建

```bash
npm install
npm run tauri build
```

## 许可证

MIT

## 作者

墨叶染千枝
