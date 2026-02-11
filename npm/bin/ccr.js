#!/usr/bin/env node

/**
 * @file ccr.js - ClaudeCodeReader CLI 入口脚本
 * @description 通过 `npm install -g claude-code-reader` 安装后，
 * 用户可以在终端运行 `ccr` 命令来启动桌面应用。
 * 此脚本根据当前操作系统平台定位已下载的二进制文件，
 * 然后以独立进程方式启动 GUI 应用程序。
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

/*
 * ESM 模块路径解析
 * 在 ES Module 中没有 CommonJS 的 __filename 和 __dirname 全局变量，
 * 需要通过 import.meta.url（当前模块的 file:// URL）手动推导。
 * fileURLToPath() 将 file:// URL 转换为系统文件路径，
 * dirname() 提取其所在目录作为 __dirname 的等价值。
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* 检测当前运行的操作系统平台（win32 / darwin / linux） */
const platform = process.platform;

let binaryPath;

/*
 * 根据操作系统平台定位对应的二进制可执行文件路径：
 * - win32 (Windows):  直接使用 .exe 可执行文件
 * - darwin (macOS):   使用 .app 应用束内部的可执行文件（Contents/MacOS/ 目录下）
 * - linux:            使用 AppImage 格式的单文件可执行包
 * 如果遇到不支持的平台，输出错误信息并以非零状态码退出。
 */
if (platform === 'win32') {
  binaryPath = join(__dirname, 'ClaudeCodeReader.exe');
} else if (platform === 'darwin') {
  binaryPath = join(__dirname, 'ClaudeCodeReader.app', 'Contents', 'MacOS', 'ClaudeCodeReader');
} else if (platform === 'linux') {
  binaryPath = join(__dirname, 'ClaudeCodeReader.AppImage');
} else {
  console.error(`Unsupported platform: ${platform}`);
  process.exit(1);
}

/*
 * 检查二进制文件是否存在。
 * 如果 postinstall 脚本未成功执行（如离线安装或网络错误），
 * 二进制文件可能不存在，此时给出手动安装的提示。
 */
if (!existsSync(binaryPath)) {
  console.error('Claude Code Reader binary not found.');
  console.error('Please run: npm run postinstall');
  console.error('Or download manually from: https://github.com/MoYeRanQianZhi/ClaudeCodeReader/releases');
  process.exit(1);
}

/*
 * 使用 spawn 启动 GUI 应用程序：
 * - process.argv.slice(2): 透传用户在 `ccr` 命令后附加的所有参数
 * - detached: true  — 让 GUI 应用作为独立进程运行，不与终端会话绑定，
 *                      关闭终端后应用仍可继续运行
 * - stdio: 'ignore' — 不继承终端的标准输入/输出/错误流，
 *                      避免 GUI 应用的日志输出干扰终端
 */
const child = spawn(binaryPath, process.argv.slice(2), {
  detached: true,
  stdio: 'ignore'
});

/*
 * child.unref() — 从 Node.js 事件循环中解除对子进程的引用。
 * 这使得 Node.js 主进程可以立即退出，无需等待 GUI 子进程结束。
 * 配合 detached: true，实现"启动即退出"的 CLI 启动器行为。
 */
child.unref();
