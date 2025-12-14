#!/usr/bin/env node

import { createWriteStream, existsSync, mkdirSync, chmodSync, unlinkSync } from 'fs';
import { get } from 'https';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VERSION = '0.1.0-beta.3';
const GITHUB_REPO = 'MoYeRanQianZhi/ClaudeCodeReader';
const BASE_URL = `https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}`;

const platform = process.platform;
const arch = process.arch;

function getDownloadInfo() {
  if (platform === 'win32') {
    return {
      url: `${BASE_URL}/claude-code-reader.exe`,
      filename: 'ClaudeCodeReader.exe'
    };
  } else if (platform === 'darwin') {
    const macArch = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    return {
      url: `${BASE_URL}/ClaudeCodeReader_${macArch}.app.tar.gz`,
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

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);

    const request = (url) => {
      get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          request(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status: ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize) {
            const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
            process.stdout.write(`\rDownloading... ${percent}%`);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log('\nDownload complete!');
          resolve();
        });
      }).on('error', (err) => {
        unlinkSync(dest);
        reject(err);
      });
    };

    request(url);
  });
}

async function main() {
  const downloadInfo = getDownloadInfo();

  if (!downloadInfo) {
    console.error(`Unsupported platform: ${platform} ${arch}`);
    console.error('Please download manually from: https://github.com/MoYeRanQianZhi/ClaudeCodeReader/releases');
    process.exit(1);
  }

  const binDir = join(__dirname, '..', 'bin');

  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }

  const destPath = join(binDir, downloadInfo.filename);

  // Check if already downloaded
  if (existsSync(destPath) || (platform === 'darwin' && existsSync(join(binDir, 'ClaudeCodeReader.app')))) {
    console.log('Claude Code Reader is already installed.');
    return;
  }

  console.log(`Downloading Claude Code Reader for ${platform} ${arch}...`);
  console.log(`URL: ${downloadInfo.url}`);

  try {
    await download(downloadInfo.url, destPath);

    // Extract tar.gz on macOS
    if (downloadInfo.extract && platform === 'darwin') {
      const { execSync } = await import('child_process');
      console.log('Extracting...');
      execSync(`tar -xzf "${destPath}" -C "${binDir}"`);
      unlinkSync(destPath);
    }

    // Make executable on Unix systems
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
