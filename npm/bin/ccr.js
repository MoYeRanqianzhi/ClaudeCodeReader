#!/usr/bin/env node

/**
 * @file ccr.js - ClaudeCodeReader CLI 入口脚本
 * @description 通过 `npm install -g claude-code-reader` 安装后，
 * 用户可以在终端运行 `ccr` 命令来启动桌面应用。
 *
 * 此脚本采用平台专属包（optionalDependencies）架构：
 * npm 在安装主包时会根据当前操作系统和 CPU 架构，自动安装对应的平台包
 * （如 claude-code-reader-win32-x64），平台包中包含预编译的二进制文件。
 * 本脚本通过 require.resolve() 定位已安装的平台包目录，
 * 从中找到对应的可执行文件路径，然后以独立进程方式启动 GUI 应用程序。
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { createRequire } from 'module';

/*
 * 创建 CommonJS 风格的 require 函数。
 * 在 ES Module 中无法直接使用 require()，需要通过 createRequire() 创建一个
 * 基于当前模块 URL 的 require 函数，用于调用 require.resolve() 定位平台包。
 */
const require = createRequire(import.meta.url);

/* ---------------------------------------------------------------------------
   平台包映射表
   键为 `${process.platform}-${process.arch}` 的组合，值为对应的 NPM 平台包名。
   npm 安装主包时会根据平台包 package.json 中的 os/cpu 字段声明，
   自动选择并安装与当前系统匹配的 optionalDependency。
   --------------------------------------------------------------------------- */
const PLATFORM_PACKAGES = {
  'win32-x64': 'claude-code-reader-win32-x64',
  'darwin-arm64': 'claude-code-reader-darwin-arm64',
  'darwin-x64': 'claude-code-reader-darwin-x64',
  'linux-x64': 'claude-code-reader-linux-x64'
};

/* ---------------------------------------------------------------------------
   二进制文件名映射表
   每个平台包的 bin/ 目录下存放的可执行文件名称不同：
   - Windows:  直接使用 .exe 可执行文件
   - macOS:    使用 .app 应用束内部的实际可执行文件（Contents/MacOS/ 目录下）
   - Linux:    使用 AppImage 格式的单文件可执行包
   --------------------------------------------------------------------------- */
const BINARY_PATHS = {
  'win32-x64': join('bin', 'ClaudeCodeReader.exe'),
  'darwin-arm64': join('bin', 'ClaudeCodeReader.app', 'Contents', 'MacOS', 'ClaudeCodeReader'),
  'darwin-x64': join('bin', 'ClaudeCodeReader.app', 'Contents', 'MacOS', 'ClaudeCodeReader'),
  'linux-x64': join('bin', 'ClaudeCodeReader.AppImage')
};

/* 检测当前运行的操作系统平台和 CPU 架构 */
const platformKey = `${process.platform}-${process.arch}`;

/* 检查当前平台是否在支持列表中 */
const packageName = PLATFORM_PACKAGES[platformKey];
if (!packageName) {
  console.error(`Unsupported platform: ${process.platform} ${process.arch}`);
  console.error('Supported platforms: win32-x64, darwin-arm64, darwin-x64, linux-x64');
  console.error('Please download manually from: https://github.com/MoYeRanQianZhi/ClaudeCodeReader/releases');
  process.exit(1);
}

/*
 * 通过 require.resolve() 定位已安装的平台包目录。
 * require.resolve(`${packageName}/package.json`) 会返回平台包 package.json 的绝对路径，
 * 对其取 dirname() 即可获得平台包的根目录，再拼接 bin/ 下的二进制文件相对路径。
 *
 * 如果平台包未安装（如网络问题导致 optionalDependency 安装失败），
 * require.resolve() 会抛出 MODULE_NOT_FOUND 错误，在 catch 中给出友好提示。
 */
let binaryPath;
try {
  const packageDir = dirname(require.resolve(`${packageName}/package.json`));
  binaryPath = join(packageDir, BINARY_PATHS[platformKey]);
} catch (error) {
  console.error(`Failed to locate platform package: ${packageName}`);
  console.error('The platform-specific binary package may not have been installed correctly.');
  console.error('');
  console.error('Try reinstalling:');
  console.error('  npm install -g claude-code-reader');
  console.error('');
  console.error('Or download manually from: https://github.com/MoYeRanQianZhi/ClaudeCodeReader/releases');
  process.exit(1);
}

/*
 * 检查二进制文件是否实际存在于平台包目录中。
 * 虽然平台包已安装，但如果包内容不完整（如发布时遗漏文件），
 * 二进制文件可能不存在，此时给出明确的错误提示。
 */
if (!existsSync(binaryPath)) {
  console.error('Claude Code Reader binary not found in platform package.');
  console.error(`Expected path: ${binaryPath}`);
  console.error('');
  console.error('Try reinstalling:');
  console.error('  npm install -g claude-code-reader');
  console.error('');
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
