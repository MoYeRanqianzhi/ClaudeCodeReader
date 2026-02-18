# Rust 后端开发指南

本文档详细说明 ClaudeCodeReader (CCR) 项目 Rust 后端的架构设计、文件结构、依赖配置、安全权限以及扩展方式。

---

## 架构说明

CCR 的后端采用 **极简设计** 理念：

- **零自定义 Tauri Command**：Rust 端没有注册任何 `#[tauri::command]`，不暴露自定义的 IPC 接口。
- **所有业务逻辑在前端实现**：文件读写、数据解析、会话管理等全部由前端 TypeScript 通过 Tauri 插件 API 直接完成。
- **Rust 端职责单一**：仅负责应用启动、窗口创建和插件初始化。

这种设计的优势在于：
1. 降低了前后端之间的耦合度，前端可以独立迭代业务逻辑。
2. 减少了 Rust 编译时间，大多数改动只需重新构建前端。
3. 充分利用 Tauri 插件生态，避免重复造轮子。

---

## 文件说明

### `src/main.rs` — Windows 子系统配置 + 入口点

```rust
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  app_lib::run();
}
```

- `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`：条件编译属性，在 Release 模式下将 Windows 子系统设为 `"windows"`，从而隐藏控制台窗口。在 Debug 模式下保留控制台窗口便于查看日志输出。
- `main()` 函数仅调用 `app_lib::run()`，将实际初始化逻辑委托给 `lib.rs`。

### `src/lib.rs` — Tauri Builder 配置与插件注册

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())       // 文件系统访问插件
    .plugin(tauri_plugin_dialog::init())   // 系统对话框插件
    .plugin(tauri_plugin_shell::init())    // Shell 执行插件
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```

- `#[cfg_attr(mobile, tauri::mobile_entry_point)]`：为移动端编译预留的入口点标注（当前项目仅面向桌面端）。
- 4 个插件通过 `.plugin()` 链式注册。
- 日志插件 (`tauri_plugin_log`) 仅在 Debug 模式下启用，日志级别设为 `Info`。
- `tauri::generate_context!()` 宏在编译时读取 `tauri.conf.json` 生成应用上下文。

### `build.rs` — Tauri 构建代码生成

```rust
fn main() {
  tauri_build::build()
}
```

- 这是 Tauri 的标准构建脚本，负责在编译前生成必要的平台胶水代码（如 Windows 的资源文件、图标嵌入等）。
- 不需要修改此文件，除非有特殊的构建需求。

---

## Rust 依赖列表

以下为 `Cargo.toml` 中声明的所有依赖及其用途：

### 构建依赖 (`[build-dependencies]`)

| 依赖 | 版本 | 用途 |
|------|------|------|
| `tauri-build` | 2.5.3 | Tauri 构建脚本，生成平台相关的编译产物 |

### 运行依赖 (`[dependencies]`)

| 依赖 | 版本 | 用途 |
|------|------|------|
| `tauri` | 2.9.5 | Tauri 核心框架，提供窗口管理、IPC 通信等基础能力 |
| `serde` | 1.0 (含 `derive` feature) | Rust 序列化/反序列化框架，用于数据结构转换 |
| `serde_json` | 1.0 | JSON 序列化/反序列化支持 |
| `log` | 0.4 | Rust 日志门面 (logging facade)，提供统一的日志宏 |
| `tauri-plugin-fs` | 2 | 文件系统访问插件，前端通过此插件读写本地文件 |
| `tauri-plugin-dialog` | 2 | 系统对话框插件，提供文件选择、消息提示等原生对话框 |
| `tauri-plugin-shell` | 2 | Shell 执行插件，允许前端调用系统命令 |
| `tauri-plugin-log` | 2 | 日志插件，在 Debug 模式下将日志输出到控制台 |

### 包元数据

| 字段 | 值 | 说明 |
|------|------|------|
| `name` | `claude-code-reader` | Cargo 包名称 |
| `version` | `1.1.0-rc.1` | 当前版本号 |
| `edition` | `2021` | Rust 版本 (Edition) |
| `rust-version` | `1.77.2` | 最低 Rust 工具链版本要求 |
| `license` | `MIT` | 开源许可证 |

### 库配置

```toml
[lib]
name = "app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
```

- `staticlib`：静态链接库，用于 iOS 等平台。
- `cdylib`：C 动态链接库，用于 Android 等平台。
- `rlib`：Rust 原生库，用于桌面端链接。

---

## Tauri 插件配置

