/**
 * @file claude.ts - Claude Code 核心数据类型定义
 * @description
 * 本文件定义了 ClaudeCodeReader (CCR) 项目中所有与 Claude Code 数据交互相关的 TypeScript 类型和接口。
 * 这些类型对应 Claude Code CLI 工具在本地文件系统中存储的数据结构（位于 ~/.claude/ 目录），
 * 包括设置、会话消息、项目结构、历史记录等。
 *
 * 数据来源：
 * - settings.json：用户设置（ClaudeSettings）
 * - projects/<encoded-path>/<session-id>.jsonl：会话消息（SessionMessage）
 * - history.jsonl：命令历史记录（HistoryEntry）
 * - ~/.mo/CCR/env-profiles.json：环境配置管理（EnvSwitcherConfig）
 */

/**
 * Claude Code 设置接口
 *
 * 对应 ~/.claude/settings.json 文件中的配置内容。
 * Claude Code CLI 在启动时读取此文件以获取用户偏好设置。
 */
export interface ClaudeSettings {
  /** 环境变量键值对：传递给 Claude Code 运行时的自定义环境变量，如 API 端点、代理配置等 */
  env?: Record<string, string>;
  /** 模型标识符：指定使用的 AI 模型，例如 "claude-sonnet-4-20250514" */
  model?: string;
  /** 权限配置：控制 Claude Code 可以执行的操作范围 */
  permissions?: {
    /** 允许列表：明确允许的工具或操作名称，如 ["Read", "Write", "Bash"] */
    allow?: string[];
    /** 拒绝列表：明确禁止的工具或操作名称 */
    deny?: string[];
  };
  /** API 密钥：用于身份验证的 Anthropic API 密钥（敏感信息） */
  apiKey?: string;
}

/**
 * 环境配置组接口
 *
 * 表示一组命名的环境变量集合，用于在不同的工作场景之间快速切换环境配置。
 * 例如：开发环境、测试环境、生产环境分别使用不同的 API 端点和密钥。
 * 存储在 CCR 自身的配置目录中（~/.mo/CCR/env-profiles.json）。
 */
export interface EnvProfile {
  /** 唯一标识符：由时间戳和随机字符串组合生成，确保全局唯一 */
  id: string;
  /** 配置名称：用户自定义的可读名称，如 "开发环境"、"生产环境" */
  name: string;
  /** 环境变量集合：该配置组包含的所有环境变量键值对 */
  env: Record<string, string>;
  /** 创建时间：ISO 8601 格式的时间戳，记录配置首次创建的时间 */
  createdAt: string;
  /** 更新时间：ISO 8601 格式的时间戳，记录配置最后一次修改的时间 */
  updatedAt: string;
}

/**
 * 环境切换器配置接口
 *
 * 管理所有环境配置组的顶层容器，存储在独立的 JSON 文件中（~/.mo/CCR/env-profiles.json），
 * 与 Claude Code 原生的 settings.json 分离，避免直接修改 Claude 的配置文件。
 */
export interface EnvSwitcherConfig {
  /** 所有已保存的环境配置组列表 */
  profiles: EnvProfile[];
  /** 当前激活的配置组 ID：为 null 表示没有激活任何配置组（使用默认设置） */
  activeProfileId: string | null;
}

/**
 * 历史记录条目接口
 *
 * 对应 ~/.claude/history.jsonl 文件中的每一行记录。
 * Claude Code 会将用户的每次交互输入记录到此文件中，用于命令历史回溯。
 */
export interface HistoryEntry {
  /** 显示文本：用户输入的命令或提示词内容 */
  display: string;
  /** 粘贴内容集合：用户在输入中粘贴的文本或图片内容，以 ID 为键 */
  pastedContents: Record<string, PastedContent>;
  /** 时间戳：Unix 毫秒时间戳，记录该条目的创建时间 */
  timestamp: number;
  /** 项目路径：该历史记录关联的项目目录路径 */
  project: string;
  /** 会话 ID：该历史记录所属的会话标识符 */
  sessionId: string;
}

/**
 * 粘贴内容接口
 *
 * 表示用户通过粘贴操作输入的内容片段，可以是纯文本或图片。
 */
export interface PastedContent {
  /** 内容序号：在同一次粘贴操作中的排列序号 */
  id: number;
  /** 内容类型：'text' 表示纯文本，'image' 表示图片（Base64 编码） */
  type: 'text' | 'image';
  /** 内容正文：文本内容的原始字符串，或图片的 Base64 编码数据 */
  content: string;
}

