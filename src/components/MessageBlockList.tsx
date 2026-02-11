/**
 * @file MessageBlockList.tsx - 消息内容块列表组件
 * @description
 * 作为消息内容渲染的入口组件，负责将 SessionMessage 的 content 字段
 * 转换为可视化的内容块列表。根据 content 的数据格式（字符串 vs 数组）
 * 选择不同的渲染策略。
 *
 * 渲染逻辑：
 * - 无 message 字段：显示空提示
 * - content 为 string：直接渲染为预格式化文本
 * - content 为 MessageContent[]：遍历数组，为每个元素渲染 MessageContentRenderer
 */

import type { SessionMessage } from '../types/claude';
import { MessageContentRenderer } from './MessageContentRenderer';

/**
 * MessageBlockList 组件的属性接口
 */
interface MessageBlockListProps {
  /** 要渲染内容的会话消息对象 */
  message: SessionMessage;
}

/**
 * MessageBlockList - 消息内容块列表包装组件
 *
 * 统一处理消息 content 字段的两种数据格式：
 * 1. 字符串格式（通常是用户的纯文本输入）→ 直接用 <pre> 渲染
 * 2. MessageContent[] 数组格式（AI 回复或结构化消息）→ 遍历渲染每个内容块
 *
 * 此组件作为 ChatView 中消息渲染的统一入口，替代原有的 getMessageText() + <pre> 方案，
 * 使工具调用、思考过程、图片等非文本内容也能正确展示。
 *
 * @param props - 包含待渲染的消息对象
 * @returns 渲染后的 JSX 元素
 */
export function MessageBlockList({ message }: MessageBlockListProps) {
  /* 消息对象缺少 message 字段时的降级显示 */
  if (!message.message) {
    return (
      <div className="text-xs text-muted-foreground italic">
        [无消息内容]
      </div>
    );
  }

  const content = message.message.content;

  /* 字符串格式：直接渲染为预格式化文本 */
  if (typeof content === 'string') {
    return (
      <pre className="whitespace-pre-wrap break-words text-sm font-sans">
        {content}
      </pre>
    );
  }

  /* 数组格式：遍历渲染每个内容块 */
  if (Array.isArray(content)) {
    return (
      <div className="space-y-3">
        {content.map((block, index) => (
          <MessageContentRenderer key={index} block={block} />
        ))}
      </div>
    );
  }

  /* 兜底：未知格式的降级处理 */
  return (
    <div className="text-xs text-muted-foreground italic">
      [未知内容格式]
    </div>
  );
}
