# 中转抓包工具设计文档

> 创建日期：2026-03-04
> 状态：已确认，待实现

## 1. 概述

在 CCR 的"工具"下拉菜单中新增"中转抓包"功能。该功能作为 HTTP→HTTPS 反向代理，
拦截 Claude Code CLI 发出的 API 请求，提供查看、记录和修改请求/响应的能力。

## 2. 核心需求

- **中转代理**：绑定本地端口，接收 HTTP 请求，通过 HTTPS 转发到上游 Anthropic API
- **自动配置**：启动时自动修改 Claude Code 的 `ANTHROPIC_BASE_URL` 环境变量，关闭时恢复
- **三种模式**：总览模式（摘要记录）、查看模式（完整记录）、拦截模式（断点决策）
- **安全保障**：启动前备份配置、崩溃恢复、关闭前强制恢复

## 3. 技术方案

**方案：Rust 原生（hyper + reqwest）**

选择理由：
- 零外部依赖，与 Tauri 完美集成
- hyper 是 Rust 生态最成熟的 HTTP 框架
- 通过 Tauri Events 实时推送请求到前端
- 拦截模式通过 `tokio::sync::oneshot` channel 暂停请求、等待前端决策

## 4. 架构设计

### 4.1 数据流

```
Claude Code CLI
  │ ANTHROPIC_BASE_URL = http://127.0.0.1:{PORT}
  ▼
CCR Rust Proxy (hyper server)
  │ 根据模式：记录 / 拦截等待 / 直接转发
  ▼ reqwest (HTTPS)
Anthropic API (api.anthropic.com)
```

### 4.2 启动/关闭流程

**启动**：
1. 读取 `settings.json` 中的 `env.ANTHROPIC_BASE_URL`（不存在则默认 `https://api.anthropic.com`）
2. 将原始 URL 写入 `~/.mo/CCR/proxy-state.json`
3. 通过 `file_guard` 备份 `settings.json`
4. 修改 `env.ANTHROPIC_BASE_URL` = `http://127.0.0.1:{PORT}`
5. 启动 hyper HTTP 服务器

**关闭**：
1. 停止 hyper 服务器
2. 从 `proxy-state.json` 读取原始 URL
3. 恢复 `settings.json` 中的 `ANTHROPIC_BASE_URL`
4. 清除 `proxy-state.json` 的 active 标记

**崩溃恢复**（CCR 启动时检查）：
1. 读取 `proxy-state.json`
2. 若 `active == true` → 自动恢复 `ANTHROPIC_BASE_URL` 并清除状态

## 5. 工作模式

| 模式 | 行为 | 适用场景 |
|------|------|---------|
| 总览模式 | 直接转发，仅记录摘要（方法、URL、状态码、耗时、大小） | 快速了解流量 |
| 查看模式 | 直接转发，完整记录 headers 和 body | 调试查看详情 |
| 拦截模式 | 暂停请求，等待用户决策（放行/修改/丢弃/伪造） | 主动干预 |

### 5.1 拦截模式生命周期

```
请求到达 → 推送到前端 → UI 显示"待处理"
  │                         │
  │  tokio::oneshot 等待     │ 用户操作：
  │  ◄──────────────────────┤  ① 放行原样
  │                         │  ② 修改后放行
  │                         │  ③ 丢弃（返回错误）
  ▼                         │  ④ 伪造响应
根据决策执行 → 转发或返回
  │
  ▼
响应到达 → 推送到前端 → 用户可查看/修改响应
  │
  ▼
回传给 Claude Code
```

拦截超时：默认 60 秒，超时自动放行。

### 5.2 SSE 流式响应

Claude API `/v1/messages` 使用 SSE 流式返回：
- 总览/查看模式：逐 chunk 转发，同时缓冲完整响应
- 拦截模式：拦截发生在请求发送前和响应开始前，不中断流式传输

## 6. Rust 模块结构

```
src-tauri/src/services/proxy/
├── mod.rs          # 模块入口
├── server.rs       # hyper HTTP 服务器 + 请求路由
├── forwarder.rs    # reqwest HTTPS 转发 + SSE 流式处理
├── interceptor.rs  # 拦截模式：oneshot channel + 超时控制
├── recorder.rs     # 请求/响应记录（内存 Vec + 导出）
└── config_guard.rs # settings.json 备份/恢复 + 崩溃恢复
```

## 7. Tauri Commands

```rust
// 代理生命周期
start_proxy(port: Option<u16>) -> ProxyStatus
stop_proxy() -> ()
get_proxy_status() -> ProxyStatus

// 模式控制
set_proxy_mode(mode: ProxyMode) -> ()

// 拦截决策
resolve_intercept(id: u64, action: InterceptAction) -> ()

// 数据查询
get_proxy_records(offset: usize, limit: usize) -> Vec<ProxyRecord>
get_record_detail(id: u64) -> ProxyRecordDetail
clear_records() -> ()
export_records(format: String) -> String
```

## 8. Tauri Events

```rust
app.emit("proxy:request", RequestEvent { id, method, url, timestamp })
app.emit("proxy:response", ResponseEvent { id, status, duration_ms, size })
app.emit("proxy:intercept", InterceptEvent { id, method, url, headers, body })
app.emit("proxy:status", ProxyStatusEvent { running, port, mode })
```

## 9. 前端 UI

### 9.1 入口

工具下拉菜单新增"中转抓包"（Network 图标），点击切换到专用面板。

### 9.2 专用面板布局

```
┌──────────────────────────────────────────────────────┐
│ 控制栏                                                │
│ [▶ 启动/■ 停止]  模式:[总览|查看|拦截]  端口:[8080]   │
│ 状态: ● 运行中 | 已拦截 3 个请求                      │
├───────────────────────┬──────────────────────────────┤
│ 请求列表 (左侧)       │ 详情面板 (右侧)              │
│ 状态标识、方法、URL、  │ Tab: Headers / Body / Raw    │
│ 状态码、耗时           │ JSON 高亮 + 编辑             │
├───────────────────────┴──────────────────────────────┤
│ 拦截决策栏 (仅拦截模式待处理请求)                      │
│ [✓ 放行]  [✏ 修改放行]  [✗ 丢弃]  [📝 伪造响应]       │
└──────────────────────────────────────────────────────┘
```

## 10. 端口配置

- 默认自动检测可用端口（范围 8080-8099）
- 用户可在 UI 中手动设置
- 端口被占用时自动尝试下一个

## 11. 数据存储

- 仅内存存储（`Vec<ProxyRecord>`）
- 支持手动导出为 JSON 格式
- 代理停止或清空时释放内存

## 12. 新增 Cargo 依赖

```toml
hyper = { version = "1", features = ["server", "http1"] }
hyper-util = { version = "0.1", features = ["tokio"] }
http-body-util = "0.1"
reqwest = { version = "0.12", features = ["stream", "json"] }
```

## 13. 安全保障

| 场景 | 处理方式 |
|------|---------|
| 启动前 | file_guard 备份 settings.json + 写入 proxy-state.json |
| 正常关闭 | 恢复 ANTHROPIC_BASE_URL + 清除 active 标记 |
| CCR 崩溃 | 下次启动检测 proxy-state.json，自动恢复 |
| Tauri Exit 事件 | on_event(Exit) 同步恢复 |
| 端口冲突 | 自动尝试下一端口，全部占用则报错 |
| 上游超时 | 返回 502，记录错误 |
| 拦截超时 | 60 秒后自动放行 |

## 14. 超出范围（不实现）

- WebSocket 代理
- 多目标代理
- 请求过滤规则
- 历史记录持久化
- 证书管理