/**
 * 会话消息接口
 *
 * 对应 Claude Code 会话 JSONL 文件中的每一行记录，是整个应用最核心的数据结构。
 * 每条消息代表一次用户与 AI 的交互、系统事件或元数据标记。
 * 文件位置：~/.claude/projects/<encoded-project-path>/<session-id>.jsonl
 */
export interface SessionMessage {
  /**
   * 消息类型，决定了该消息的用途和解析方式：
   * - 'user'：用户发送的消息（包含用户输入的文本或指令）
   * - 'assistant'：AI 助手的回复消息（包含模型生成的文本、工具调用等）
   * - 'file-history-snapshot'：文件历史快照（记录某一时刻被追踪文件的备份状态，用于撤销操作）
   * - 'queue-operation'：队列操作标记（表示后台排队的操作，如等待中的 API 请求）
   * - 'custom-title'：自定义标题（用户为会话设置的自定义显示名称）
   * - 'tag'：标签标记（用于对会话或消息进行分类标注）
   */
  type: 'user' | 'assistant' | 'file-history-snapshot' | 'queue-operation' | 'custom-title' | 'tag';
  /** 消息唯一标识符：UUID v4 格式，用于精确定位和操作单条消息 */
  uuid: string;
  /**
   * 父消息的 UUID：构成消息的树状对话结构。
   * 为 null 表示这是对话的根消息（通常是第一条用户消息）。
   * 通过 parentUuid 链可以追溯整个对话的分支和上下文。
   */
  parentUuid: string | null;
  /**
   * 是否为侧链消息。
   * "侧链"（sidechain）是 Claude Code 中的一个概念，指从主对话流分支出去的支线对话。
   * 当用户在对话中途进行回溯、重试或者 AI 进行内部子任务（如 agent 调用）时，
   * 这些不在主对话链上的消息会被标记为 sidechain。
   * 侧链消息在 UI 中通常以不同的方式展示（如折叠或灰显）。
   */
  isSidechain: boolean;
  /** 用户类型标识：区分不同的用户身份（如 "human"、"external" 等） */
  userType?: string;
  /** 当前工作目录：该消息发送时 Claude Code 的工作目录路径 */
  cwd?: string;
  /** 会话 ID：该消息所属的会话标识符，与文件名中的会话 ID 对应 */
  sessionId: string;
  /** Claude Code 版本号：生成该消息时使用的 Claude Code CLI 版本 */
  version?: string;
  /** Git 分支名：该消息发送时所在的 Git 分支（如果项目是 Git 仓库） */
  gitBranch?: string;
  /** 时间戳：ISO 8601 格式的消息创建时间 */
  timestamp: string;
  /**
   * 消息主体：包含实际的对话内容。
   * 仅在 type 为 'user' 或 'assistant' 时存在。
   * 其他类型（如 'file-history-snapshot'）不包含此字段。
   */
  message?: {
    /** 消息角色：'user' 表示用户发送，'assistant' 表示 AI 回复 */
    role: 'user' | 'assistant';
    /**
     * 消息内容，存在两种格式：
     * - string：简单文本消息，通常是用户的纯文本输入
     * - MessageContent[]：结构化内容数组，包含文本、工具调用、工具结果、图片等混合内容。
     *   AI 助手的回复通常使用数组格式，因为可能同时包含文本说明和工具调用。
     */
    content: string | MessageContent[];
    /** AI 模型标识符：生成该回复的具体模型名称（仅 assistant 消息包含） */
    model?: string;
    /** 消息 ID：Anthropic API 返回的消息唯一标识 */
    id?: string;
    /** 消息类型标识：API 层面的消息类型（如 "message"） */
    type?: string;
    /** Token 使用量统计：记录该消息的 token 消耗情况 */
    usage?: {
      /** 输入 token 数：发送给模型的 token 数量 */
      input_tokens: number;
      /** 输出 token 数：模型生成的 token 数量 */
      output_tokens: number;
      /** 缓存创建 token 数：本次请求中被写入缓存的 token 数量（可选） */
      cache_creation_input_tokens?: number;
      /** 缓存读取 token 数：本次请求中从缓存读取的 token 数量（可选，命中缓存可节省费用） */
      cache_read_input_tokens?: number;
    };
  };
  /**
   * 工具调用结果：当 AI 使用 agent 工具（如 Task/SendMessage）时，
   * 子 agent 的执行结果会存储在此字段中。详见 ToolUseResult 接口。
   */
  toolUseResult?: ToolUseResult;
  /** 错误信息：当消息处理过程中发生错误时，记录错误描述文本 */
  error?: string;
  /** 是否为 API 错误消息：标记该消息是否因 API 调用失败而产生 */
  isApiErrorMessage?: boolean;
  /** 思维链元数据：记录 Claude 扩展思维（Extended Thinking）功能的相关配置 */
  thinkingMetadata?: {
    /** 思维级别：如 "high"、"medium" 等，控制思维链的详细程度 */
    level: string;
    /** 是否禁用：为 true 时表示该消息禁用了扩展思维功能 */
    disabled: boolean;
    /** 触发条件列表：记录触发扩展思维的原因或条件 */
    triggers: string[];
  };
  /** 待办事项列表：AI 助手在回复中创建的任务清单 */
  todos?: Todo[];
}

