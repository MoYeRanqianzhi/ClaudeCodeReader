/**
 * @file messageTransform.ts - 消息预处理转换层
 * @description
 * 将原始 SessionMessage[] 转换为 DisplayMessage[]，核心转换逻辑：
 * - assistant 消息保持不变
 * - user 消息中的 tool_result 块拆分为独立的 DisplayMessage
 * - 自动检测并标记压缩摘要（compact_summary）和系统消息（system）
 * - 斜杠命令（/compact 等）提取指令内容后作为用户消息显示
 * - 构建 tool_use_id → tool_use 块的关联索引，供工具结果渲染器查询工具名
 *
 * 此模块是纯函数，不涉及 I/O 或副作用。
 */

import type { SessionMessage, MessageContent, DisplayMessage } from '../types/claude';

/**
 * tool_use 块的摘要信息，供 tool_result 渲染器查询
 */
export interface ToolUseInfo {
  /** 工具名称，如 "Read"、"Bash"、"Edit" */
  name: string;
  /** 工具输入参数 */
  input: Record<string, unknown>;
}

/**
 * 从包含 <command-name> 标签的文本中提取斜杠命令名称。
 * 例如从 "<command-name>/compact</command-name> ..." 中提取 "/compact"。
 *
 * @param text - 消息文本内容
 * @returns 提取到的命令名（如 "/compact"），未匹配则返回 null
 */
function extractSlashCommand(text: string): string | null {
  const match = text.match(/<command-name>(\/[^<]+)<\/command-name>/);
  return match ? match[1] : null;
}

/**
 * 匹配 "Implement the following plan:" 消息结尾处的 JSONL 文件路径。
 * 例如：read the full transcript at: C:\Users\MoYeR\.claude\projects\G--xxx\uuid.jsonl
 */
const PLAN_JSONL_RE = /read the full transcript at:\s*(.+?\.jsonl)/;

/**
 * 严格判断一段文本是否为"计划执行"消息。
 * 必须同时满足三个条件：
 * 1. 文本以 "Implement the following plan:\n\n#" 开头
 * 2. 文本结尾区域包含 "read the full transcript at: <path>.jsonl" 引用
 * 3. 文本中包含 Markdown 标题结构（至少有 # 一级或 ## 二级标题）
 *
 * @param text - 消息的纯文本内容
 * @returns match 为 true 时，jsonlPath 为提取到的源会话文件路径
 */
