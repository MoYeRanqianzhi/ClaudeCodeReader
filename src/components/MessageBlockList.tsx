/**
 * @file MessageBlockList.tsx - 消息内容块列表组件
 * @description
 * 作为消息内容渲染的入口组件，负责将 DisplayMessage 的 content 字段
 * 转换为可视化的内容块列表。
 *
 * v2.0 重构：
 * - 直接接收 content: MessageContent[] 和 toolUseMap: Record<string, ToolUseInfo>
 * - 不再依赖 SessionMessage，数据由 Rust 后端预处理
 *
 * 性能优化：
 * - 使用 React.memo 包裹，通过浅比较 props 阻止不必要的重渲染。
 *   在编辑消息时，setEditBlocks 触发 ChatView 整体重渲染，但 content / projectPath /
 *   toolUseMap 引用不变（均来自 transformedSession），React.memo 可跳过全部
 *   非编辑消息的 Markdown 解析，将每次按键的渲染开销从 O(N) 降到 O(1)。
 */

import { memo } from 'react';
import type { MessageContent, ToolUseInfo, SearchHighlight } from '../types/claude';
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
  /**
   * 搜索高亮选项。
   * 非空时，穿透到每个 MessageContentRenderer → MarkdownRenderer / ToolResultRenderer。
   * 支持字面量（大小写敏感/不敏感）和正则表达式模式。
   * undefined 时不传递，React.memo 可跳过重渲染。
   */
  searchHighlight?: SearchHighlight;
  /**
   * 搜索导航自动展开信号。
   * true 时，穿透到每个 MessageContentRenderer 中的可折叠组件
   * （thinking / tool_use / tool_result），触发自动展开。
   * false/undefined 时不干预。
   */
  searchAutoExpand?: boolean;
}

/**
 * MessageBlockList - 消息内容块列表包装组件（React.memo 优化）
 *
 * 遍历 content 数组，将每个块委托给 MessageContentRenderer 渲染。
 * content 已由 Rust 后端从原始消息中提取，前端无需再做格式判断。
 *
 * React.memo 确保 props 不变时跳过整个子树的重渲染，
 * 这是编辑卡顿问题的核心修复点。
 *
 * @param props - 包含待渲染的内容块数组和上下文信息
 * @returns 渲染后的 JSX 元素
 */
export const MessageBlockList = memo(function MessageBlockList({ content, projectPath, toolUseMap, searchHighlight, searchAutoExpand }: MessageBlockListProps) {
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
          searchHighlight={searchHighlight}
          searchAutoExpand={searchAutoExpand}
        />
      ))}
    </div>
  );
});
