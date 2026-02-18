/**
 * @file MessageBlockList.tsx - 消息内容块列表组件
 * @description
 * 作为消息内容渲染的入口组件，负责将 SessionMessage 的 content 字段
 * 转换为可视化的内容块列表。
 */

import type { SessionMessage } from '../types/claude';
import type { ToolUseInfo } from '../utils/messageTransform';
import { MessageContentRenderer } from './MessageContentRenderer';

/**
 * MessageBlockList 组件的属性接口
 */
interface MessageBlockListProps {
  /** 要渲染内容的会话消息对象 */
  message: SessionMessage;
  /** 当前项目根目录路径，传递给内容块渲染器用于路径简化 */
  projectPath: string;
  /** tool_use_id → ToolUseInfo 映射，传递给内容块渲染器 */
  toolUseMap: Map<string, ToolUseInfo>;
}

/**
 * MessageBlockList - 消息内容块列表包装组件
 *
 * 统一处理消息 content 字段的两种数据格式，并向下传递 projectPath 和 toolUseMap。
 *
 * @param props - 包含待渲染的消息对象和上下文信息
 * @returns 渲染后的 JSX 元素
 */
export function MessageBlockList({ message, projectPath, toolUseMap }: MessageBlockListProps) {
  if (!message.message) {
    return (
      <div className="text-xs text-muted-foreground italic">
        [无消息内容]
      </div>
    );
  }

  const content = message.message.content;

  if (typeof content === 'string') {
    return (
      <pre className="whitespace-pre-wrap break-words text-sm font-sans">
        {content}
      </pre>
    );
  }

  if (Array.isArray(content)) {
    return (
      <div className="space-y-3">
        {content.map((block, index) => (
          <MessageContentRenderer
            key={index}
            block={block}
            projectPath={projectPath}
            toolUseMap={toolUseMap}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="text-xs text-muted-foreground italic">
      [未知内容格式]
    </div>
  );
}
