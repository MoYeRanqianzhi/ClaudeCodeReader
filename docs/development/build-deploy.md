# 构建与部署文档

本文档描述 ClaudeCodeReader (CCR) 项目的本地开发环境搭建、生产构建流程、CI/CD 自动化流水线配置以及版本发布的完整步骤。

---

## 本地开发

### 前置要求

| 工具 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | 24+ | JavaScript 运行时，用于前端构建和包管理 |
| npm | 随 Node.js 安装 | 包管理器 |
| Rust | 1.77.2+ | 系统编程语言，用于 Tauri 原生层编译 |
| Tauri CLI | 2.9.6+ | Tauri 命令行工具（通过 `@tauri-apps/cli` devDependency 自动安装） |

> **Linux 额外依赖：** 在 Ubuntu 22.04 上，还需要安装以下系统库：
> ```bash
> sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
> ```

### 安装依赖

在 `claude-code-reader/` 目录下执行：

```bash
npm install
```

此命令会同时安装前端依赖（React、Vite、TailwindCSS 等）和 Tauri CLI 工具链。Rust 依赖由 Cargo 在首次构建时自动拉取。

### 开发模式命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 仅启动前端 Vite 开发服务器（端口 5173），适用于纯前端 UI 开发和调试 |
| `npm run tauri dev` | 完整 Tauri 开发模式：同时启动 Vite 开发服务器和 Tauri 原生窗口，前端支持热更新（HMR），Rust 代码变更后自动重编译 |
| `npm run lint` | 使用 ESLint 对前端 TypeScript/React 代码进行静态检查 |
| `npm run preview` | 预览 Vite 生产构建产物，用于在本地验证打包后的前端效果 |

### 开发模式工作原理

执行 `npm run tauri dev` 时，Tauri CLI 会按照 `tauri.conf.json` 中的配置依次执行以下步骤：

1. **beforeDevCommand**：运行 `npm run dev`，启动 Vite 开发服务器
2. **devUrl**：Tauri 原生窗口加载 `http://localhost:5173` 作为前端页面
3. Rust 原生层编译并启动桌面窗口
4. Debug 模式下自动启用日志插件（`tauri-plugin-log`），日志级别为 `Info`

---

## 生产构建

### 构建命令

```bash
npm run tauri build
```

### 构建流程

生产构建按以下顺序执行：

1. **TypeScript 编译**：`tsc -b` 对前端代码进行类型检查（由 `beforeBuildCommand` 中的 `npm run build` 触发）
2. **Vite 打包**：将 React 应用打包为静态资源，输出到 `dist/` 目录
3. **Rust 编译**：以 Release 模式编译 Tauri 原生层（`cargo build --release`）
4. **Tauri 打包**：将前端静态资源嵌入原生二进制文件，并按目标平台生成安装包

### 构建产物位置

- **原生二进制文件**：`src-tauri/target/release/`
- **平台安装包**：`src-tauri/target/release/bundle/`
  - Windows：`nsis/` 目录下的 `.exe` 安装程序
  - macOS：`macos/` 目录下的 `.app` 应用包，以及 `dmg/` 目录下的 `.dmg` 磁盘映像
  - Linux：`appimage/` 目录下的 `.AppImage` 文件，以及 `deb/` 目录下的 `.deb` 包

---

## CI/CD 流水线（GitHub Actions）

CI/CD 配置文件位于 `.github/workflows/release.yml`，实现了从创建发布、多平台构建到 NPM 发布的全自动化流程。

### 触发条件

工作流支持三种触发方式：

| 触发方式 | 条件 | 发布类型 | 说明 |
|----------|------|----------|------|
| Tag 推送 | 推送 `v*` 格式标签 | 正式发布 (Release) | 构建全平台产物 + 发布到 NPM |
| 分支推送 | 推送到任意分支 | 预发布 (Pre-release) | 构建全平台产物，不发布到 NPM |
| 手动触发 | `workflow_dispatch` 指定 Tag | 正式发布 (Release) | 补发历史版本，用于修复发布失败 |

#### 并发控制

同一分支/标签上的多次推送只保留最新一次构建，旧的运行会被自动取消，避免浪费 CI 资源。

### Job 1: prepare

