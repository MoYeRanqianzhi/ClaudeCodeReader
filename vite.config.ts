/**
 * @file Vite 构建工具配置文件
 *
 * Vite 是 ClaudeCodeReader 前端部分的开发服务器与构建工具。
 * 本配置文件定义了 Vite 的插件、构建选项等核心设置。
 *
 * 在 Tauri 桌面应用中，Vite 负责：
 * - 开发模式下提供热模块替换（HMR）的开发服务器
 * - 生产模式下将前端代码打包为优化后的静态资源
 *
 * 配置参考：https://vite.dev/config/
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // React 插件：为 Vite 提供 React 支持，包括：
    // - JSX/TSX 转换（通过 Babel 或 SWC）
    // - React Fast Refresh（开发模式下的组件热更新）
    react(),
  ],
})
