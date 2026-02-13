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

## 架构设计

### 平台专属包模式

采用与 esbuild、swc 等项目一致的成熟分发模式：为每个平台发布独立的 NPM 包（包含预编译二进制文件），主包通过 `optionalDependencies` 引用，npm 根据当前平台自动安装对应的包。

与旧版 `postinstall` 下载模式相比的优势：
- 不依赖 GitHub 网络可达性，npm 镜像即可完成安装
- 无需安装时额外网络请求，体验一致
- 支持离线安装场景（提前缓存 npm 包即可）

### 平台包清单

| NPM 包名 | `os` | `cpu` | 包含的二进制文件 |
|----------|------|-------|-----------------|
| `claude-code-reader-win32-x64` | `win32` | `x64` | `bin/ClaudeCodeReader.exe` |
| `claude-code-reader-darwin-arm64` | `darwin` | `arm64` | `bin/ClaudeCodeReader.app/` |
| `claude-code-reader-darwin-x64` | `darwin` | `x64` | `bin/ClaudeCodeReader.app/` |
| `claude-code-reader-linux-x64` | `linux` | `x64` | `bin/ClaudeCodeReader.AppImage` |

每个平台包的 `package.json` 通过 `os` 和 `cpu` 字段声明平台约束，npm 会自动跳过不匹配当前系统的 `optionalDependencies`。

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
  1. npm 下载主包到全局 node_modules
         │
         ▼
  2. npm 解析 optionalDependencies，
     检测当前操作系统 (os) 和 CPU 架构 (cpu)
         │
         ▼
  3. npm 自动安装匹配当前平台的平台包
     例如 Windows x64 → claude-code-reader-win32-x64
     不匹配的平台包被自动跳过
         │
         ▼
  4. 安装完成，二进制文件位于平台包的 bin/ 目录下
```

> **设计说明：** 由于平台包声明了 `os` 和 `cpu` 字段约束，npm 在解析 `optionalDependencies` 时会自动判断平台匹配性，不匹配的包会被静默跳过（不会报错）。这是 npm 的标准行为，无需任何 postinstall 脚本。

---

## 启动方式

### 命令行启动

```bash
ccr
```

### 启动流程

`ccr` 命令的入口文件为 `npm/bin/ccr.js`，执行以下逻辑：

1. **检测平台**：通过 `process.platform` + `process.arch` 确定当前操作系统和 CPU 架构
2. **定位平台包**：使用 `createRequire(import.meta.url)` 创建 require 函数，通过 `require.resolve('claude-code-reader-{platform}/package.json')` 定位已安装的平台包目录
3. **拼接二进制路径**：根据平台从平台包的 `bin/` 子目录中获取可执行文件路径
   - Windows：`bin/ClaudeCodeReader.exe`
   - macOS：`bin/ClaudeCodeReader.app/Contents/MacOS/ClaudeCodeReader`
   - Linux：`bin/ClaudeCodeReader.AppImage`
4. **检查文件存在性**：若二进制文件不存在，输出错误提示并退出
5. **启动桌面应用**：使用 `child_process.spawn()` 以 **detached 模式** 启动应用进程
6. **CLI 退出**：调用 `child.unref()` 解除父子进程关联，CLI 进程立即退出，桌面应用在后台独立运行

> **设计说明：** detached 模式确保 `ccr` 命令执行后终端立即返回，桌面应用不会阻塞命令行。用户关闭终端后，桌面应用仍然正常运行。

---

## 文件结构

### 主包 `claude-code-reader`

```
npm/
├── package.json            # NPM 包配置文件（包名、版本、入口、optionalDependencies）
└── bin/
    └── ccr.js              # CLI 入口脚本：通过 require.resolve 定位平台包中的二进制文件并启动
```

### 平台包 `claude-code-reader-{platform}`（由 CI 动态生成）

```
claude-code-reader-{platform}/
├── package.json            # 包含 name、version、os、cpu 等字段
└── bin/
    └── ClaudeCodeReader.*  # 平台对应的二进制文件
