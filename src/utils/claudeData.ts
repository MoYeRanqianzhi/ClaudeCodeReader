/**
 * @file claudeData.ts - Claude Code 数据读写工具模块
 * @description
 * 本文件封装了所有与 Claude Code 本地数据文件交互的工具函数，是 CCR 应用的数据访问层。
 * 所有文件系统操作均通过 Tauri 插件（@tauri-apps/plugin-fs）实现，确保跨平台兼容性。
 *
 * 功能分类：
 * - 路径工具函数：获取和处理 Claude Code 数据目录路径
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

import type { ClaudeSettings, Project, Session, SessionMessage, HistoryEntry, MessageContent, EnvSwitcherConfig, EnvProfile } from '../types/claude';

// ============ 路径工具函数 ============

/**
 * 获取 Claude Code 数据目录的绝对路径
 *
 * Claude Code 将所有用户数据存储在用户主目录下的 .claude 文件夹中。
 * 此函数通过 Tauri 的路径 API 获取跨平台的主目录路径，
 * 并拼接 .claude 子目录。
 *
 * @returns 返回 ~/.claude/ 目录的绝对路径（如 "C:\Users\xxx\.claude" 或 "/home/xxx/.claude"）
 */
export async function getClaudeDataPath(): Promise<string> {
  const { homeDir, join } = await import('@tauri-apps/api/path');
  const home = await homeDir();
  return join(home, '.claude');
}

/**
 * 获取 CCR 自身配置目录的绝对路径
 *
 * CCR 的配置数据独立存储在 ~/.mo/CCR/ 目录下，与 Claude Code 原生数据分离，
 * 避免对 Claude Code 的文件造成意外污染。
 * 如果目录不存在，会自动递归创建。
 *
 * @returns 返回 ~/.mo/CCR/ 目录的绝对路径
 */
async function getCCRConfigPath(): Promise<string> {
  const { homeDir, join } = await import('@tauri-apps/api/path');
  const { mkdir, exists } = await import('@tauri-apps/plugin-fs');
  const home = await homeDir();
  const ccrPath = await join(home, '.mo', 'CCR');

  // 确保目录存在，recursive: true 会递归创建所有缺失的父目录
  if (!await exists(ccrPath)) {
    await mkdir(ccrPath, { recursive: true });
  }

  return ccrPath;
}

// ============ 环境配置管理 ============

/**
 * 获取环境切换器配置文件的绝对路径
 *
 * 配置文件固定命名为 env-profiles.json，位于 CCR 配置目录下。
 *
 * @returns 返回 ~/.mo/CCR/env-profiles.json 的绝对路径
 */
async function getEnvSwitcherConfigPath(): Promise<string> {
  const { join } = await import('@tauri-apps/api/path');
  const ccrPath = await getCCRConfigPath();
  return join(ccrPath, 'env-profiles.json');
}

/**
 * 读取环境切换器配置
 *
 * 从 ~/.mo/CCR/env-profiles.json 加载所有环境配置组及激活状态。
 * 如果配置文件不存在（首次使用），返回空的默认配置。
 *
 * @param _claudePath - Claude 数据路径（保留参数，当前未使用，保持 API 一致性）
 * @returns 返回包含所有配置组和激活 ID 的 EnvSwitcherConfig 对象
 */
export async function readEnvSwitcherConfig(_claudePath: string): Promise<EnvSwitcherConfig> {
  const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
  const configPath = await getEnvSwitcherConfigPath();

  if (await exists(configPath)) {
    const content = await readTextFile(configPath);
    return JSON.parse(content);
  }

  // 配置文件不存在时返回空的默认配置
  return { profiles: [], activeProfileId: null };
}

/**
 * 保存环境切换器配置到文件
 *
 * 将完整的配置对象序列化为 JSON（带缩进格式化）并写入配置文件。
 *
 * @param _claudePath - Claude 数据路径（保留参数，当前未使用，保持 API 一致性）
 * @param config - 要保存的完整环境切换器配置对象
 */
