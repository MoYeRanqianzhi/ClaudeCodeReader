// Claude Code 数据类型定义

export interface ClaudeSettings {
  env?: Record<string, string>;
  model?: string;
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  apiKey?: string;
}

// 环境配置组
export interface EnvProfile {
  id: string;
  name: string;
  env: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

// 环境切换器配置（存储在单独的文件中）
export interface EnvSwitcherConfig {
  profiles: EnvProfile[];
  activeProfileId: string | null;
}

export interface HistoryEntry {
  display: string;
  pastedContents: Record<string, PastedContent>;
  timestamp: number;
  project: string;
  sessionId: string;
}

export interface PastedContent {
  id: number;
  type: 'text' | 'image';
  content: string;
}

export interface SessionMessage {
  type: 'user' | 'assistant' | 'file-history-snapshot' | 'queue-operation' | 'custom-title' | 'tag';
  uuid: string;
  parentUuid: string | null;
  isSidechain: boolean;
  userType?: string;
  cwd?: string;
  sessionId: string;
  version?: string;
  gitBranch?: string;
  timestamp: string;
  message?: {
    role: 'user' | 'assistant';
    content: string | MessageContent[];
    model?: string;
    id?: string;
    type?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  toolUseResult?: ToolUseResult;
  error?: string;
  isApiErrorMessage?: boolean;
  thinkingMetadata?: {
    level: string;
    disabled: boolean;
    triggers: string[];
  };
  todos?: Todo[];
}

export interface MessageContent {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | MessageContent[];
}

export interface ToolUseResult {
  status: string;
  prompt?: string;
  agentId?: string;
  content?: MessageContent[];
  totalDurationMs?: number;
  totalTokens?: number;
  totalToolUseCount?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

export interface Project {
  name: string;
  path: string;
  sessions: Session[];
}

export interface Session {
  id: string;
  name?: string;
  timestamp: Date;
  messageCount: number;
  filePath: string;
}

export interface FileHistorySnapshot {
  type: 'file-history-snapshot';
  messageId: string;
  snapshot: {
    messageId: string;
    trackedFileBackups: Record<string, unknown>;
    timestamp: string;
  };
  isSnapshotUpdate: boolean;
}

// 应用状态
export interface AppState {
  settings: ClaudeSettings;
  projects: Project[];
  currentProject: Project | null;
  currentSession: Session | null;
  messages: SessionMessage[];
  theme: 'light' | 'dark' | 'system';
  claudeDataPath: string;
}
