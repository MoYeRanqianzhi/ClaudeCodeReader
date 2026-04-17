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
   * - 'attachment'：附件消息（v0.4.0 新增，参与对话链）
   * - 'system'：系统消息（v0.4.0 新增，参与对话链的系统类型消息）
   * - 'file-history-snapshot'：文件历史快照（记录某一时刻被追踪文件的备份状态，用于撤销操作）
   * - 'queue-operation'：队列操作标记（表示后台排队的操作，如等待中的 API 请求）
   * - 'custom-title'：自定义标题（用户为会话设置的自定义显示名称）
   * - 'ai-title'：AI 生成标题（v0.4.0 新增，AI 自动生成的会话标题）
   * - 'tag'：标签标记（用于对会话或消息进行分类标注）
   * - 'summary'：会话摘要（v0.4.0 新增）
   * - 'last-prompt'：最后一条用户输入（v0.4.0 新增）
   */
  type: 'user' | 'assistant' | 'attachment' | 'system' | 'file-history-snapshot' | 'queue-operation' | 'custom-title' | 'ai-title' | 'tag' | 'summary' | 'last-prompt';
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
  /**
   * 是否为压缩摘要消息。
   * 当 Claude Code 会话上下文超出限制时，会自动触发压缩（compact），
   * 将之前的对话历史浓缩为一条摘要消息插入到新上下文中。
   * 这类消息的 content 通常以
   * "This session is being continued from a previous conversation that ran out of context."
   * 开头。仅在自动压缩生成的消息上为 true，普通用户消息不包含此字段。
   */
  isCompactSummary?: boolean;
  /**
   * 是否为元数据消息。
   * Claude Code 在某些场景下会向对话注入元数据消息（如技能加载上下文、系统告示等），
   * 这些消息的 type 仍为 'user'，但 isMeta 为 true。
   */
  isMeta?: boolean;
  /**
   * 调用者信息：标识该消息由哪个系统组件自动生成。
   * 典型场景：user-prompt-submit-hook 等钩子函数触发的自动消息。
   * 普通用户手动输入的消息不包含此字段。
   */
  caller?: unknown;
  /**
   * 源工具调用 ID：当此消息由 Claude 的工具调用（如 Skill tool）触发注入时，
   * 此字段指向触发注入的 tool_use 块的 ID（格式为 "toolu_xxx"）。
   * 典型场景：skill 加载上下文和 skill 扩展后的完整提示词。
   * 普通用户手动输入的消息不包含此字段。
   */
  sourceToolUseID?: string;
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
   * - 'redacted_thinking'：已编辑的思考内容块，包含被编辑的思维数据
   * - 'server_tool_use'：服务端工具调用块（v0.4.0 新增），如 web_search、web_fetch 等
   * - 'web_search_tool_result'：网页搜索结果块（v0.4.0 新增），包含搜索结果内容
   * - 'citation'：引用块（v0.4.0 新增），包含引用来源信息
   */
  type: 'text' | 'tool_use' | 'tool_result' | 'image' | 'thinking' | 'redacted_thinking' | 'server_tool_use' | 'web_search_tool_result' | 'citation';
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
 *
 * ## v0.4.0 新增字段
 * 通过 scanner 的 head+tail 轻量读取策略提取的元数据字段：
 * summary、firstPrompt、gitBranch、cwd、tag、createdAt、fileSize、isSidechain
 *
 * ## 标题优先级
 * `name` 字段按以下优先级填充：customTitle > aiTitle > lastPrompt
 * 如果都不存在，前端可回退使用 summary 或 firstPrompt 作为显示文本。
 */