export async function saveEnvSwitcherConfig(_claudePath: string, config: EnvSwitcherConfig): Promise<void> {
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  const configPath = await getEnvSwitcherConfigPath();
  await writeTextFile(configPath, JSON.stringify(config, null, 2));
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
 * 从 ~/.claude/settings.json 加载用户设置。
 * 如果文件不存在（如首次安装 Claude Code），返回空对象。
 *
 * @param claudePath - Claude 数据目录路径（~/.claude/）
 * @returns 返回解析后的 ClaudeSettings 对象；文件不存在时返回空对象 {}
 */
export async function readSettings(claudePath: string): Promise<ClaudeSettings> {
  const { join } = await import('@tauri-apps/api/path');
  const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');

  const settingsPath = await join(claudePath, 'settings.json');

  if (await exists(settingsPath)) {
    const content = await readTextFile(settingsPath);
    return JSON.parse(content);
  }

  return {};
}

/**
 * 保存 Claude Code 设置文件
 *
 * 将设置对象序列化为 JSON（带 2 空格缩进）并写入 ~/.claude/settings.json。
 * 此操作会覆盖整个文件内容。
 *
 * @param claudePath - Claude 数据目录路径（~/.claude/）
 * @param settings - 要保存的完整设置对象
 */
export async function saveSettings(claudePath: string, settings: ClaudeSettings): Promise<void> {
  const { join } = await import('@tauri-apps/api/path');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');

  const settingsPath = await join(claudePath, 'settings.json');
  await writeTextFile(settingsPath, JSON.stringify(settings, null, 2));
}

// ============ 历史记录 ============

/**
 * 读取 Claude Code 命令历史记录
 *
 * 从 ~/.claude/history.jsonl 加载所有历史记录条目。
 * 文件采用 JSONL（JSON Lines）格式，每行是一个独立的 JSON 对象。
 *
 * @param claudePath - Claude 数据目录路径（~/.claude/）
 * @returns 返回按原始顺序排列的 HistoryEntry 数组；文件不存在时返回空数组
 */
export async function readHistory(claudePath: string): Promise<HistoryEntry[]> {
  const { join } = await import('@tauri-apps/api/path');
  const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');

  const historyPath = await join(claudePath, 'history.jsonl');

  if (await exists(historyPath)) {
    const content = await readTextFile(historyPath);
    // 按换行符分割，过滤掉空行（文件末尾可能有多余换行）
    const lines = content.trim().split('\n').filter(line => line.trim());
    return lines.map(line => JSON.parse(line));
  }

  return [];
}

// ============ 项目与会话 ============

/**
 * 获取所有项目列表
 *
 * 扫描 ~/.claude/projects/ 目录下的所有子目录，每个子目录代表一个项目。
 * 目录名是项目原始路径的编码形式（由 decodeProjectPath 解码）。
 * 返回的项目列表按最新会话时间倒序排列（最近使用的项目排在前面）。
 *
 * @param claudePath - Claude 数据目录路径（~/.claude/）
 * @returns 返回按最新会话时间倒序排列的 Project 数组
 */
export async function getProjects(claudePath: string): Promise<Project[]> {
  const { join } = await import('@tauri-apps/api/path');
  const { readDir, exists } = await import('@tauri-apps/plugin-fs');

  const projectsPath = await join(claudePath, 'projects');

  // 如果 projects 目录不存在，说明没有任何项目数据
  if (!await exists(projectsPath)) {
    return [];
  }

  const entries = await readDir(projectsPath);
  const projects: Project[] = [];

  for (const entry of entries) {
    // 只处理目录条目（跳过可能存在的文件）
    if (entry.isDirectory && entry.name) {
      // 将编码后的目录名解码为原始项目路径
      const projectPath = decodeProjectPath(entry.name);
      // 扫描项目目录下的所有会话文件
      const sessions = await getProjectSessions(await join(projectsPath, entry.name));

      projects.push({
        name: entry.name,
        path: projectPath,
        sessions,
      });
    }
  }

  // 按每个项目中最新会话的时间戳降序排列
  return projects.sort((a, b) => {
    const aLatest = a.sessions[0]?.timestamp || new Date(0);
    const bLatest = b.sessions[0]?.timestamp || new Date(0);
    return bLatest.getTime() - aLatest.getTime();
  });
}

/**
 * 将编码的项目目录名解码为原始文件系统路径
 *
 * Claude Code 在 projects 目录下使用编码后的路径作为子目录名，
 * 将路径分隔符和驱动器号替换为短横线，以适应文件系统命名限制。
 *
 * 解码规则（以 Windows 路径为例）：
 * 1. `^([A-Za-z])--` -> `$1:\` — 将开头的 "盘符--" 还原为 "盘符:\"（如 "G--" -> "G:\"）
 * 2. `--` -> `\` — 将双短横线还原为路径分隔符（双短横线表示原始路径中的分隔符）
 * 3. `-` -> `\` — 将单短横线还原为路径分隔符（单短横线也表示路径分隔符）
 *
 * 示例: "G--ClaudeProjects-Test" -> "G:\ClaudeProjects\Test"
 *
 * @param encodedName - 编码后的项目目录名
 * @returns 返回解码后的原始文件系统路径
 */
function decodeProjectPath(encodedName: string): string {
  return encodedName
    // 步骤1: 还原 Windows 盘符，将 "X--" 格式的开头替换为 "X:\"
    .replace(/^([A-Za-z])--/, '$1:\\')
    // 步骤2: 将剩余的双短横线替换为路径分隔符
    .replace(/--/g, '\\')
    // 步骤3: 将单短横线替换为路径分隔符
    .replace(/-/g, '\\');
}

/**
 * 获取指定项目目录下的所有会话
 *
 * 扫描项目目录中的 JSONL 文件，每个文件代表一个独立的对话会话。
 * 会过滤掉以 "agent-" 开头的文件，因为这些是子 agent 的会话记录，
 * 它们由主会话中的 Task/SendMessage 工具自动创建，不应作为独立会话展示给用户。
 *
 * @param projectPath - 项目在 ~/.claude/projects/ 下的完整目录路径
 * @returns 返回按时间戳降序排列的 Session 数组（最新的会话排在前面）
 */
async function getProjectSessions(projectPath: string): Promise<Session[]> {
  const { readDir, stat } = await import('@tauri-apps/plugin-fs');
  const { join } = await import('@tauri-apps/api/path');

  const entries = await readDir(projectPath);
  const sessions: Session[] = [];

  for (const entry of entries) {
    // 过滤条件：
    // 1. 必须是文件（非目录）
    // 2. 必须以 .jsonl 结尾（JSONL 格式的会话记录）
    // 3. 排除 agent- 前缀的文件（子 agent 会话，不应独立展示）
    if (entry.isFile && entry.name?.endsWith('.jsonl') && !entry.name.startsWith('agent-')) {
      const filePath = await join(projectPath, entry.name);
      // 获取文件元数据以读取最后修改时间
      const fileStats = await stat(filePath);
      // 从文件名中提取会话 ID（去掉 .jsonl 扩展名）
      const sessionId = entry.name.replace('.jsonl', '');

      sessions.push({
        id: sessionId,
        // 使用文件最后修改时间作为会话时间戳，若不可用则使用当前时间
        timestamp: fileStats.mtime ? new Date(fileStats.mtime) : new Date(),
        // 消息数量初始为 0，会在实际读取会话内容时更新
        messageCount: 0,
        filePath,
      });
    }
  }

  // 按时间戳降序排列，最新修改的会话排在最前面
  return sessions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

// ============ 消息操作 ============

/**
 * 读取指定会话的所有消息
 *
 * 从 JSONL 文件中逐行解析消息数据。JSONL（JSON Lines）格式中每行是一个独立的 JSON 对象。
 * 对于解析失败的行（如文件末尾的不完整行、或被意外截断的数据），采用静默跳过策略，
 * 不会抛出异常，确保已成功解析的消息仍然可以正常展示。
 *
 * @param sessionFilePath - 会话 JSONL 文件的绝对路径
 * @returns 返回按文件顺序排列的 SessionMessage 数组；文件不存在时返回空数组
 */
export async function readSessionMessages(sessionFilePath: string): Promise<SessionMessage[]> {
  const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');

  if (!await exists(sessionFilePath)) {
    return [];
  }

  const content = await readTextFile(sessionFilePath);
  // 按换行符分割并过滤掉空行
  const lines = content.trim().split('\n').filter(line => line.trim());

  return lines.map(line => {
    try {
      // 尝试将每一行解析为 JSON 对象
      return JSON.parse(line);
    } catch {
      // 解析失败时返回 null（静默跳过损坏的行），避免单行错误影响整个会话的加载
      return null;
    }
  }).filter((msg): msg is SessionMessage => msg !== null); // 类型守卫过滤掉 null 值
}

/**
 * 将消息列表保存到会话文件
 *
 * 将所有消息序列化为 JSONL 格式（每条消息一行 JSON）并写入文件。
 * 此操作会覆盖整个文件内容，适用于编辑或删除消息后的全量保存。
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
 * 根据消息 UUID 从会话文件中移除一条消息，然后将剩余消息重新保存到文件。
 *
 * @param sessionFilePath - 会话 JSONL 文件的绝对路径
 * @param messageUuid - 要删除的消息的 UUID
 * @returns 返回删除后的剩余消息列表
 */
export async function deleteMessage(sessionFilePath: string, messageUuid: string): Promise<SessionMessage[]> {
  const messages = await readSessionMessages(sessionFilePath);
  // 过滤掉目标消息
  const filtered = messages.filter(msg => msg.uuid !== messageUuid);
  await saveSessionMessages(sessionFilePath, filtered);
  return filtered;
}

/**
 * 批量删除多条消息
 *
 * 根据消息 UUID 集合从会话文件中移除多条消息，然后将剩余消息重新保存到文件。
 * 使用 Set 数据结构进行 O(1) 查找，保证批量删除的性能。
 *
 * @param sessionFilePath - 会话 JSONL 文件的绝对路径
 * @param messageUuids - 要删除的消息 UUID 集合（Set<string>）
 * @returns 返回删除后的剩余消息列表
 */
export async function deleteMessages(sessionFilePath: string, messageUuids: Set<string>): Promise<SessionMessage[]> {
  const messages = await readSessionMessages(sessionFilePath);
  // 使用 Set.has() 进行高效过滤，排除所有需要删除的消息
  const filtered = messages.filter(msg => !messageUuids.has(msg.uuid));
  await saveSessionMessages(sessionFilePath, filtered);
  return filtered;
}

/**
 * 编辑指定消息的文本内容
 *
 * 根据消息 UUID 定位目标消息，更新其文本内容并保存。
 * 此函数会智能保持原始 content 字段的格式（字符串 vs 数组），
 * 以确保编辑后的消息仍然能被 Claude Code 正确解析。
 *
 * content 格式保持逻辑：
 * - 如果原始 content 是字符串格式：直接用新文本替换
 * - 如果原始 content 是 MessageContent[] 数组格式：
 *   - 找到所有 type='text' 的内容块，将其 text 字段更新为新内容
 *   - 如果数组中没有 text 类型的内容块，则创建一个新的 text 块
 *
 * @param sessionFilePath - 会话 JSONL 文件的绝对路径
 * @param messageUuid - 要编辑的消息的 UUID
 * @param newContent - 新的文本内容
 * @returns 返回更新后的完整消息列表
 */
export async function editMessageContent(
  sessionFilePath: string,
  messageUuid: string,
  newContent: string
): Promise<SessionMessage[]> {
  const messages = await readSessionMessages(sessionFilePath);

  const updated = messages.map(msg => {
    // 仅处理匹配 UUID 且包含 message 字段的消息
    if (msg.uuid === messageUuid && msg.message) {
      const originalContent = msg.message.content;
      let updatedContent: string | MessageContent[];

      // 根据原始 content 的格式选择不同的更新策略，保持格式一致性
      if (Array.isArray(originalContent)) {
        // 数组格式：遍历所有内容块，更新 text 类型的块
        updatedContent = originalContent.map((item, index) => {
          if (item.type === 'text' && index === 0) {
            // 优先更新第一个 text 块（通常是主要内容）
            return { ...item, text: newContent };
          }
          if (item.type === 'text') {
            // 其余 text 块也更新为相同内容
            return { ...item, text: newContent };
          }
          // 非 text 类型的内容块（如 tool_use、tool_result）保持不变
          return item;
        });
        // 如果原数组中完全没有 text 类型的内容块，创建一个新的
        if (!originalContent.some(item => item.type === 'text')) {
          updatedContent = [{ type: 'text' as const, text: newContent }];
        }
      } else {
        // 字符串格式：直接替换为新文本，保持字符串类型
        updatedContent = newContent;
      }

      return {
        ...msg,
        message: {
          ...msg.message,
          content: updatedContent,
        },
      };
    }
    // 非目标消息保持不变
    return msg;
  });

  await saveSessionMessages(sessionFilePath, updated);
  return updated;
}

// ============ 格式化工具 ============

/**
 * 删除指定的会话文件
 *
 * 从文件系统中永久移除会话的 JSONL 文件。此操作不可撤销。
 * 使用 @tauri-apps/plugin-fs 的 remove 函数实现跨平台文件删除。
 *
 * @param sessionFilePath - 要删除的会话 JSONL 文件的绝对路径
 */
export async function deleteSession(sessionFilePath: string): Promise<void> {
  const { remove } = await import('@tauri-apps/plugin-fs');
  await remove(sessionFilePath);
}

/**
 * 提取消息的纯文本内容
 *
 * 从 SessionMessage 中提取可显示的文本内容，处理两种 content 格式：
 * - 字符串格式：直接返回
 * - 数组格式：提取所有 type='text' 内容块的 text 字段，用换行符拼接
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
 * 输出格式示例：2025/01/15 14:30:25
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