| 项目 | 详情 |
|------|------|
| 运行环境 | `ubuntu-latest` |
| 主要操作 | 判断发布类型、提取版本信息、生成变更日志 |
| 版本提取 | 从 `package.json` 读取 `version` 字段 |
| 变更日志 | 从上一个 `v*` tag 到 HEAD 的提交列表 |

该 Job 负责所有元数据计算，通过 `outputs` 将以下信息传递给下游 Job：

| 输出 | 说明 | 正式发布示例 | 预发布示例 |
|------|------|-------------|-----------|
| `is_release` | 是否正式发布 | `true` | `false` |
| `tag_name` | Release tag | `v0.2.0` | `build-abc1234` |
| `release_name` | Release 显示名称 | `ClaudeCodeReader 0.2.0` | `Pre-release 0.1.0-beta.4+build.20260212120000` |
| `timestamp` | 构建时间 (CST) | — | `20260212120000` |
| `app_version` | 应用版本号 | `0.2.0` | `0.1.0-beta.4` |
| `changelog` | 变更日志 | 提交列表 | 提交列表 |

### Job 2: create-release

| 项目 | 详情 |
|------|------|
| 依赖 | `prepare` |
| 运行环境 | `ubuntu-latest` |
| 主要操作 | 创建 GitHub Release |
| 输出 | `release_id`，供 `build-tauri` Job 上传产物 |

根据 `prepare` 的判断结果，分别创建正式版或预发布版 Release：

- **正式版**：启用自动生成 Release Notes，包含自定义变更日志，标记为 `make_latest: true`
- **预发布版**：包含分支、提交 SHA、构建时间等元信息表格，以及本次提交内容和变更记录

### Job 3: build-tauri

依赖 `prepare` 和 `create-release` Job 完成后执行。使用策略矩阵（`matrix`）实现 4 个平台/架构的并行构建：

| 平台 | 运行环境 | Rust Target | 构建参数 | 额外步骤 |
|------|----------|-------------|----------|----------|
| macOS ARM64 | `macos-latest` | `aarch64-apple-darwin` | `--target aarch64-apple-darwin` | 打包 `.app.tar.gz` 并上传 |
| macOS x86_64 | `macos-latest` | `x86_64-apple-darwin` | `--target x86_64-apple-darwin` | 打包 `.app.tar.gz` 并上传 |
| Ubuntu (amd64) | `ubuntu-22.04` | 默认 | 无 | 安装系统依赖库 |
| Windows (x64) | `windows-latest` | 默认 | `--bundles nsis` | 复制 `.exe` 并上传独立可执行文件 |

每个矩阵任务执行以下步骤：
1. 检出代码
2. 设置 Node.js 24 和 Rust stable 工具链
3. 安装系统依赖（仅 Ubuntu）
4. `npm ci` 安装前端依赖
5. 使用 `tauri-apps/tauri-action@v0` 执行构建并将产物上传到 GitHub Release
6. 上传额外的平台专属二进制文件（Windows `.exe`、macOS `.app.tar.gz`）

### Job 4: publish-npm

| 项目 | 详情 |
|------|------|
| 依赖 | `prepare` + `build-tauri` |
| 执行条件 | 仅正式发布时执行（`is_release == 'true'`） |
| 运行环境 | `ubuntu-latest` |

> **注意：** 预发布版本不会发布到 NPM，避免污染包版本。用户只能从 GitHub Release 下载预发布构建产物。

| 步骤 | 说明 |
|------|------|
| 更新版本号 | 从 Git 标签提取版本号，写入 `npm/package.json` |
| 更新 postinstall 版本 | 使用 `sed` 替换 `postinstall.js` 中的 `VERSION` 常量 |
| 修复 package.json | `npm pkg fix` 确保 package.json 规范 |
| 发布 | beta/alpha 版本使用 `--tag beta` 标签发布，正式版直接发布 |

发布认证使用 `NPM_TOKEN` Secret。

---

## 发布流程

### 正式版发布（手动步骤）

以发布 `v0.2.0` 为例：

#### 第 1 步：更新版本号

需要同步更新以下 **4 个文件** 中的版本号：