export interface Session {
  /** 会话 ID：对应 JSONL 文件名（不含扩展名），通常是 UUID 格式 */
  id: string;
  /** 会话名称：优先级 customTitle > aiTitle > lastPrompt（可选） */
  name?: string;
  /** 会话时间戳：基于 JSONL 文件的最后修改时间 */
  timestamp: Date;
  /** 消息数量：该会话中包含的消息条数（初始加载时可能为 0，需要读取文件后更新） */
  messageCount: number;
  /** 文件路径：JSONL 文件的完整绝对路径，用于后续读取会话内容 */
  filePath: string;
  /** 会话摘要：从 JSONL 尾部的 summary 条目中提取 */
  summary?: string;
  /** 首条用户消息文本：从 JSONL 头部第一条 user 消息中提取（最多 200 字符） */
  firstPrompt?: string;
  /** Git 分支名：从 JSONL 消息的 gitBranch 字段中提取（尾部优先） */
  gitBranch?: string;
  /** 工作目录：从 JSONL 头部消息的 cwd 字段中提取 */
  cwd?: string;
  /** 会话标签：从 JSONL 尾部的 tag 条目中提取 */
  tag?: string;
  /** 创建时间：从 JSONL 头部第一条消息的 timestamp 字段提取（ISO 8601） */
  createdAt?: string;
  /** 文件大小：JSONL 文件的字节数 */
  fileSize?: number;
  /** 是否为侧链会话：子 agent 或分支对话 */
  isSidechain: boolean;
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

/**
 * 显示用消息接口
 *
 * 由 Rust 后端 `transformer::transform_session` 生成，
 * 是原始 SessionMessage（serde_json::Value）经过分类、拆分和重组后的显示层数据结构。
 *
 * ## 与旧版的核心变化
 * - **移除 `rawMessage`**：不再持有原始 SessionMessage 引用，所有需要的字段已直接提取
 * - **Rust 直传**：所有字段由 Rust 后端计算后通过 IPC 传输，前端零文本处理
 * - **倒序排列**：数组中最新消息在前，配合 CSS `column-reverse`
 *
 * @see TransformedSession - 包含此类型的顶层 IPC 返回结构
 */
export interface DisplayMessage {
  /** 原始消息的 UUID，用于编辑/删除操作时映射回原始数据 */
  sourceUuid: string;
  /**
   * 显示用唯一标识符，用作 React key：
   * - 原始消息：直接使用 uuid
   * - 拆分出的工具结果：使用 "uuid-tool-N" 格式（N 为序号）
   */
  displayId: string;
  /**
   * 显示类型，决定消息气泡的视觉样式：
   * - 'user'：用户消息（蓝色调），包括斜杠命令（经过内容提取后显示）
   * - 'assistant'：助手消息（灰色调）
   * - 'tool_result'：工具结果（绿色调，从 user 消息中拆分而来）
   * - 'compact_summary'：压缩摘要（青绿色调，自动压缩生成的上下文续接消息）
   * - 'system'：系统消息（淡灰色调，CLI 自动注入的非用户消息，默认折叠）
   */
  displayType: 'user' | 'assistant' | 'tool_result' | 'compact_summary' | 'system';
  /** 时间戳：继承自原始消息的 ISO 8601 时间字符串 */
  timestamp: string;
  /** 内容块列表：仅包含属于该 DisplayMessage 的内容块 */
  content: MessageContent[];
  /** 是否可编辑 */
  editable: boolean;
  /**
   * 块索引映射：blockIndexMap[i] 表示 content[i] 在原始消息 content 数组中的索引。
   * 编辑操作时通过此映射将修改精确回写到原始消息的正确位置。
   */
  blockIndexMap: number[];
  // ---- assistant 专属字段 ----
  /** AI 模型标识符（仅 assistant 消息） */
  model: string | null;
  /** Token 使用量统计（仅 assistant 消息） */
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } | null;
  /** 子 agent 执行结果（仅包含 toolUseResult 的消息） */
  toolUseResult: ToolUseResult | null;
  /** 待办事项列表（仅包含 todos 的消息） */
  todos: Todo[] | null;
  // ---- system 专属字段 ----
  /**
   * 系统消息子类型标签（仅 displayType === 'system' 时使用）。
   * - '技能'：isMeta 且以 "Base directory for this skill:" 开头的技能加载消息
   * - '计划'：严格匹配 "Implement the following plan:" 格式的计划执行消息
   * - '系统'：其余所有系统消息（命令输出、钩子、caller 等）
   */
  systemLabel: string | null;
  /**
   * 计划消息引用的源会话 JSONL 文件路径（仅 systemLabel === '计划' 时有值）。
   * 从 "read the full transcript at: <path>.jsonl" 中提取。
   */
  planSourcePath: string | null;
  // ---- 通用元数据 ----
  /** 当前工作目录 */
  cwd: string | null;
  /** 是否为遗弃消息（不在主链上）
   *  主链 = 从 JSONL 最后一条消息沿 parentUuid 回溯到根的路径 */
  isAbandoned: boolean;
}

/**
 * tool_use 块的摘要信息
 *
 * 由 Rust 后端从 assistant 消息的 content 中提取，
 * 供 tool_result 渲染器查询关联的工具名称和参数。
 */
export interface ToolUseInfo {
  /** 工具名称，如 "Read"、"Bash"、"Edit" */
  name: string;
  /** 工具输入参数 */
  input: Record<string, unknown>;
}

/**
 * Token 统计汇总接口
 *
 * 由 Rust 后端累加整个会话中所有 assistant 消息的 token 使用量，
 * 供前端在会话头部一次性展示总计数据。
 *
 * ## v0.4.0 新增字段
 * - webSearchRequests：服务端网页搜索请求总次数
 * - webFetchRequests：服务端网页获取请求总次数
 */