```

### 各文件职责

| 文件 | 职责 | 执行时机 |
|------|------|----------|
| `npm/package.json` | 定义包元数据、CLI bin 映射、optionalDependencies 平台包引用 | NPM 解析包信息时 |
| `npm/bin/ccr.js` | 作为 `ccr` 命令的入口，通过 require.resolve 定位平台包中的二进制文件并以 detached 模式启动 | 用户执行 `ccr` 命令时 |
| 平台包 `package.json` | 声明平台约束（os/cpu），确保 npm 仅在匹配的系统上安装 | NPM 解析 optionalDependencies 时 |
| 平台包 `bin/*` | 预编译的桌面应用二进制文件 | `ccr.js` 启动时读取 |

---

## 二进制文件查找逻辑

### require.resolve 定位机制

`ccr.js` 使用 `createRequire(import.meta.url)` 创建 CommonJS require 函数，然后通过 `require.resolve()` 定位平台包：

```javascript
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// 根据 process.platform 和 process.arch 确定平台包名
const key = `${process.platform}-${process.arch}`;  // 例如 'win32-x64'
const packageName = PLATFORM_PACKAGES[key];          // 例如 'claude-code-reader-win32-x64'

// 通过 require.resolve 获取平台包 package.json 的绝对路径
const packageDir = dirname(require.resolve(`${packageName}/package.json`));
// → 例如 /usr/lib/node_modules/claude-code-reader-win32-x64

// 拼接二进制文件路径
const binaryPath = join(packageDir, BINARY_PATHS[key]);
// → 例如 /usr/lib/node_modules/claude-code-reader-win32-x64/bin/ClaudeCodeReader.exe
```

### 平台映射表

| `process.platform`-`process.arch` | NPM 平台包 | 二进制文件相对路径 |
|------|-----------|-------------------|
| `win32-x64` | `claude-code-reader-win32-x64` | `bin/ClaudeCodeReader.exe` |
| `darwin-arm64` | `claude-code-reader-darwin-arm64` | `bin/ClaudeCodeReader.app/Contents/MacOS/ClaudeCodeReader` |
| `darwin-x64` | `claude-code-reader-darwin-x64` | `bin/ClaudeCodeReader.app/Contents/MacOS/ClaudeCodeReader` |
| `linux-x64` | `claude-code-reader-linux-x64` | `bin/ClaudeCodeReader.AppImage` |

### 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| 不支持的平台/架构组合 | 输出支持列表和手动下载链接，退出码 1 |
| 平台包未安装（`require.resolve` 抛出 `MODULE_NOT_FOUND`） | 提示重新安装或手动下载，退出码 1 |
| 二进制文件不存在（平台包不完整） | 输出预期路径和手动下载链接，退出码 1 |

---

## 各平台二进制文件

| 平台 | 架构 | 平台包内路径 | 备注 |
|------|------|-------------|------|
| Windows | x64 | `bin/ClaudeCodeReader.exe` | 独立可执行文件 |
| macOS | arm64 | `bin/ClaudeCodeReader.app/` | 完整的 .app 应用束目录 |
| macOS | x86_64 | `bin/ClaudeCodeReader.app/` | 完整的 .app 应用束目录 |
| Linux | amd64 | `bin/ClaudeCodeReader.AppImage` | AppImage 格式单文件可执行包 |

---

## 版本同步机制

NPM 包的版本号由 CI/CD 流水线自动管理：

1. **publish-npm** Job 从 Git 标签中提取版本号（去掉 `v` 前缀）
2. 循环为每个平台动态生成 `package.json`，写入当前版本号
3. 使用 `npm version` 更新主包 `npm/package.json` 中的版本
4. 使用 Node.js 脚本更新 `optionalDependencies` 中各平台包的版本号
5. 确保主包和所有平台包的版本号一致

> **注意：** 本地开发时 `npm/package.json` 中的 `optionalDependencies` 版本号为占位值，仅在 CI 发布时自动更新。