function isPlanExecution(text: string): { match: boolean; jsonlPath?: string } {
  // 条件1：开头严格匹配
  if (!text.startsWith('Implement the following plan:\n\n#')) return { match: false };
  // 条件2：结尾包含 .jsonl 引用
  const m = text.match(PLAN_JSONL_RE);
  if (!m) return { match: false };
  // 条件3：包含 Markdown 标题（一级 # 或二级 ##）
  if (!/^#{1,2}\s/m.test(text)) return { match: false };
  return { match: true, jsonlPath: m[1] };
}

/**
 * 用于匹配系统自动注入内容的正则表达式集合。
 * 当 user 消息的文本 content 匹配以下任一模式时，判定为系统消息而非用户手动输入。
 *
 * 注意：仅包含高置信度模式，避免误判用户真实消息。
 * 斜杠命令（<command-name>）不在此列表中，它们被单独处理为用户消息。
 *
 * 包含的模式：
 * - <local-command-stdout>：CLI 命令的标准输出（如 compact 的终端输出）
 * - <local-command-caveat>：CLI 对本地命令输出的附加告知
 * - <system-reminder>：系统提醒注入（如 hook 输出、环境信息等）
 * - <user-prompt-submit-hook>：提交钩子输出
 */
const SYSTEM_CONTENT_PATTERNS: RegExp[] = [
  /<local-command-stdout>/,
  /<local-command-caveat>/,
  /<system-reminder>/,
  /<user-prompt-submit-hook>/,
];

/**
 * 判断一条 user 类型的 SessionMessage 是否为系统自动生成的消息（非用户手动输入）。
 * 不包含斜杠命令（由 extractSlashCommand 单独处理）。
 *
 * 采用两级判断策略：
 * 1. 字段级判断（最可靠）：检查 isMeta、caller 等 Claude Code 自动标记的字段
 * 2. 内容级判断（兜底）：通过正则匹配 content 中的系统 XML 标签
 *
 * @param msg - 待检测的 SessionMessage（已确认 type === 'user'）
 * @param text - 已提取的消息纯文本内容
 * @returns true 表示该消息为系统自动生成
 */
function isSystemMessage(msg: SessionMessage, text: string): boolean {
  // ---- 字段级判断 ----
  // isMeta: 由 Claude Code 标记的元数据消息（如 skill 加载上下文、local-command-caveat）
  if (msg.isMeta) return true;
  // caller: 由钩子（hook）等自动化组件触发的消息
  if (msg.caller !== undefined) return true;

  // ---- 计划执行消息（严格三条件匹配） ----
  if (isPlanExecution(text).match) return true;

  // ---- 内容级判断（正则兜底） ----
  for (const pattern of SYSTEM_CONTENT_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  return false;
}

/**
 * 为已确认的系统消息计算子类型标签和附加字段。
 * 返回 systemLabel（"技能"/"计划"/"系统"）及可选的 planSourcePath。
 *
 * @param msg - 原始 SessionMessage
 * @param text - 已提取的消息纯文本内容
 * @returns 包含 systemLabel 和可选 planSourcePath 的对象
 */
function classifySystemMessage(msg: SessionMessage, text: string): {
  systemLabel: string;
  planSourcePath?: string;
} {
  // 优先级1：isMeta 消息细分
  if (msg.isMeta) {
    // "Base directory for this skill:" 开头 → 技能
    if (text.startsWith('Base directory for this skill:')) {
      return { systemLabel: '技能' };
    }
    // 其余 isMeta → 通用系统
    return { systemLabel: '系统' };
  }

  // 优先级2：计划执行消息（严格三条件匹配）
  const planResult = isPlanExecution(text);
  if (planResult.match) {
    return { systemLabel: '计划', planSourcePath: planResult.jsonlPath };
  }

  // 优先级3：其余系统消息（caller、内容正则命中等）
  return { systemLabel: '系统' };
}

/**
 * 从消息中提取纯文本内容，用于正则匹配和斜杠命令检测。
 *
 * @param content - SessionMessage 的 message.content 字段
 * @returns 提取到的纯文本字符串，无文本内容时返回空字符串
 */
function extractText(content: string | MessageContent[] | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is MessageContent & { text: string } => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('\n');
  }
  return '';
}

/**
 * 将原始消息列表转换为显示用消息列表
 *
 * 转换规则：
 * 1. 非 user/assistant 类型的消息被过滤
 * 2. assistant 消息直接映射为 displayType='assistant'
 * 3. isCompactSummary 为 true 的 user 消息标记为 displayType='compact_summary'
 * 4. 包含 <command-name> 的 user 消息提取斜杠命令后作为 displayType='user'
 * 5. 系统自动生成的 user 消息（isMeta/caller/内容正则匹配）标记为 displayType='system'
 * 6. user 消息中的 tool_result 块拆分为独立的 displayType='tool_result' 消息
 * 7. user 消息中的非 tool_result 块保留为 displayType='user'（如果有的话）
 *
 * @param messages - 原始 SessionMessage 列表
 * @returns 转换后的 DisplayMessage 列表（保持原始顺序）和 toolUseMap
 */
export function transformForDisplay(messages: SessionMessage[]): {
  displayMessages: DisplayMessage[];
  toolUseMap: Map<string, ToolUseInfo>;
} {
  const displayMessages: DisplayMessage[] = [];

  // 第一遍扫描：构建 tool_use_id → tool_use 块的映射
  // 用于 tool_result 渲染时查询关联的工具名称和参数
  const toolUseMap = new Map<string, ToolUseInfo>();
  for (const msg of messages) {
    if (msg.type !== 'assistant') continue;
    const content = msg.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use' && block.id) {
        toolUseMap.set(block.id, {
          name: block.name || '未知工具',
          input: block.input || {},
        });
      }
    }
  }

  // 第二遍扫描：拆分并转换消息
  for (const msg of messages) {
    // 过滤非聊天消息
    if (msg.type !== 'user' && msg.type !== 'assistant') continue;

    const content = msg.message?.content;

    // assistant 消息：直接映射，不拆分
    if (msg.type === 'assistant') {
      const blocks = typeof content === 'string'
        ? [{ type: 'text' as const, text: content }]
        : Array.isArray(content) ? content : [];

      displayMessages.push({
        sourceUuid: msg.uuid,
        displayId: msg.uuid,
        displayType: 'assistant',
        timestamp: msg.timestamp,
        content: blocks,
        rawMessage: msg,
        editable: true,
        blockIndexMap: blocks.map((_, i) => i),
      });
      continue;
    }

    // ---- user 消息分类 ----

    // 优先级 1：压缩摘要（isCompactSummary 字段由 Claude Code 自动标记）
    if (msg.isCompactSummary) {
      const text = extractText(content);
      displayMessages.push({
        sourceUuid: msg.uuid,
        displayId: msg.uuid,
        displayType: 'compact_summary',
        timestamp: msg.timestamp,
        content: [{ type: 'text', text }],
        rawMessage: msg,
        editable: false,
        blockIndexMap: [0],
      });
      continue;
    }

    // 提取纯文本用于后续检测
    const text = extractText(content);

    // 优先级 2：斜杠命令 → 提取命令名后作为用户消息
    // 斜杠命令是用户主动发起的操作，归类为 'user'
    const slashCmd = extractSlashCommand(text);
    if (slashCmd) {
      displayMessages.push({
        sourceUuid: msg.uuid,
        displayId: msg.uuid,
        displayType: 'user',
        timestamp: msg.timestamp,
        // 显示内容替换为提取的命令名，原始内容可通过 rawMessage 查看
        content: [{ type: 'text', text: slashCmd }],
        rawMessage: msg,
        editable: false,
        blockIndexMap: [0],
      });
      continue;
    }

    // 优先级 3：系统自动生成的消息（isMeta / caller / 内容正则 / 计划执行）
    if (isSystemMessage(msg, text)) {
      const blocks = typeof content === 'string'
        ? [{ type: 'text' as const, text: content }]
        : Array.isArray(content)
          ? content
          : [];
      // 计算系统消息子类型标签和可选的计划源路径
      const { systemLabel, planSourcePath } = classifySystemMessage(msg, text);
      displayMessages.push({
        sourceUuid: msg.uuid,
        displayId: msg.uuid,
        displayType: 'system',
        timestamp: msg.timestamp,
        content: blocks,
        rawMessage: msg,
        systemLabel,
        planSourcePath,
        editable: false,
        blockIndexMap: blocks.map((_, i) => i),
      });
      continue;
    }

    // 优先级 4：普通 user 消息，需要拆分 tool_result 块
    if (typeof content === 'string') {
      displayMessages.push({
        sourceUuid: msg.uuid,
        displayId: msg.uuid,
        displayType: 'user',
        timestamp: msg.timestamp,
        content: [{ type: 'text', text: content }],
        rawMessage: msg,
        editable: true,
        blockIndexMap: [0],
      });
      continue;
    }

    if (!Array.isArray(content)) {
      // 未知格式，跳过
      continue;
    }

    // 分离 tool_result 块和非 tool_result 块
    const userBlocks: { block: MessageContent; index: number }[] = [];
    const toolResultBlocks: { block: MessageContent; index: number }[] = [];

    content.forEach((block, index) => {
      if (block.type === 'tool_result') {
        toolResultBlocks.push({ block, index });
      } else {
        userBlocks.push({ block, index });
      }
    });

    // 生成用户消息部分（如果有非 tool_result 的内容块）
    if (userBlocks.length > 0) {
      displayMessages.push({
        sourceUuid: msg.uuid,
        displayId: msg.uuid,
        displayType: 'user',
        timestamp: msg.timestamp,
        content: userBlocks.map(b => b.block),
        rawMessage: msg,
        editable: true,
        blockIndexMap: userBlocks.map(b => b.index),
      });
    }

    // 生成工具结果消息（每个 tool_result 块一条独立消息）
    toolResultBlocks.forEach((item, seqIdx) => {
      displayMessages.push({
        sourceUuid: msg.uuid,
        displayId: `${msg.uuid}-tool-${seqIdx}`,
        displayType: 'tool_result',
        timestamp: msg.timestamp,
        content: [item.block],
        rawMessage: msg,
        editable: true,
        blockIndexMap: [item.index],
      });
    });
  }

  return { displayMessages, toolUseMap };
}