export interface TokenStats {
  /** 输入 token 总数 */
  inputTokens: number;
  /** 输出 token 总数 */
  outputTokens: number;
  /** 缓存创建 token 总数 */
  cacheCreationInputTokens: number;
  /** 缓存读取 token 总数 */
  cacheReadInputTokens: number;
  /** 服务端网页搜索请求总次数（来自 usage.server_tool_use.web_search_requests） */
  webSearchRequests: number;
  /** 服务端网页获取请求总次数（来自 usage.server_tool_use.web_fetch_requests） */
  webFetchRequests: number;
}

/**
 * Rust 后端通过 IPC 返回的完整转换结果
 *
 * 包含前端渲染所需的所有数据，是前端唯一的数据源：
 * - `displayMessages`：倒序排列（最新在前），配合 CSS `column-reverse`
 * - `toolUseMap`：tool_use_id → ToolUseInfo 映射
 * - `tokenStats`：整个会话的 Token 使用量汇总
 */
export interface TransformedSession {
  /** 倒序排列的显示消息列表（最新在前） */
  displayMessages: DisplayMessage[];
  /** tool_use_id → ToolUseInfo 映射 */
  toolUseMap: Record<string, ToolUseInfo>;
  /** Token 统计汇总 */
  tokenStats: TokenStats;
}

/**
 * 搜索高亮选项接口
 *
 * 封装搜索关键词和搜索模式，用于在渲染链中传递高亮参数。
 * 替代旧的 `highlightQuery: string` prop，支持大小写敏感和正则模式。
 *
 * 传播路径：ChatView → MessageBlockList → MessageContentRenderer →
 *           MarkdownRenderer（通过 rehype 插件）/ ToolResultRenderer（通过 HighlightedText）
 */
export interface SearchHighlight {
  /** 搜索关键词（原始输入，不做大小写转换） */
  query: string;
  /**
   * 是否大小写敏感。
   * - false（默认）：忽略大小写匹配，与 Rust 后端 case_sensitive=false 一致
   * - true：严格匹配大小写
   */
  caseSensitive: boolean;
  /**
   * 是否为正则表达式模式。
   * - false（默认）：普通字面量子串搜索
   * - true：将 query 作为正则表达式处理（JavaScript RegExp / Rust regex crate）
   */
  useRegex: boolean;
}

/**
 * 一键 Resume 功能配置接口
 *
 * 存储用户在设置面板中配置的 Claude CLI resume 参数。
 * 配置文件路径：`~/.mo/CCR/resume-config.json`
 *
 * 对应 Rust 后端 `commands::tools::ResumeConfig` 结构体。
 */
export interface ResumeConfig {
  /** 勾选的 CLI flag 列表，如 ["--dangerously-skip-permissions", "--verbose"] */
  flags: string[];
  /** 用户自定义的额外参数字符串（追加在命令末尾） */
  customArgs: string;
}

/**
 * 备份配置接口
 *
 * 控制主动备份（.ccbak）的启用状态。
 * 临时备份始终启用，不受此配置影响。
 * 配置文件路径：`~/.mo/CCR/backup-config.json`
 *
 * 对应 Rust 后端 `services::file_guard::BackupConfig` 结构体。
 */
export interface BackupConfig {
  /** 是否启用主动备份（在原文件同目录创建 .ccbak 文件） */
  autoBackupEnabled: boolean;
}

/**
 * 修复档位级别
 *
 * 四个档位从低到高，权限逐渐递增：
 * - entry: 条目修复，只能操作解析后的消息条目
 * - content: 内容修复，可读写文件原始文本
 * - file: 文件修复，拥有对该文件的直接操作权限
 * - full: 特殊修复，完全权限无限制
 *
 * 对应 Rust 后端 `services::fixers::FixLevel` 枚举。
 */
export type FixLevel = 'entry' | 'content' | 'file' | 'full';

/**
 * 修复选项参数类型标识
 *
 * 标识前端应渲染哪种输入控件。
 *
 * 对应 Rust 后端 `services::fixers::FixOptionType` 枚举。
 */
export type FixOptionType = 'number' | 'boolean';

/**
 * 修复选项参数定义接口
 *
 * 描述一个修复项支持的可配置参数，前端据此渲染输入控件。
 *
 * 对应 Rust 后端 `services::fixers::FixOptionDef` 结构体。
 */
