/**
 * @file claudeData.ts - Claude Code 数据读写工具模块
 * @description
 * 本文件封装了所有与 Claude Code 本地数据文件交互的工具函数，是 CCR 应用的数据访问层。
 *
 * ## 架构说明（v0.3.0 性能优化后）
 * 所有重型数据加载操作已迁移到 Rust 后端，通过 Tauri commands（`invoke()`）调用。
 * Rust 后端利用并行 I/O（tokio）和内存缓存，将启动加载时间大幅减少。
 *
 * **已迁移到 Rust 后端的操作**：
 * - 项目扫描和会话列表加载（`scan_projects`）
 * - 消息 JSONL 文件解析（`read_session_messages`）
 * - 消息编辑、删除操作
 * - 设置和环境配置读写
 * - 命令历史记录读取
 *
 * **仍在前端的操作**：
 * - 导出功能（`exportAsMarkdown`、`exportAsJson`）：纯数据转换，不涉及 I/O
 * - 格式化工具（`getMessageText`、`formatTimestamp`）：纯函数，无需迁移
 * - 环境配置的纯内存操作（`createEnvProfile`）：不涉及文件 I/O
 * - 应用环境配置（`applyEnvProfile`）：组合调用 readSettings + saveSettings
 * - 保存当前环境为配置组（`saveCurrentAsProfile`）：组合调用
 *
 * 功能分类：
 * - 路径工具函数：获取 Claude Code 数据目录路径
 * - 环境配置管理：环境配置的增删改查和切换
 * - 设置读写：读取和保存 Claude Code 的 settings.json
 * - 历史记录：读取 Claude Code 命令历史
 * - 项目与会话：扫描项目目录、加载会话列表
 * - 消息操作：读取、编辑、删除会话消息
 * - 格式化工具：文本和时间的格式化辅助函数
 *
 * 数据目录结构：
 * ~/.claude/
 *   ├── settings.json          - 用户设置
 *   ├── history.jsonl           - 命令历史
 *   └── projects/               - 项目数据
 *       └── <encoded-path>/     - 编码后的项目路径
 *           ├── <session-id>.jsonl   - 主会话文件
 *           └── agent-<id>.jsonl     - 子 agent 会话文件（被过滤）
 *
 * ~/.mo/CCR/
 *   └── env-profiles.json       - 环境配置管理（CCR 独有）
 */

import { invoke } from '@tauri-apps/api/core';
import type { ClaudeSettings, Project, SessionMessage, HistoryEntry, EnvSwitcherConfig, EnvProfile } from '../types/claude';

// ============ 路径工具函数 ============

/**
 * 获取 Claude Code 数据目录的绝对路径
 *
 * 通过 Rust 后端的 `get_claude_data_path` command 获取 `~/.claude/` 的绝对路径。
 * 使用 `dirs` crate 实现跨平台的主目录获取。
 *
 * @returns 返回 ~/.claude/ 目录的绝对路径（如 "C:\Users\xxx\.claude" 或 "/home/xxx/.claude"）
 */
export async function getClaudeDataPath(): Promise<string> {
  return invoke<string>('get_claude_data_path');
}

// ============ 环境配置管理 ============

/**
 * 读取环境切换器配置
 *
 * 通过 Rust 后端读取 ~/.mo/CCR/env-profiles.json。
 * 如果配置文件不存在（首次使用），返回空的默认配置。
 *
 * @param claudePath - Claude 数据路径（保留参数，保持 API 一致性）
 * @returns 返回包含所有配置组和激活 ID 的 EnvSwitcherConfig 对象
 */
export async function readEnvSwitcherConfig(claudePath: string): Promise<EnvSwitcherConfig> {
  return invoke<EnvSwitcherConfig>('read_env_config', { claudePath });
}

/**
 * 保存环境切换器配置到文件
 *
 * 通过 Rust 后端将配置序列化为 JSON 并写入 ~/.mo/CCR/env-profiles.json。
 *
 * @param claudePath - Claude 数据路径（保留参数，保持 API 一致性）
 * @param config - 要保存的完整环境切换器配置对象
 */
export async function saveEnvSwitcherConfig(claudePath: string, config: EnvSwitcherConfig): Promise<void> {
  return invoke<void>('save_env_config', { claudePath, config });
}

