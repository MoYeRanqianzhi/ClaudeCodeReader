# NPM 分发文档

本文档描述 ClaudeCodeReader (CCR) 通过 NPM 分发桌面应用的完整机制，包括包信息、安装流程、启动方式、平台适配逻辑以及错误处理策略。

---

## 包信息

| 项目 | 值 |
|------|-----|
| 包名 | `claude-code-reader` |
| CLI 命令 | `ccr` |
| 仓库 | [github.com/MoYeRanQianZhi/ClaudeCodeReader](https://github.com/MoYeRanQianZhi/ClaudeCodeReader) |
| 许可证 | MIT |
| Node.js 版本要求 | >= 16.0.0 |
| 模块类型 | ESM (`"type": "module"`) |
| 支持平台 | `win32`、`darwin`（arm64 / x86_64）、`linux`（amd64） |

---

## 安装方式

### 全局安装（推荐）

```bash
npm install -g claude-code-reader
```

安装完成后，可在终端中直接运行 `ccr` 命令启动桌面应用。

### 使用 beta 版本

```bash
npm install -g claude-code-reader@beta
```

---

## 安装流程详解

执行 `npm install -g claude-code-reader` 后，完整的安装流程如下：

```
npm install -g claude-code-reader
         │
         ▼
  1. npm 下载包到全局 node_modules
         │
         ▼
  2. 触发 postinstall 生命周期脚本
     (npm/scripts/postinstall.js)
         │
         ▼
  3. 检测当前操作系统 (process.platform)
     和 CPU 架构 (process.arch)
         │
         ▼
  4. 检查是否已安装（幂等性检查）
     ├─ 已安装 → 输出提示，跳过下载
     └─ 未安装 → 继续
         │
         ▼
  5. 构造 GitHub Releases 下载 URL
     拼接版本号和平台标识
         │
         ▼
  6. 通过 HTTPS 下载二进制文件
     处理 301/302 重定向
     显示下载进度百分比
         │
         ▼
  7. 平台特定后处理
     ├─ macOS: tar -xzf 解压 .app.tar.gz，删除压缩包
     ├─ Linux: chmod 0o755 设置可执行权限
     └─ Windows: 无额外处理
         │
         ▼
  8. 安装完成，输出成功提示
```

---

## 启动方式

### 命令行启动

```bash
ccr
```

### 启动流程

`ccr` 命令的入口文件为 `npm/bin/ccr.js`，执行以下逻辑：

1. **检测平台**：通过 `process.platform` 确定当前操作系统
2. **定位二进制文件**：根据平台拼接对应的可执行文件路径
   - Windows：`bin/ClaudeCodeReader.exe`
   - macOS：`bin/ClaudeCodeReader.app/Contents/MacOS/ClaudeCodeReader`
   - Linux：`bin/ClaudeCodeReader.AppImage`
3. **检查文件存在性**：若二进制文件不存在，输出错误提示并退出
4. **启动桌面应用**：使用 `child_process.spawn()` 以 **detached 模式** 启动应用进程
5. **CLI 退出**：调用 `child.unref()` 解除父子进程关联，CLI 进程立即退出，桌面应用在后台独立运行

> **设计说明：** detached 模式确保 `ccr` 命令执行后终端立即返回，桌面应用不会阻塞命令行。用户关闭终端后，桌面应用仍然正常运行。

---

## 文件结构

```
npm/
├── package.json            # NPM 包配置文件（包名、版本、入口、生命周期脚本）
├── bin/
│   └── ccr.js              # CLI 入口脚本：检测平台、定位并启动桌面应用二进制文件
└── scripts/
    └── postinstall.js       # 安装后脚本：检测平台、从 GitHub Releases 下载对应二进制文件
```

### 各文件职责

| 文件 | 职责 | 执行时机 |
|------|------|----------|
| `package.json` | 定义包元数据、CLI bin 映射、postinstall 脚本、平台限制 | NPM 解析包信息时 |
| `bin/ccr.js` | 作为 `ccr` 命令的入口，负责定位并以 detached 模式启动桌面应用 | 用户执行 `ccr` 命令时 |
| `scripts/postinstall.js` | 在 `npm install` 后自动运行，从 GitHub Releases 下载当前平台对应的二进制文件 | `npm install` 的 postinstall 生命周期 |

---

## 下载逻辑详解

### GitHub Releases URL 构造

下载 URL 遵循以下格式：

```
https://github.com/MoYeRanQianZhi/ClaudeCodeReader/releases/download/v{VERSION}/{FILENAME}
```

各平台对应的文件名：

| 平台 | 架构 | 文件名 |
|------|------|--------|
| Windows | x64 | `ClaudeCodeReader_{VERSION}_x64.exe` |
| macOS | arm64 | `ClaudeCodeReader_{VERSION}_aarch64-apple-darwin.app.tar.gz` |
| macOS | x86_64 | `ClaudeCodeReader_{VERSION}_x86_64-apple-darwin.app.tar.gz` |
| Linux | amd64 | `ClaudeCodeReader_{VERSION}_amd64.AppImage` |

### HTTP 重定向处理

GitHub Releases 的下载链接会返回 301 或 302 重定向响应。`postinstall.js` 中的 `download()` 函数通过递归请求跟踪重定向：

```javascript
// 简化示意
const request = (url) => {
  get(url, (response) => {
    if (response.statusCode === 302 || response.statusCode === 301) {
      request(response.headers.location);  // 递归跟踪重定向
      return;
    }
    // ... 处理实际下载
  });
};
```

### 下载进度显示

通过监听 `response` 的 `data` 事件累计已下载字节数，结合 `Content-Length` 响应头计算百分比，实时输出到终端：

```
Downloading... 45.3%
```

### 已安装检测（幂等性）

在发起下载前，脚本会检查目标二进制文件是否已存在：

- **Windows/Linux**：检查 `bin/ClaudeCodeReader.exe` 或 `bin/ClaudeCodeReader.AppImage` 是否存在
- **macOS**：检查 `bin/ClaudeCodeReader.app` 目录是否存在（因为压缩包下载后会被解压并删除）

若已安装，输出 `Claude Code Reader is already installed.` 并跳过下载，保证重复安装的安全性。

### 错误处理与手动下载提示

当下载失败时（网络错误、HTTP 非 200 响应等），脚本会：

1. 删除已创建的不完整文件（`unlinkSync`）
2. 输出错误信息
3. 提供手动下载的 GitHub Releases 链接
4. 以非零退出码退出（`process.exit(1)`）

对于不支持的平台（非 win32/darwin/linux），同样输出手动下载提示。

---

## 各平台二进制文件

| 平台 | 架构 | 下载文件名 | 安装后位置 | 备注 |
|------|------|-----------|-----------|------|
| Windows | x64 | `ClaudeCodeReader_{VERSION}_x64.exe` | `bin/ClaudeCodeReader.exe` | 独立可执行文件，无需额外处理 |
| macOS | arm64 | `ClaudeCodeReader_{VERSION}_aarch64-apple-darwin.app.tar.gz` | `bin/ClaudeCodeReader.app/` | 下载后通过 `tar -xzf` 解压为 `.app` 目录，压缩包删除 |
| macOS | x86_64 | `ClaudeCodeReader_{VERSION}_x86_64-apple-darwin.app.tar.gz` | `bin/ClaudeCodeReader.app/` | 同上 |
| Linux | amd64 | `ClaudeCodeReader_{VERSION}_amd64.AppImage` | `bin/ClaudeCodeReader.AppImage` | 下载后通过 `chmod 0o755` 设置可执行权限 |

---

## 版本同步机制

NPM 包的版本号由 CI/CD 流水线自动管理：

1. **publish-npm** Job 从 Git 标签中提取版本号（去掉 `v` 前缀）
2. 使用 `npm version` 更新 `npm/package.json` 中的版本
3. 使用 `sed` 替换 `postinstall.js` 中硬编码的 `VERSION` 常量
4. 确保 postinstall 脚本下载的二进制文件版本与 NPM 包版本一致

> **注意：** 本地开发时 `postinstall.js` 中的 `VERSION` 常量为手动维护值，仅在 CI 发布时自动更新。