export interface FixOptionDef {
  /** JSON 键名（如 "keep_last"），传递给 execute 时使用 */
  key: string;
  /** 显示标签（如 "保留最后 N 张图片"） */
  label: string;
  /** 参数类型，决定渲染的控件 */
  optionType: FixOptionType;
  /** 默认值 */
  defaultValue: number | boolean;
  /** 可选的补充说明 */
  description?: string;
}

/**
 * 一键修复项定义接口
 *
 * 描述一个修复项的完整元数据，供弹窗列表展示和搜索过滤。
 * 配合 `FixResult` 接口实现修复执行反馈。
 *
 * 对应 Rust 后端 `services::fixers::FixDefinition` 结构体。
 */
export interface FixDefinition {
  /** 唯一标识符（如 "strip_thinking"），用于定位执行修复 */
  id: string;
  /** 问题名称（如 "400 (thinking block) 错误"） */
  name: string;
  /** 问题详细描述，可以是多行文本 */
  description: string;
  /** 修复方式说明 */
  fixMethod: string;
  /** 搜索标签，扩展搜索范围 */
  tags: string[];
  /** 修复档位级别，决定权限范围和 UI 标注样式 */
  level: FixLevel;
  /** 可配置的选项参数列表（为空数组表示无需参数） */
  options: FixOptionDef[];
}

/**
 * 一键修复执行结果接口
 *
 * 修复执行完成后由 Rust 后端返回，展示修复结果。
 *
 * 对应 Rust 后端 `services::fixers::FixResult` 结构体。
 */
export interface FixResult {
  /** 修复是否成功完成 */
  success: boolean;
  /** 结果消息（成功提示或错误原因） */
  message: string;
  /** 受影响的消息行数 */
  affectedLines: number;
}

// =============================================================================
// 中转抓包代理相关类型
// =============================================================================

/**
 * 代理工作模式
 *
 * 三种模式对应不同的请求处理策略。
 * 对应 Rust 后端 `models::proxy::ProxyMode` 枚举。
 */
export type ProxyMode = 'overview' | 'inspect' | 'intercept';

/**
 * 代理运行状态
 *
 * 对应 Rust 后端 `models::proxy::ProxyStatus` 结构体。
 */
export interface ProxyStatus {
  /** 代理是否正在运行 */
  running: boolean;
  /** 代理监听的端口号 */
  port: number | null;
  /** 当前工作模式 */
  mode: ProxyMode;
  /** 上游 API 的原始 URL */
  upstreamUrl: string | null;
  /** 当前待处理的拦截请求数量 */
  pendingIntercepts: number;
}

/**
 * 请求记录状态
 *
 * 对应 Rust 后端 `models::proxy::RecordStatus` 枚举。
 */
export type RecordStatus = 'pending' | 'intercepted' | 'responseIntercepted' | 'completed' | 'dropped' | 'error';

/**
 * 代理记录摘要
 *
 * 对应 Rust 后端 `models::proxy::ProxyRecord` 结构体。
 */
export interface ProxyRecord {
  /** 记录唯一 ID */
  id: number;
  /** HTTP 方法 */
  method: string;
  /** 请求 URL 路径 */
  url: string;
  /** 请求状态 */
  status: RecordStatus;
  /** HTTP 响应状态码 */
  statusCode: number | null;
  /** 请求耗时（毫秒） */
  durationMs: number | null;
  /** 响应体大小（字节） */
  responseSize: number | null;
  /** 请求发起时间 */
  timestamp: string;
}

/**
 * 代理记录详情
 *
 * 对应 Rust 后端 `models::proxy::ProxyRecordDetail` 结构体。
 */
export interface ProxyRecordDetail {
  /** 记录摘要 */
  summary: ProxyRecord;
  /** 请求 headers */
  requestHeaders: Record<string, string>;
  /** 请求 body */
  requestBody: string | null;
  /** 响应 headers */
  responseHeaders: Record<string, string>;
  /** 响应 body */
  responseBody: string | null;
  /** 错误信息 */
  errorMessage: string | null;
}

/**
 * 拦截决策
 *
 * 对应 Rust 后端 `models::proxy::InterceptAction` 枚举。
 */
export type InterceptAction =
  | { type: 'forward' }
  | { type: 'forwardModified'; headers?: Record<string, string>; body?: string }
  | { type: 'drop'; statusCode: number }
  | { type: 'mockResponse'; statusCode: number; headers: Record<string, string>; body: string };

/**
 * 响应拦截决策
 *
 * 在拦截模式下，上游响应到达后，用户对响应做出的处理决策。
 * 对应 Rust 后端 `models::proxy::InterceptResponseAction` 枚举。
 */