/**
 * 生成唯一标识符
 *
 * 通过组合当前时间戳的 36 进制表示和随机数的 36 进制表示来生成 ID，
 * 确保在同一毫秒内也有极低的冲突概率。
 *
 * @returns 返回由时间戳和随机数拼接的唯一字符串（如 "lq1k5v8a7x3m"）
 */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * 创建新的环境配置组
 *
 * 构造一个新的 EnvProfile 对象，自动生成唯一 ID 和时间戳。
 * 此函数为纯内存操作，不涉及文件 I/O，因此保留在前端。
 *
 * @param name - 配置组的显示名称（如 "开发环境"）
 * @param env - 环境变量键值对集合
 * @returns 返回新创建的 EnvProfile 对象（尚未持久化，需要手动保存到配置文件）
 */
export function createEnvProfile(name: string, env: Record<string, string>): EnvProfile {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    env,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 应用环境配置组到 Claude Code 设置
 *
 * 读取当前的 settings.json，将指定配置组的环境变量覆盖到 env 字段，
 * 然后保存更新后的设置。这会直接影响 Claude Code CLI 的运行时环境。
 *
 * @param claudePath - Claude 数据目录路径（~/.claude/）
 * @param profile - 要应用的环境配置组
 * @returns 返回更新后的完整设置对象
 */
export async function applyEnvProfile(
  claudePath: string,
  profile: EnvProfile
): Promise<ClaudeSettings> {
  const settings = await readSettings(claudePath);
  const updatedSettings = {
    ...settings,
    env: { ...profile.env },
  };
  await saveSettings(claudePath, updatedSettings);
  return updatedSettings;
}

/**
 * 将当前设置中的环境变量保存为新的配置组
 *
 * 从当前 settings.json 中提取 env 字段的内容，创建一个新的配置组并持久化。
 * 同时将新配置组设置为激活状态。
 *
 * @param claudePath - Claude 数据目录路径（~/.claude/）
 * @param name - 新配置组的显示名称
 * @returns 返回新创建并已保存的 EnvProfile 对象
 */
export async function saveCurrentAsProfile(
  claudePath: string,
  name: string
): Promise<EnvProfile> {
  const settings = await readSettings(claudePath);
  // 如果当前设置中没有 env 字段，使用空对象作为默认值
  const profile = createEnvProfile(name, settings.env || {});

  const config = await readEnvSwitcherConfig(claudePath);
  config.profiles.push(profile);
  // 将新创建的配置组设置为当前激活的配置
  config.activeProfileId = profile.id;
  await saveEnvSwitcherConfig(claudePath, config);

  return profile;
}

// ============ 设置读写 ============

/**
 * 读取 Claude Code 设置文件
 *
 * 通过 Rust 后端从 ~/.claude/settings.json 加载用户设置。
 * 如果文件不存在，返回空对象 {}。
 *
 * @param claudePath - Claude 数据目录路径（~/.claude/）
 * @returns 返回解析后的 ClaudeSettings 对象；文件不存在时返回空对象 {}
 */
export async function readSettings(claudePath: string): Promise<ClaudeSettings> {
  return invoke<ClaudeSettings>('read_settings', { claudePath });
}

/**
 * 保存 Claude Code 设置文件
 *
 * 通过 Rust 后端将设置对象序列化为 JSON 并写入 ~/.claude/settings.json。
 *
 * @param claudePath - Claude 数据目录路径（~/.claude/）
 * @param settings - 要保存的完整设置对象
 */
export async function saveSettings(claudePath: string, settings: ClaudeSettings): Promise<void> {
  return invoke<void>('save_settings', { claudePath, settings });
}

// ============ 历史记录 ============

/**
 * 读取 Claude Code 命令历史记录
 *
 * 通过 Rust 后端从 ~/.claude/history.jsonl 加载所有历史记录条目。
 *
 * @param claudePath - Claude 数据目录路径（~/.claude/）
 * @returns 返回按原始顺序排列的 HistoryEntry 数组；文件不存在时返回空数组
 */
export async function readHistory(claudePath: string): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>('read_history', { claudePath });
}

// ============ 项目与会话 ============

/**
 * 获取所有项目列表
 *
 * 通过 Rust 后端并行扫描 ~/.claude/projects/ 目录下的所有子目录和会话文件。
 * 这是性能优化的核心——一次 IPC 调用替代原来的 1000+ 次调用。
 *
 * Rust 后端会：
 * 1. 并行扫描所有项目子目录
 * 2. 并行获取每个会话文件的 metadata（修改时间）
 * 3. 利用内存缓存避免重复扫描
 *
 * 注意：返回的 Session.timestamp 是 ISO 8601 字符串，需要转换为 Date 对象。
 *
 * @param claudePath - Claude 数据目录路径（~/.claude/）
 * @returns 返回按最新会话时间倒序排列的 Project 数组
 */