### tauri-plugin-fs — 文件系统访问

**注册方式**：在 `lib.rs` 中通过 `.plugin(tauri_plugin_fs::init())` 注册。

**作用**：允许前端 TypeScript 代码通过 `@tauri-apps/plugin-fs` 模块读写本地文件系统。CCR 的所有文件操作（读取会话记录、编辑消息、保存设置等）都通过此插件实现。

**配置** (`tauri.conf.json` 中)：
```json
"plugins": {
  "fs": {
    "requireLiteralLeadingDot": false
  }
}
```
`requireLiteralLeadingDot: false` 表示在路径匹配时，不要求 `.` 开头的文件/目录名必须显式匹配。这对于访问 `~/.claude` 等隐藏目录是必要的。

### tauri-plugin-dialog — 系统对话框

**注册方式**：在 `lib.rs` 中通过 `.plugin(tauri_plugin_dialog::init())` 注册。

**作用**：提供原生系统对话框能力，包括文件/目录选择对话框、消息提示框等。CCR 中可用于用户选择 Claude 数据目录等场景。

### tauri-plugin-shell — Shell 执行

**注册方式**：在 `lib.rs` 中通过 `.plugin(tauri_plugin_shell::init())` 注册。

**作用**：允许前端调用系统 Shell 命令或打开外部链接。例如用 `shell:default` 权限打开外部 URL。

### tauri-plugin-log — 调试日志（仅 Debug 模式）

**注册方式**：在 `lib.rs` 的 `.setup()` 闭包中条件注册。

```rust
if cfg!(debug_assertions) {
  app.handle().plugin(
    tauri_plugin_log::Builder::default()
      .level(log::LevelFilter::Info)
      .build(),
  )?;
}
```

**作用**：在开发调试时将日志输出到控制台，日志级别为 `Info` 及以上。Release 构建中不会包含此插件，避免影响性能和泄露调试信息。

---

## Tauri 配置详解 (`tauri.conf.json`)

### 基本信息

```json
{
  "productName": "ClaudeCodeReader",
  "version": "1.1.0-rc.1",
  "identifier": "com.claudecodereader.app"
}
```

- `productName`：应用的显示名称，用于窗口标题、安装包名等。
- `version`：应用版本号，与 `Cargo.toml` 保持一致。
- `identifier`：应用的唯一标识符，采用反向域名格式。用于操作系统级别的应用识别。

### 构建配置

```json
"build": {
  "frontendDist": "../dist",
  "devUrl": "http://localhost:5173",
  "beforeDevCommand": "npm run dev",
  "beforeBuildCommand": "npm run build"
}
```

- `frontendDist`：前端构建产物的输出目录，相对于 `src-tauri` 目录。
- `devUrl`：开发模式下前端开发服务器的 URL（Vite 默认端口 5173）。
- `beforeDevCommand`：执行 `tauri dev` 前自动启动前端开发服务器。
- `beforeBuildCommand`：执行 `tauri build` 前自动构建前端产物。

### 窗口配置

```json
"app": {
  "windows": [
    {
      "title": "Claude Code Reader",
      "width": 1200,
      "height": 800,
      "minWidth": 800,
      "minHeight": 600,
      "resizable": true,
      "fullscreen": false,
      "center": true
    }
  ]
}
```

| 属性 | 值 | 说明 |
|------|------|------|
| `title` | "Claude Code Reader" | 窗口标题 |
| `width` / `height` | 1200 x 800 | 默认窗口尺寸（像素） |
| `minWidth` / `minHeight` | 800 x 600 | 最小窗口尺寸，防止布局错乱 |
| `resizable` | `true` | 允许用户调整窗口大小 |
| `fullscreen` | `false` | 启动时不进入全屏模式 |
| `center` | `true` | 启动时窗口居中显示 |

### 安全配置

```json
"security": {
  "csp": null
}
```

**CSP 设为 `null` 的原因**：
- CSP (Content Security Policy) 被设为 `null` 意味着禁用内容安全策略。
- CCR 是一个纯本地应用，不加载任何远程资源，所有数据来源于本地文件系统。
- Tauri 应用运行在独立的 WebView 容器中，已有进程级别的隔离。
- 禁用 CSP 简化了开发过程，避免因策略限制导致的本地文件访问问题。
- **注意**：如果未来需要加载远程资源（如 CDN 脚本、外部 API），应重新启用并配置 CSP。

### 打包配置

```json
"bundle": {
  "active": true,
  "targets": "all",
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico"
  ]
}
```