/**
 * 从 .jsonl 文件路径中解析出编码的项目名和会话 ID。
 * 路径格式：.../projects/<encodedProject>/<sessionId>.jsonl
 *
 * @param jsonlPath - JSONL 文件的完整路径
 * @returns 解析结果对象，包含 encodedProject 和 sessionId；解析失败返回 null
 *
 * @example
 * parseJsonlPath('C:\\Users\\MoYeR\\.claude\\projects\\G--ClaudeProjects-Test\\abc-123.jsonl')
 * // => { encodedProject: 'G--ClaudeProjects-Test', sessionId: 'abc-123' }
 */
export function parseJsonlPath(jsonlPath: string): { encodedProject: string; sessionId: string } | null {
  // 同时支持正斜杠和反斜杠路径分隔符
  const m = jsonlPath.match(/projects[/\\]([^/\\]+)[/\\]([^/\\]+)\.jsonl$/);
  return m ? { encodedProject: m[1], sessionId: m[2] } : null;
}

/**
 * 计算文件的相对路径
 *
 * 如果 filePath 以 projectPath 开头，返回去掉公共前缀后的相对路径。
 * 路径分隔符统一为正斜杠（/）。
 *
 * @param filePath - 文件绝对路径
 * @param projectPath - 项目根目录路径
 * @returns 相对路径（如果在项目内）或原始路径（如果不在项目内）
 *
 * @example
 * toRelativePath('G:\\Projects\\Test\\src\\main.rs', 'G:\\Projects\\Test')
 * // => 'src/main.rs'
 *
 * toRelativePath('/home/user/other/file.ts', '/home/user/project')
 * // => '/home/user/other/file.ts'（不在项目内，返回原始路径）
 */
export function toRelativePath(filePath: string, projectPath: string): string {
  // 统一为正斜杠以便跨平台比较
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedProject = projectPath.replace(/\\/g, '/').replace(/\/$/, '');

  if (normalizedFile.startsWith(normalizedProject + '/')) {
    return normalizedFile.slice(normalizedProject.length + 1);
  }

  return filePath;
}