export async function getProjects(claudePath: string): Promise<Project[]> {
  // Rust 后端返回的 Session.timestamp 是 ISO 8601 字符串
  // 需要将其转换为 Date 对象以保持前端类型兼容
  const projects = await invoke<Project[]>('scan_projects', { claudePath });

  // 将 Rust 返回的 ISO 8601 时间字符串转换为 Date 对象
  for (const project of projects) {
    for (const session of project.sessions) {
      session.timestamp = new Date(session.timestamp as unknown as string);
    }
  }

  return projects;
}

// ============ 消息操作 ============

/**
 * 读取指定会话的所有消息
 *
 * 通过 Rust 后端高性能解析 JSONL 文件。
 * Rust 的 serde_json 解析速度比 JS 的 JSON.parse 快 3-10 倍。
 * 同时利用内存缓存避免重复解析。
 *
 * @param sessionFilePath - 会话 JSONL 文件的绝对路径
 * @returns 返回按文件顺序排列的 SessionMessage 数组；文件不存在时返回空数组
 */
export async function readSessionMessages(sessionFilePath: string): Promise<SessionMessage[]> {
  return invoke<SessionMessage[]>('read_session_messages', { sessionFilePath });
}

/**
 * 将消息列表保存到会话文件
 *
 * 注意：此函数通过重新读取和写入完整消息列表实现。
 * 对于消息的编辑和删除操作，建议使用专用的 editMessageContent / deleteMessage 等函数，
 * 它们在 Rust 后端一次操作内完成读取、修改、写入，避免了额外的 IPC 往返。
 *
 * 此函数保留是为了向后兼容，但新的代码应尽量使用 Rust 后端的专用 commands。
 *
 * @param sessionFilePath - 会话 JSONL 文件的绝对路径
 * @param messages - 要保存的完整消息列表
 */
export async function saveSessionMessages(sessionFilePath: string, messages: SessionMessage[]): Promise<void> {
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  // 每条消息序列化为单行 JSON，行之间用换行符分隔，末尾加换行符
  const content = messages.map(msg => JSON.stringify(msg)).join('\n') + '\n';
  await writeTextFile(sessionFilePath, content);
}

/**
 * 删除指定的单条消息
 *
 * 通过 Rust 后端在单次 IPC 调用中完成：读取文件 → 过滤消息 → 写入文件。
 *
 * @param sessionFilePath - 会话 JSONL 文件的绝对路径
 * @param messageUuid - 要删除的消息的 UUID
 * @returns 返回删除后的剩余消息列表
 */
export async function deleteMessage(sessionFilePath: string, messageUuid: string): Promise<SessionMessage[]> {
  return invoke<SessionMessage[]>('delete_message', { sessionFilePath, messageUuid });
}

/**
 * 批量删除多条消息
 *
 * 通过 Rust 后端在单次 IPC 调用中完成批量删除。
 * 前端传入的 Set<string> 会被转换为 string[] 进行 IPC 传输。
 *
 * @param sessionFilePath - 会话 JSONL 文件的绝对路径
 * @param messageUuids - 要删除的消息 UUID 集合（Set<string>）
 * @returns 返回删除后的剩余消息列表
 */
export async function deleteMessages(sessionFilePath: string, messageUuids: Set<string>): Promise<SessionMessage[]> {
  // Set<string> 无法直接通过 Tauri IPC 传输，需转换为数组
  return invoke<SessionMessage[]>('delete_messages', {
    sessionFilePath,
    messageUuids: Array.from(messageUuids),
  });
}

/**
 * 单个内容块的编辑数据
 *
 * 描述对消息 content 数组中某个内容块的文本修改：
 * - index：内容块在数组中的位置
 * - text：用户编辑后的新文本
 */
export interface BlockEdit {
  /** 内容块在 message.content 数组中的索引位置 */
  index: number;
  /** 用户编辑后的新文本内容 */
  text: string;
}

/**
 * 按内容块索引编辑指定消息
 *
 * 通过 Rust 后端在单次 IPC 调用中完成：读取文件 → 按块索引修改 → 写入文件。
 * 每个内容块的 type 和其他元数据保持不变，仅更新对应的文本字段。
 *
 * @param sessionFilePath - 会话 JSONL 文件的绝对路径
 * @param messageUuid - 要编辑的消息的 UUID
 * @param blockEdits - 按块索引的编辑列表
 * @returns 返回更新后的完整消息列表
 */