/**
 * 消息内容块接口
 *
 * 表示结构化消息中的单个内容块。一条消息可以包含多个不同类型的内容块，
 * 例如先输出一段文本说明，再调用一个工具，再输出后续文本。
 */
export interface MessageContent {
  /**
   * 内容块类型：
   * - 'text'：纯文本内容块，包含 AI 的文字回复或用户的文本输入
   * - 'tool_use'：工具调用块，表示 AI 请求执行某个工具（如读取文件、运行命令）
   * - 'tool_result'：工具结果块，包含工具执行后的返回结果
   * - 'image'：图片内容块，包含图片数据（通常为 Base64 编码）
   * - 'thinking'：思考内容块，包含 AI 的扩展思维（Extended Thinking）推理过程
   */
  type: 'text' | 'tool_use' | 'tool_result' | 'image' | 'thinking';
  /** 文本内容：当 type 为 'text' 时，存储实际的文本字符串 */
  text?: string;
  /**
   * 思考内容：当 type 为 'thinking' 时，存储 AI 的内部推理过程文本。
   * 这是 Claude 扩展思维（Extended Thinking）功能生成的思维链内容，
   * 帮助用户了解 AI 得出结论的推理步骤。
   */
  thinking?: string;
  /** 内容块 ID：工具调用块的唯一标识符，工具结果通过此 ID 与对应的调用关联 */
  id?: string;
  /** 工具名称：当 type 为 'tool_use' 时，指定要调用的工具名称（如 "Read"、"Bash"、"Edit"） */
  name?: string;
  /** 工具输入参数：当 type 为 'tool_use' 时，传递给工具的参数对象 */
  input?: Record<string, unknown>;
  /** 关联的工具调用 ID：当 type 为 'tool_result' 时，指向对应的 tool_use 内容块的 ID */
  tool_use_id?: string;
  /**
   * 嵌套内容：当 type 为 'tool_result' 时，工具的返回结果。
   * 可以是简单字符串，也可以是嵌套的 MessageContent 数组（如包含文本和图片的复合结果）。
   */
  content?: string | MessageContent[];
  /**
   * 图片数据源：当 type 为 'image' 时，包含图片的编码数据信息。
   * 通过 media_type 和 data 字段可以构造完整的 data URI 用于渲染。
   */
  source?: {
    /** 数据源类型：通常为 "base64"，表示图片数据采用 Base64 编码 */
    type: string;
    /** MIME 类型：图片的媒体类型，如 "image/png"、"image/jpeg" 等 */
    media_type: string;
    /** 图片数据：Base64 编码的图片二进制数据 */
    data: string;
  };
  /**
   * 错误标志：当 type 为 'tool_result' 时，指示工具执行是否发生了错误。
   * 为 true 表示工具执行失败，UI 应以红色错误样式渲染此结果块。
   */
  is_error?: boolean;
}

/**
 * 工具调用结果接口
 *
 * 当 AI 使用 agent 类工具（如 Task 工具派生子 agent）时，
 * 子 agent 完成任务后的执行结果和统计信息会封装在此结构中。
 * 这是 Claude Code 多 agent 协作机制的核心数据结构之一。
 */
export interface ToolUseResult {
  /** 执行状态：如 "success"、"error"、"timeout" 等，标识子 agent 的完成状态 */
  status: string;
  /** 任务提示词：发送给子 agent 的原始任务描述（即 agent 调用时的 prompt 参数） */
  prompt?: string;
  /** Agent ID：子 agent 的唯一标识符，用于追踪多 agent 场景中的调用关系 */
  agentId?: string;
  /** 输出内容：子 agent 生成的结构化回复内容（MessageContent 数组） */
  content?: MessageContent[];
  /** 总执行时长（毫秒）：子 agent 从启动到完成的总耗时 */
  totalDurationMs?: number;
  /** 总 token 消耗：子 agent 在整个执行过程中消耗的 token 总数 */
  totalTokens?: number;
  /** 工具调用次数：子 agent 在执行过程中调用工具的总次数 */
  totalToolUseCount?: number;
  /** Token 使用量明细：区分输入和输出的 token 消耗统计 */
  usage?: {
    /** 输入 token 数 */
    input_tokens: number;
    /** 输出 token 数 */
    output_tokens: number;
  };
}

