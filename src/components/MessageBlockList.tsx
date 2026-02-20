/**
 * @file MessageBlockList.tsx - 消息内容块列表组件
 * @description
 * 作为消息内容渲染的入口组件，负责将 DisplayMessage 的 content 字段
 * 转换为可视化的内容块列表。
 *
 * v2.0 重构：
 * - 直接接收 content: MessageContent[] 和 toolUseMap: Record<string, ToolUseInfo>
 * - 不再依赖 SessionMessage，数据由 Rust 后端预处理
 */

import type { MessageContent, ToolUseInfo } from '../types/claude';
import { MessageContentRenderer } from './MessageContentRenderer';

/**
 * MessageBlockList 组件的属性接口
 */
interface MessageBlockListProps {
  /** 已由 Rust 后端提取的内容块数组 */
  content: MessageContent[];
  /** 当前项目根目录路径，传递给内容块渲染器用于路径简化 */
  projectPath: string;
  /** tool_use_id → ToolUseInfo 映射（Rust HashMap 序列化为 Record） */
  toolUseMap: Record<string, ToolUseInfo>;
}

/**
 * MessageBlockList - 消息内容块列表包装组件
 *
 * 遍历 content 数组，将每个块委托给 MessageContentRenderer 渲染。
 * content 已由 Rust 后端从原始消息中提取，前端无需再做格式判断。
 *
 * @param props - 包含待渲染的内容块数组和上下文信息
 * @returns 渲染后的 JSX 元素
 */
export function MessageBlockList({ content, projectPath, toolUseMap }: MessageBlockListProps) {
  if (content.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        [无消息内容]
      </div>
    );
  }

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