export type InterceptResponseAction =
  | { type: 'forward' }
  | { type: 'forwardModified'; headers?: Record<string, string>; body?: string }
  | { type: 'drop'; statusCode: number };

// ============================= Skills 系统类型 =============================

/**
 * Skill 来源类型
 *
 * 标识 skill 从哪个目录层级加载。
 * 对应 Rust 后端 `models::skill::SkillSource` 枚举。
 */
export type SkillSource = 'user' | 'project' | 'legacyCommands' | 'managed' | 'bundled';

/**
 * Skill 信息摘要
 *
 * 用于列表展示的 skill 基本信息，不包含完整 markdown 内容。
 * 对应 Rust 后端 `models::skill::SkillInfo` 结构体。
 */
export interface SkillInfo {
  /** Skill 名称（目录名，用作 /skill-name 调用标识符） */
  name: string;
  /** 显示名称（frontmatter 中的 name 字段，可能与目录名不同） */
  displayName?: string;
  /** 描述文本 */
  description: string;
  /** 来源类型 */
  source: SkillSource;
  /** 来源文件的完整路径（SKILL.md 的绝对路径） */
  sourcePath: string;
  /** 是否允许用户通过 /skill-name 直接调用 */
  userInvocable: boolean;
  /** 模型覆盖（如 "haiku", "sonnet", "opus"） */
  model?: string;
  /** 执行上下文（"inline" 或 "fork"） */
  context?: string;
  /** 允许使用的工具列表 */
  allowedTools: string[];
  /** 使用场景说明 */
  whenToUse?: string;
  /** 版本号 */
  version?: string;
  /** 参数提示 */
  argumentHint?: string;
  /** 路径过滤模式 */
  paths?: string[];
}

/**
 * Skill 详情
 *
 * 包含完整 markdown 内容的 skill 信息。
 * 对应 Rust 后端 `models::skill::SkillDetail` 结构体。
 */
export interface SkillDetail extends SkillInfo {
  /** SKILL.md 的完整原始内容（包含 frontmatter） */
  rawContent: string;
  /** 去除 frontmatter 后的纯 markdown 内容 */
  markdownContent: string;
}

// ============================= Plugins 系统类型 =============================

/**
 * 插件安装作用域
 *
 * 对应 Rust 后端 `models::plugin::PluginScope` 枚举。
 */
export type PluginScope = 'managed' | 'user' | 'project' | 'local';

/**
 * 插件作者信息
 *
 * 对应 Rust 后端 `models::plugin::PluginAuthor` 结构体。
 */
export interface PluginAuthor {
  /** 作者/组织的显示名称 */
  name: string;
  /** 联系邮箱 */
  email?: string;
  /** 网站 URL */
  url?: string;
}

/**
 * 插件信息摘要
 *
 * 聚合了安装元数据、启用状态和清单信息的前端展示用数据结构。
 * 对应 Rust 后端 `models::plugin::PluginInfo` 结构体。
 */
export interface PluginInfo {
  /** 插件 ID（格式："plugin-name@marketplace-name"） */
  id: string;
  /** 插件名称 */
  name: string;
  /** 所属 marketplace 名称 */
  marketplace: string;
  /** 插件描述 */
  description?: string;
  /** 当前安装版本 */
  version?: string;
  /** 作者信息 */
  author?: PluginAuthor;
  /** 主页 URL */
  homepage?: string;
  /** 源码仓库 URL */
  repository?: string;
  /** 许可证 */
  license?: string;
  /** 关键词标签 */
  keywords?: string[];
  /** 是否已启用 */
  enabled: boolean;
  /** 安装作用域 */
  scope: PluginScope;
  /** 安装路径 */
  installPath: string;
  /** 安装时间（ISO 8601） */
  installedAt?: string;
  /** 最后更新时间（ISO 8601） */
  lastUpdated?: string;
}

/**
 * Marketplace 信息摘要
 *
 * 对应 Rust 后端 `models::plugin::MarketplaceInfo` 结构体。
 */
export interface MarketplaceInfo {
  /** marketplace 名称 */
  name: string;
  /** 来源类型（如 "github", "npm", "local"） */
  sourceType: string;
  /** 来源详情（如 "anthropics/claude-plugins"） */
  sourceDetail: string;
  /** 本地缓存路径 */
  installLocation: string;
  /** 最后更新时间 */
  lastUpdated: string;
  /** 是否自动更新 */
  autoUpdate: boolean;
}

/**
 * 插件操作结果
 *
 * 对应 Rust 后端 `models::plugin::PluginActionResult` 结构体。
 */
export interface PluginActionResult {
  /** 操作是否成功 */
  success: boolean;
  /** 结果消息 */
  message: string;
}