/**
 * 待办事项接口
 *
 * 表示 AI 助手在回复中创建的单个任务项，用于跟踪工作进度。
 * 对应 Claude Code 的 TodoWrite 工具输出。
 */
export interface Todo {
  /** 任务内容：描述待办事项的具体内容 */
  content: string;
  /**
   * 任务状态：
   * - 'pending'：待处理，任务尚未开始
   * - 'in_progress'：进行中，任务正在执行
   * - 'completed'：已完成，任务已结束
   */
  status: 'pending' | 'in_progress' | 'completed';
  /** 活动表单标识：关联的表单或上下文标识符，用于分组管理待办事项 */
  activeForm: string;
}

/**
 * 项目接口
 *
 * 表示一个 Claude Code 项目，对应 ~/.claude/projects/ 下的一个子目录。
 * 目录名是项目路径的编码形式（如 "G--ClaudeProjects-Test" 对应 "G:\ClaudeProjects\Test"）。
 */
export interface Project {
  /** 项目名称：编码后的目录名，同时也是 projects 目录下的子目录名 */
  name: string;
  /** 项目路径：解码还原后的完整文件系统路径 */
  path: string;
  /** 会话列表：该项目下的所有聊天会话，按时间倒序排列 */
  sessions: Session[];
}

/**
 * 会话接口
 *
 * 表示一次独立的 Claude Code 对话会话，对应一个 .jsonl 文件。
 * 每个会话包含若干条 SessionMessage 记录。
 */
export interface Session {
  /** 会话 ID：对应 JSONL 文件名（不含扩展名），通常是 UUID 格式 */
  id: string;
  /** 会话名称：用户自定义的会话显示名称（可选，未设置时使用 ID 或首条消息） */
  name?: string;
  /** 会话时间戳：基于 JSONL 文件的最后修改时间 */
  timestamp: Date;
  /** 消息数量：该会话中包含的消息条数（初始加载时可能为 0，需要读取文件后更新） */
  messageCount: number;
  /** 文件路径：JSONL 文件的完整绝对路径，用于后续读取会话内容 */
  filePath: string;
}

/**
 * 文件历史快照接口
 *
 * 表示某一时刻被 Claude Code 追踪的文件的备份快照。
 * 当 AI 修改文件时，Claude Code 会自动创建快照，便于用户回滚到修改前的状态。
 */
export interface FileHistorySnapshot {
  /** 固定类型标识：始终为 'file-history-snapshot' */
  type: 'file-history-snapshot';
  /** 关联的消息 ID：触发此快照的消息的 UUID */
  messageId: string;
  /** 快照数据 */
  snapshot: {
    /** 消息 ID：与外层 messageId 对应 */
    messageId: string;
    /** 文件备份集合：被追踪文件的路径到备份内容的映射 */
    trackedFileBackups: Record<string, unknown>;
    /** 快照创建时间：ISO 8601 格式的时间戳 */
    timestamp: string;
  };
  /** 是否为快照更新：为 true 表示这是对已有快照的增量更新，而非全新快照 */
  isSnapshotUpdate: boolean;
}

/**
 * 应用状态接口
 *
 * 定义了 CCR 应用的全局状态结构。
 * 注意：此接口当前已定义但尚未在应用中使用。
 * 应用目前通过 App.tsx 中的多个独立 useState 管理状态。
 * 保留此接口以备将来重构为集中式状态管理（如 useReducer 或 Zustand）时使用。
 */
export interface AppState {
  /** Claude Code 设置 */
  settings: ClaudeSettings;
  /** 所有项目列表 */
  projects: Project[];
  /** 当前选中的项目（null 表示未选择） */
  currentProject: Project | null;
  /** 当前选中的会话（null 表示未选择） */
  currentSession: Session | null;
  /** 当前会话的消息列表 */
  messages: SessionMessage[];
  /** 界面主题：'light' 浅色、'dark' 深色、'system' 跟随系统 */
  theme: 'light' | 'dark' | 'system';
  /** Claude 数据目录路径：即 ~/.claude/ 的完整路径 */
  claudeDataPath: string;
}
