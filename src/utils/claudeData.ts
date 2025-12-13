import type { ClaudeSettings, Project, Session, SessionMessage, HistoryEntry, MessageContent } from '../types/claude';

// 获取Claude数据目录路径
export async function getClaudeDataPath(): Promise<string> {
  const { homeDir, join } = await import('@tauri-apps/api/path');
  const home = await homeDir();
  return join(home, '.claude');
}

// 读取设置文件
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

// 保存设置文件
export async function saveSettings(claudePath: string, settings: ClaudeSettings): Promise<void> {
  const { join } = await import('@tauri-apps/api/path');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');

  const settingsPath = await join(claudePath, 'settings.json');
  await writeTextFile(settingsPath, JSON.stringify(settings, null, 2));
}

// 读取历史记录
export async function readHistory(claudePath: string): Promise<HistoryEntry[]> {
  const { join } = await import('@tauri-apps/api/path');
  const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');

  const historyPath = await join(claudePath, 'history.jsonl');

  if (await exists(historyPath)) {
    const content = await readTextFile(historyPath);
    const lines = content.trim().split('\n').filter(line => line.trim());
    return lines.map(line => JSON.parse(line));
  }

  return [];
}

// 获取项目列表
export async function getProjects(claudePath: string): Promise<Project[]> {
  const { join } = await import('@tauri-apps/api/path');
  const { readDir, exists } = await import('@tauri-apps/plugin-fs');

  const projectsPath = await join(claudePath, 'projects');

  if (!await exists(projectsPath)) {
    return [];
  }

  const entries = await readDir(projectsPath);
  const projects: Project[] = [];

  for (const entry of entries) {
    if (entry.isDirectory && entry.name) {
      const projectPath = decodeProjectPath(entry.name);
      const sessions = await getProjectSessions(await join(projectsPath, entry.name));

      projects.push({
        name: entry.name,
        path: projectPath,
        sessions,
      });
    }
  }

  return projects.sort((a, b) => {
    const aLatest = a.sessions[0]?.timestamp || new Date(0);
    const bLatest = b.sessions[0]?.timestamp || new Date(0);
    return bLatest.getTime() - aLatest.getTime();
  });
}

function decodeProjectPath(encodedName: string): string {
  // 将编码的项目路径解码回正常路径
  // 例如: "G--ClaudeProjects-Test" -> "G:\ClaudeProjects\Test"
  return encodedName
    .replace(/^([A-Za-z])--/, '$1:\\')
    .replace(/--/g, '\\')
    .replace(/-/g, '\\');
}

async function getProjectSessions(projectPath: string): Promise<Session[]> {
  const { readDir, stat } = await import('@tauri-apps/plugin-fs');
  const { join } = await import('@tauri-apps/api/path');

  const entries = await readDir(projectPath);
  const sessions: Session[] = [];

  for (const entry of entries) {
    if (entry.isFile && entry.name?.endsWith('.jsonl') && !entry.name.startsWith('agent-')) {
      const filePath = await join(projectPath, entry.name);
      const fileStats = await stat(filePath);
      const sessionId = entry.name.replace('.jsonl', '');

      sessions.push({
        id: sessionId,
        timestamp: fileStats.mtime ? new Date(fileStats.mtime) : new Date(),
        messageCount: 0,
        filePath,
      });
    }
  }

  return sessions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

export async function readSessionMessages(sessionFilePath: string): Promise<SessionMessage[]> {
  const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');

  if (!await exists(sessionFilePath)) {
    return [];
  }

  const content = await readTextFile(sessionFilePath);
  const lines = content.trim().split('\n').filter(line => line.trim());

  return lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter((msg): msg is SessionMessage => msg !== null);
}

export async function saveSessionMessages(sessionFilePath: string, messages: SessionMessage[]): Promise<void> {
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');

  const content = messages.map(msg => JSON.stringify(msg)).join('\n') + '\n';
  await writeTextFile(sessionFilePath, content);
}

export async function deleteMessage(sessionFilePath: string, messageUuid: string): Promise<SessionMessage[]> {
  const messages = await readSessionMessages(sessionFilePath);
  const filtered = messages.filter(msg => msg.uuid !== messageUuid);
  await saveSessionMessages(sessionFilePath, filtered);
  return filtered;
}

export async function editMessageContent(
  sessionFilePath: string,
  messageUuid: string,
  newContent: string
): Promise<SessionMessage[]> {
  const messages = await readSessionMessages(sessionFilePath);

  const updated = messages.map(msg => {
    if (msg.uuid === messageUuid && msg.message) {
      const originalContent = msg.message.content;
      let updatedContent: string | MessageContent[];

      // 保持原有的 content 格式
      if (Array.isArray(originalContent)) {
        // 如果原来是数组格式，更新第一个 text 类型的内容
        updatedContent = originalContent.map((item, index) => {
          if (item.type === 'text' && index === 0) {
            return { ...item, text: newContent };
          }
          // 如果只有一个 text 类型，或者要替换所有文本
          if (item.type === 'text') {
            return { ...item, text: newContent };
          }
          return item;
        });
        // 如果原来没有 text 类型，添加一个
        if (!originalContent.some(item => item.type === 'text')) {
          updatedContent = [{ type: 'text' as const, text: newContent }];
        }
      } else {
        // 如果原来是字符串格式，保持字符串
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
    return msg;
  });

  await saveSessionMessages(sessionFilePath, updated);
  return updated;
}

export function getMessageText(message: SessionMessage): string {
  if (!message.message) return '';

  const content = message.message.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text || '')
      .join('\n');
  }

  return '';
}

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