export async function editMessageContent(
  sessionFilePath: string,
  messageUuid: string,
  blockEdits: BlockEdit[]
): Promise<SessionMessage[]> {
  return invoke<SessionMessage[]>('edit_message_content', {
    sessionFilePath,
    messageUuid,
    blockEdits,
  });
}

// ============ 导出功能 ============

/**
 * 将会话消息导出为 Markdown 格式字符串
 *
 * 生成结构化的 Markdown 文档，包含会话标题和每条消息的角色、时间戳和内容。
 * 仅导出 user 和 assistant 类型的消息，忽略系统消息。
 * 此函数为纯数据转换，不涉及文件 I/O，保留在前端。
 *
 * @param messages - 要导出的消息列表
 * @param sessionName - 会话名称，用作文档标题
 * @returns Markdown 格式的字符串
 */
export function exportAsMarkdown(messages: SessionMessage[], sessionName: string): string {
  const lines: string[] = [];
  lines.push(`# ${sessionName}`);
  lines.push('');
  lines.push(`导出时间: ${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    // 仅导出用户和助手消息
    if (msg.type !== 'user' && msg.type !== 'assistant') continue;

    const role = msg.type === 'user' ? '用户' : '助手';
    const time = formatTimestamp(msg.timestamp);
    lines.push(`## ${role} (${time})`);
    lines.push('');

    const text = getMessageText(msg);
    if (text) {
      lines.push(text);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 将会话消息导出为 JSON 格式字符串
 *
 * 直接将消息数组序列化为美化的 JSON 字符串，保留所有字段和结构信息。
 * 此函数为纯数据转换，保留在前端。
 *
 * @param messages - 要导出的消息列表
 * @returns 美化后的 JSON 字符串（2 空格缩进）
 */
export function exportAsJson(messages: SessionMessage[]): string {
  return JSON.stringify(messages, null, 2);
}

// ============ 格式化工具 ============

/**
 * 删除指定的会话文件
 *
 * 通过 Rust 后端从文件系统中永久移除会话的 JSONL 文件。
 * 同时清除相关的内存缓存。
 *
 * @param sessionFilePath - 要删除的会话 JSONL 文件的绝对路径
 */
export async function deleteSession(sessionFilePath: string): Promise<void> {
  return invoke<void>('delete_session', { sessionFilePath });
}

// ============ 文件系统辅助 ============

/**
 * 检查指定路径的文件是否存在
 *
 * 通过 Rust 后端检查文件系统中文件是否存在。
 * 用于在渲染工具结果的"打开文件位置"按钮前判断按钮是否应该可用。
 *
 * @param filePath - 要检查的文件的绝对路径
 * @returns 文件存在返回 true，否则返回 false
 */
export async function checkFileExists(filePath: string): Promise<boolean> {
  return invoke<boolean>('check_file_exists', { filePath });
}

/**
 * 在系统文件管理器中打开指定文件所在的目录
 *
 * 通过 Rust 后端调用系统命令打开文件管理器并选中目标文件。
 * Windows 使用 explorer，macOS 使用 Finder，Linux 使用 xdg-open。
 *
 * @param filePath - 要在文件管理器中打开的文件绝对路径
 */
export async function openInExplorer(filePath: string): Promise<void> {
  return invoke<void>('open_in_explorer', { filePath });
}

/**
 * 提取消息的纯文本内容
 *
 * 从 SessionMessage 中提取可显示的文本内容，处理两种 content 格式：
 * - 字符串格式：直接返回
 * - 数组格式：提取所有 type='text' 内容块的 text 字段，用换行符拼接
 * 此函数为纯内存操作，保留在前端。
 *
 * @param message - 会话消息对象
 * @returns 返回消息的纯文本内容字符串；无内容时返回空字符串
 */
export function getMessageText(message: SessionMessage): string {
  if (!message.message) return '';

  const content = message.message.content;

  // 字符串格式：直接返回原文
  if (typeof content === 'string') {
    return content;
  }

  // 数组格式：过滤出 text 类型的内容块，提取文本并拼接
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text || '')
      .join('\n');
  }

  return '';
}

/**
 * 格式化时间戳为中文本地化日期时间字符串
 *
 * 接受多种时间格式输入，统一转换为中文（zh-CN）格式的日期时间字符串。
 * 此函数为纯计算操作，保留在前端。
 *
 * @param timestamp - 时间戳，支持 ISO 8601 字符串、Unix 毫秒数或 Date 对象
 * @returns 返回格式化后的中文日期时间字符串
 */
export function formatTimestamp(timestamp: string | number | Date): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
