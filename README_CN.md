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

## 构建

```bash
npm install
npm run tauri build
```

## 许可证

MIT

## 作者

墨叶染千枝
