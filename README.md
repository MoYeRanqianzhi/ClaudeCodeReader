# Claude Code Reader

![](https://img.shields.io/github/license/MoYeRanQianZhi/ClaudeCodeReader?style=flat-square&color=46C018)
![](https://img.shields.io/badge/version-0.1.0--beta.1-007ACC?style=flat-square&logo=git&logoColor=white)
![](https://img.shields.io/npm/v/claude-code-reader?style=flat-square&logo=npm&logoColor=white&color=CB3837)

![](https://img.shields.io/badge/Made%20with-Rust-black?style=flat-square&logo=rust&logoColor=E05D44&color=F00056)
![](https://img.shields.io/badge/Node.js-16%2B-brightgreen?style=flat-square)
![](https://img.shields.io/github/stars/MoYeRanQianZhi/ClaudeCodeReader?style=flat-square&logo=github)

[简体中文](README_CN.md) / English

A desktop app for viewing and managing Claude Code sessions and settings.

> Note: This project is currently under reconstruction, and there will be major updates to performance, and it will enter the 2.x.x version.

## Install

### NPM (Recommended)

```bash
npm install -g claude-code-reader
ccr
```

Since the abbreviation `CCR` may conflict with other projects (e.g. ClaudeCodeRouter), the following aliases are also available:

| Command | Description |
|---------|-------------|
| `ccr` | Default command |
| `cr` | Short alias |
| `ccrr` | ClaudeCodeReader abbreviated |
| `ClaudeCR` | Claude Code Reader |
| `ClaudeCodeR` | Claude Code Reader (full prefix) |
| `CCReader` | CC + Reader |

All aliases are equivalent and launch the same application.

### Manual Download

Download from [Releases](https://github.com/MoYeRanQianZhi/ClaudeCodeReader/releases).

## Features

- Browse projects and chat history
- View and edit session messages
- Manage environment variables
- Switch between env profiles
- Light/Dark theme
- **Quick Fix** — One-click repair for common Claude Code session issues (e.g. expired thinking blocks causing 400 errors). Extensible framework with 4 permission levels.

## Contributing Quick Fixes

Claude Code sessions can run into various issues — expired signatures, corrupted formats, encoding errors, and more. We sincerely invite everyone to contribute fixes for problems you've encountered. Whether it's a bug you've discovered or a repair method you've figured out, your contribution helps the entire community.

See the [Contributing Fixers Guide](docs/development/contributing-fixers.md) for full details.

**To contribute a fixer using Claude Code, copy the following prompt to your AI Agent (e.g. Claude Code):**

```
Please git clone https://github.com/MoYeRanQianZhi/ClaudeCodeReader.git, then read docs/development/contributing-fixers.md thoroughly, make sure you fully understand the bug you want to fix and the repair approach, and contribute code following all requirements in that guide.
```

## Build

```bash
npm install
npm run tauri build
```

## License

MIT

## Author

MoYeRanQianZhi
