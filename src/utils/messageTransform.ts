/**
 * @file messageTransform.ts - 消息预处理转换层
 * @description
 * 将原始 SessionMessage[] 转换为 DisplayMessage[]，核心转换逻辑：
 * - assistant 消息保持不变
 * - user 消息中的 tool_result 块拆分为独立的 DisplayMessage
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
 * 将原始消息列表转换为显示用消息列表
 *
 * 转换规则：
 * 1. 非 user/assistant 类型的消息被过滤
 * 2. assistant 消息直接映射为 displayType='assistant'
 * 3. user 消息中的 tool_result 块拆分为独立的 displayType='tool_result' 消息
 * 4. user 消息中的非 tool_result 块保留为 displayType='user'（如果有的话）
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

    // user 消息：需要拆分 tool_result 块
    if (typeof content === 'string') {
      // 纯字符串 content，作为普通用户消息
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
