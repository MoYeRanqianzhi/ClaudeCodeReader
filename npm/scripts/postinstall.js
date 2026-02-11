#!/usr/bin/env node

/**
 * @file postinstall.js - ClaudeCodeReader NPM 包的安装后脚本
 * @description 在用户执行 `npm install claude-code-reader` 后自动运行。
 * 负责从 GitHub Releases 下载与当前操作系统和 CPU 架构匹配的
 * 预编译二进制文件，并将其放置在 npm/bin/ 目录下供 ccr 命令调用。
 *
 * 支持的平台：
 * - Windows (x64)     → .exe 可执行文件
 * - macOS (ARM64/x64) → .app.tar.gz 压缩包（需解压）
 * - Linux (x64)       → .AppImage 单文件可执行包
 */

import { createWriteStream, existsSync, mkdirSync, chmodSync, unlinkSync } from 'fs';
import { get } from 'https';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/* ESM 模块路径解析（参见 ccr.js 中的同名代码段说明） */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* --------------------------------------------------------------------------
   常量定义
   - VERSION:     当前发布版本号，CI/CD 流水线会通过 sed 命令自动替换此值
   - GITHUB_REPO: GitHub 仓库路径，用于拼接下载 URL
   - BASE_URL:    GitHub Releases 下载的基础 URL 前缀
   -------------------------------------------------------------------------- */
const VERSION = '0.2.0-beta.1';
const GITHUB_REPO = 'MoYeRanQianZhi/ClaudeCodeReader';
const BASE_URL = `https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}`;

/* 当前操作系统平台和 CPU 架构 */
const platform = process.platform;
const arch = process.arch;

/**
 * 根据当前平台和架构获取下载信息
 * @returns {{ url: string, filename: string, extract?: boolean } | null}
 *   返回包含下载 URL、本地文件名的对象；macOS 额外标记 extract: true 表示需要解压。
 *   如果当前平台不受支持则返回 null。
 *
 * 平台/架构检测逻辑：
 * - Windows: 仅支持 x64 架构，下载 NSIS 安装器生成的独立 .exe
 * - macOS:   通过 process.arch 区分 Apple Silicon (arm64 → aarch64-apple-darwin)
 *            和 Intel (x64 → x86_64-apple-darwin)，下载对应的 .app.tar.gz 压缩包
 * - Linux:   仅支持 amd64 架构，下载 AppImage 格式的可执行文件
 */
function getDownloadInfo() {
  if (platform === 'win32') {
    return {
      url: `${BASE_URL}/ClaudeCodeReader_${VERSION}_x64.exe`,
      filename: 'ClaudeCodeReader.exe'
    };
  } else if (platform === 'darwin') {
    /* macOS 架构映射：Node.js 的 'arm64' 对应 Rust target 的 'aarch64-apple-darwin' */
    const macArch = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    return {
      url: `${BASE_URL}/ClaudeCodeReader_${VERSION}_${macArch}.app.tar.gz`,
      filename: `ClaudeCodeReader.app.tar.gz`,
      extract: true
    };
  } else if (platform === 'linux') {
    return {
      url: `${BASE_URL}/ClaudeCodeReader_${VERSION}_amd64.AppImage`,
      filename: 'ClaudeCodeReader.AppImage'
    };
  }
  return null;
}

