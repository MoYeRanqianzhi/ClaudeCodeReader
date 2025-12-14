#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const platform = process.platform;

let binaryPath;

if (platform === 'win32') {
  binaryPath = join(__dirname, 'Claude Code Reader.exe');
} else if (platform === 'darwin') {
  binaryPath = join(__dirname, 'Claude Code Reader.app', 'Contents', 'MacOS', 'Claude Code Reader');
} else if (platform === 'linux') {
  binaryPath = join(__dirname, 'claude-code-reader.AppImage');
} else {
  console.error(`Unsupported platform: ${platform}`);
  process.exit(1);
}

if (!existsSync(binaryPath)) {
  console.error('Claude Code Reader binary not found.');
  console.error('Please run: npm run postinstall');
  console.error('Or download manually from: https://github.com/MoYeRanQianZhi/ClaudeCodeReader/releases');
  process.exit(1);
}

const child = spawn(binaryPath, process.argv.slice(2), {
  detached: true,
  stdio: 'ignore'
});

child.unref();