- `active: true`：启用打包功能。
- `targets: "all"`：为当前平台的所有格式生成安装包（Windows 下为 `.msi` + `.exe`，macOS 下为 `.dmg` + `.app`）。
- `icon`：各平台所需的图标文件列表。

### 插件配置

```json
"plugins": {
  "fs": {
    "requireLiteralLeadingDot": false
  }
}
```

详见上文「tauri-plugin-fs」部分的说明。

---

## 安全权限 (`capabilities/default.json`)

`capabilities/default.json` 定义了应用的安全能力 (Capabilities)，控制前端 WebView 可以调用哪些 Tauri API。

```json
{
  "identifier": "default",
  "description": "enables the default permissions",
  "windows": ["main"],
  "permissions": [...]
}
```

- `identifier: "default"`：能力集标识，Tauri 会自动应用名为 `default` 的能力集。
- `windows: ["main"]`：此能力集仅适用于主窗口。

### 权限列表

| 权限标识 | 说明 |
|---------|------|
| `core:default` | Tauri 核心默认权限，包含基本的窗口操作、事件通信等能力 |
| `fs:default` | 文件系统插件的默认权限集 |
| `fs:allow-read-dir` | 允许读取目录列表（`readDir` 操作） |
| `fs:allow-read-file` | 允许读取文件内容（`readTextFile` / `readFile` 操作） |
| `fs:allow-write-file` | 允许写入文件内容（`writeTextFile` / `writeFile` 操作） |
| `fs:allow-exists` | 允许检查文件/目录是否存在（`exists` 操作） |
| `fs:allow-stat` | 允许获取文件元数据（`stat` 操作，如修改时间、文件大小） |
| `fs:allow-home-read-recursive` | 允许递归读取用户主目录 (`~`) 下的所有文件和子目录 |
| `fs:allow-home-write-recursive` | 允许递归写入用户主目录 (`~`) 下的所有文件和子目录 |
| `dialog:default` | 对话框插件默认权限，允许打开文件选择对话框、消息对话框等 |
| `shell:default` | Shell 插件默认权限，允许打开外部 URL |

### 权限设计说明

- `fs:allow-home-read-recursive` 和 `fs:allow-home-write-recursive` 是 CCR 的核心权限，因为 Claude Code 的数据目录 (`~/.claude`) 和 CCR 的配置目录 (`~/.mo/CCR`) 都位于用户主目录下。
- 这些权限的作用范围限定在用户主目录内，不会访问系统级别的文件。
- 没有授予 `fs:allow-remove` 等危险权限，CCR 不会删除任何文件。

---

## 如何添加新的 Tauri Command

虽然当前 CCR 不使用自定义 Command，但未来可能需要将某些性能敏感的操作移至 Rust 端。以下是添加新 Command 的步骤：

### 第 1 步：在 `lib.rs` 中定义 Command 函数

```rust
/// 示例 Command：计算目录中的 JSONL 文件数量
///
/// # 参数
/// - `path`: 目标目录的绝对路径
///
/// # 返回值
/// 文件数量（u32），如果目录不存在则返回错误
#[tauri::command]
async fn count_jsonl_files(path: String) -> Result<u32, String> {
    let dir = std::path::Path::new(&path);
    if !dir.exists() {
        return Err(format!("目录不存在: {}", path));
    }

    let count = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().extension()
                .map(|ext| ext == "jsonl")
                .unwrap_or(false)
        })
        .count();

    Ok(count as u32)
}
```

### 第 2 步：注册 Command 到 Tauri Builder

在 `lib.rs` 的 `run()` 函数中添加 `.invoke_handler()`：

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![count_jsonl_files]) // 新增
    .setup(|app| {
      // ...
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

### 第 3 步：在前端调用

```typescript
import { invoke } from '@tauri-apps/api/core';

// 调用自定义 Command
const count = await invoke<number>('count_jsonl_files', {
  path: '/home/user/.claude/projects'
});
```

### 第 4 步：更新安全权限（如需要）

如果新 Command 涉及额外的系统权限，需要在 `capabilities/default.json` 中添加相应权限声明。

### 注意事项

- Command 函数名在 Rust 端使用 `snake_case`，前端调用时同样使用 `snake_case`。
- 异步 Command 使用 `async fn` 声明，Tauri 会自动在线程池中执行。
- 返回 `Result<T, String>` 类型，错误信息会传递到前端的 `catch` 中。
- 如果 Command 需要访问 Tauri 的应用状态，可以使用 `tauri::State` 参数注入。