/**
 * 从指定 URL 下载文件到本地路径
 * @param {string} url  - 远程文件的 HTTPS URL
 * @param {string} dest - 本地目标文件路径
 * @returns {Promise<void>} 下载完成后 resolve，失败时 reject 并清理已下载的文件
 *
 * 实现细节：
 * - GitHub Releases 的下载链接会返回 HTTP 301/302 重定向到 CDN 地址，
 *   因此使用递归 request() 函数跟随重定向，直到获得 200 响应。
 * - 下载过程中通过 Content-Length 头计算并实时显示百分比进度。
 * - 如果发生网络错误，通过 unlinkSync 删除不完整的目标文件以避免残留。
 */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);

    /**
     * 递归请求函数 — 处理 HTTP 重定向
     * GitHub Releases 的资源链接通常会经过一次或多次 301/302 重定向，
     * 最终指向 CDN 服务器上的实际文件。
     * @param {string} url - 当前请求的 URL（可能是重定向后的新地址）
     */
    const request = (url) => {
      get(url, (response) => {
        /* 遇到 301（永久重定向）或 302（临时重定向）时，跟随 Location 头继续请求 */
        if (response.statusCode === 302 || response.statusCode === 301) {
          request(response.headers.location);
          return;
        }

        /* 非 200 状态码视为下载失败 */
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status: ${response.statusCode}`));
          return;
        }

        /* 从响应头获取文件总大小，用于计算下载进度百分比 */
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;

        /* 每接收一个数据块，更新已下载大小并在终端同一行刷新显示进度 */
        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize) {
            const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
            process.stdout.write(`\rDownloading... ${percent}%`);
          }
        });

        /* 将响应流通过管道写入本地文件 */
        response.pipe(file);

        /* 文件写入完成后关闭文件描述符并 resolve */
        file.on('finish', () => {
          file.close();
          console.log('\nDownload complete!');
          resolve();
        });
      }).on('error', (err) => {
        /* 网络错误时清理不完整的目标文件，避免残留损坏文件 */
        unlinkSync(dest);
        reject(err);
      });
    };

    request(url);
  });
}

/**
 * 安装主流程
 * @description 协调整个下载安装过程：
 * 1. 获取当前平台的下载信息（URL、文件名）
 * 2. 检查二进制文件是否已存在（幂等安装 — 重复安装不会重复下载）
 * 3. 下载二进制文件
 * 4. macOS 平台额外执行 tar 解压，然后删除压缩包
 * 5. Linux/macOS 非压缩文件设置可执行权限（chmod 755）
 */
async function main() {
  const downloadInfo = getDownloadInfo();

  /* 平台不支持时给出提示并引导手动下载 */
  if (!downloadInfo) {
    console.error(`Unsupported platform: ${platform} ${arch}`);
    console.error('Please download manually from: https://github.com/MoYeRanQianZhi/ClaudeCodeReader/releases');
    process.exit(1);
  }

  /* bin 目录路径 — 所有平台的二进制文件都存放在 npm/bin/ 下 */
  const binDir = join(__dirname, '..', 'bin');

  /* 如果 bin 目录不存在则递归创建 */
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }

  const destPath = join(binDir, downloadInfo.filename);

  /*
   * 幂等安装检查 — 如果二进制文件已存在则跳过下载。
   * macOS 需要额外检查解压后的 .app 目录（因为 .tar.gz 下载后会被删除）。
   */
  if (existsSync(destPath) || (platform === 'darwin' && existsSync(join(binDir, 'ClaudeCodeReader.app')))) {
    console.log('Claude Code Reader is already installed.');
    return;
  }

  console.log(`Downloading Claude Code Reader for ${platform} ${arch}...`);
  console.log(`URL: ${downloadInfo.url}`);

  try {
    await download(downloadInfo.url, destPath);

    /*
     * macOS tar.gz 解压步骤：
     * 使用系统 tar 命令将 .app.tar.gz 解压到 bin 目录，
     * 解压后删除 .tar.gz 压缩包以节省磁盘空间。
     */
    if (downloadInfo.extract && platform === 'darwin') {
      const { execSync } = await import('child_process');
      console.log('Extracting...');
      execSync(`tar -xzf "${destPath}" -C "${binDir}"`);
      unlinkSync(destPath);
    }

    /*
     * 设置可执行权限（仅限 Unix 系统的非压缩文件）：
     * Linux 的 AppImage 需要可执行权限才能运行。
     * macOS 的 .app 在解压时已保留原始权限，无需额外设置。
     * chmod 0o755 = rwxr-xr-x（所有者可读写执行，其他人可读执行）
     */
    if (platform !== 'win32' && !downloadInfo.extract) {
      chmodSync(destPath, 0o755);
    }

    console.log('Claude Code Reader installed successfully!');
    console.log('Run "ccr" to start the application.');
  } catch (error) {
    console.error('Failed to download Claude Code Reader:', error.message);
    console.error('Please download manually from: https://github.com/MoYeRanQianZhi/ClaudeCodeReader/releases');
    process.exit(1);
  }
}

main();