| 文件路径 | 字段 |
|----------|------|
| `claude-code-reader/package.json` | `"version"` |
| `claude-code-reader/src-tauri/Cargo.toml` | `version` |
| `claude-code-reader/src-tauri/tauri.conf.json` | `"version"` |
| `claude-code-reader/npm/package.json` | `"version"` |

> **注意：** `npm/scripts/postinstall.js` 中的 `VERSION` 常量由 CI 自动更新，无需手动修改。

#### 第 2 步：提交并打标签

```bash
git add -A
git commit -m "release: v0.2.0"
git tag v0.2.0
```

#### 第 3 步：推送触发自动构建

```bash
git push origin main --tags
```

推送标签后，GitHub Actions 将自动执行完整的构建和发布流程（创建 Release → 多平台构建 → NPM 发布）。

### 预发布（自动触发）

向任意分支推送代码时，工作流会自动构建并创建 Pre-release：

- **触发条件**：`git push`（任意分支）
- **Release tag**：`build-{short_sha}`（7 位提交哈希）
- **Release name**：`Pre-release {version}+build.{timestamp}`
- **产物**：与正式版相同的全平台构建产物
- **NPM**：不发布到 NPM
- **Release body**：包含分支、提交 SHA、构建时间信息表格，以及本次提交内容和变更记录

> **注意：** 同一分支的多次推送会自动取消旧的构建，只保留最新一次。

### 手动补发历史版本

当某次发布的 CI 失败或需要重新构建历史版本时，可通过 `workflow_dispatch` 手动触发：

1. 前往仓库 GitHub Actions 页面
2. 选择 "Build & Release" 工作流
3. 点击 "Run workflow"
4. 输入要补发的 Tag 名称（例如 `v0.1.0-beta.4`）
5. 点击确认，工作流将以该 Tag 的代码为基准执行完整的构建和发布

---

## 构建产物清单

每个版本发布后，GitHub Releases 中包含以下文件：

| 平台 | 文件名格式 | 说明 |
|------|-----------|------|
| Windows | `ClaudeCodeReader_{VERSION}_x64-setup.nsis.exe` | NSIS 安装程序 |
| Windows | `ClaudeCodeReader_{VERSION}_x64.exe` | 独立可执行文件（免安装） |
| macOS ARM64 | `ClaudeCodeReader_{VERSION}_aarch64-apple-darwin.app.tar.gz` | Apple Silicon 应用包 |
| macOS x86_64 | `ClaudeCodeReader_{VERSION}_x86_64-apple-darwin.app.tar.gz` | Intel Mac 应用包 |
| macOS ARM64 | `ClaudeCodeReader_{VERSION}_aarch64.dmg` | Apple Silicon DMG 磁盘映像 |
| macOS x86_64 | `ClaudeCodeReader_{VERSION}_x64.dmg` | Intel Mac DMG 磁盘映像 |
| Linux | `ClaudeCodeReader_{VERSION}_amd64.AppImage` | AppImage 可执行文件 |
| Linux | `ClaudeCodeReader_{VERSION}_amd64.deb` | Debian/Ubuntu 安装包 |

> **注意：** 实际产物取决于 `tauri.conf.json` 中 `bundle.targets` 的配置（当前为 `"all"`）以及 CI 中各平台的构建参数。Windows 通过 `--bundles nsis` 限定仅生成 NSIS 安装包。

---

## 版本号管理

### 需要同步更新的 4 个位置

| 位置 | 文件 | 用途 |
|------|------|------|
| 前端应用 | `claude-code-reader/package.json` | NPM 私有包版本、Vite 构建标识 |
| Rust 后端 | `claude-code-reader/src-tauri/Cargo.toml` | Cargo crate 版本 |
| Tauri 配置 | `claude-code-reader/src-tauri/tauri.conf.json` | 应用产品版本号、安装包版本标识 |
| NPM 分发包 | `claude-code-reader/npm/package.json` | NPM 公开发布的包版本 |

### 版本号格式

项目遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/) 规范：

- **正式版**：`MAJOR.MINOR.PATCH`（例如 `1.0.0`）
- **预发布版**：`MAJOR.MINOR.PATCH-PRERELEASE`（例如 `0.1.0-beta.4`）

预发布标识符（`beta`、`alpha`）会影响：
- GitHub Release 是否标记为 prerelease
- NPM 发布时是否使用 `--tag beta`
