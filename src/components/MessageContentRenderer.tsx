/**
 * @file MessageContentRenderer.tsx - 消息内容块渲染器
 * @description
 * 负责根据 MessageContent 的 type 字段分类渲染不同类型的内容块。
 * 支持以下内容类型：
 * - text：纯文本 / Markdown 格式的文字内容
 * - tool_use：工具调用块 → 委托给 ToolUseRenderer（紧凑 Tool(args) 格式）
 * - tool_result：工具结果块 → 委托给 ToolResultRenderer（折叠 + 打开文件位置）
 * - thinking：AI 思考过程块（默认折叠，斜体淡色显示）
 * - image：图片内容块（通过 Base64 data URI 渲染）
 *
 * 性能优化：
 * - 使用 React.memo 包裹，props 不变时跳过重渲染
 * - 移除 framer-motion（motion.div），使用纯 CSS 动画，零 JS 开销
 */

import { memo } from 'react';
import { Lightbulb } from 'lucide-react';
import type { MessageContent, ToolUseInfo } from '../types/claude';
import { ToolUseRenderer } from './ToolUseRenderer';
import { ToolResultRenderer } from './ToolResultRenderer';
import { MarkdownRenderer } from './MarkdownRenderer';

/**
 * MessageContentRenderer 组件的属性接口
 */
interface MessageContentRendererProps {
  /** 要渲染的单个消息内容块 */
  block: MessageContent;
  /** 当前项目根目录路径，用于工具显示的路径简化 */
  projectPath: string;
  /** tool_use_id → ToolUseInfo 映射（Rust HashMap 序列化为 Record） */
  toolUseMap: Record<string, ToolUseInfo>;
}

/**
 * MessageContentRenderer - 单个消息内容块的渲染组件（React.memo 优化）
 *
 * 根据 block.type 分发到不同的渲染逻辑：
 * - text: Markdown 渲染（通过 MarkdownRenderer）
 * - tool_use: 委托给 ToolUseRenderer（紧凑显示 + Raw 切换）
 * - tool_result: 委托给 ToolResultRenderer（折叠 + 打开文件位置）
 * - thinking: 默认折叠 + 斜体淡色
 * - image: 内联图片展示
 *
 * 所有入场动画使用 CSS @keyframes（animate-msg-in / animate-scale-in），
 * 不引入 framer-motion，由浏览器合成线程执行，不阻塞主线程。
 *
 * @param props - 包含待渲染的内容块对象
 * @returns 渲染后的 JSX 元素
 */
export const MessageContentRenderer = memo(function MessageContentRenderer({ block, projectPath, toolUseMap }: MessageContentRendererProps) {
  switch (block.type) {
    /* ====== 文本内容块（Markdown 渲染） ====== */
    case 'text':
      return (
        <div className="animate-msg-in">
          <MarkdownRenderer content={block.text || ''} />
        </div>
      );

    /* ====== 工具调用块 → 委托给 ToolUseRenderer ====== */
    case 'tool_use':
      return (
        <ToolUseRenderer
          block={block}
          projectPath={projectPath}
        />
      );

    /* ====== 工具结果块 → 委托给 ToolResultRenderer ====== */
    case 'tool_result':
      return (
        <ToolResultRenderer
          block={block}
          toolUseMap={toolUseMap}
          projectPath={projectPath}
          isError={block.is_error}
        />
      );

    /* ====== 思考过程块 ====== */
    case 'thinking':
      return (
        <details className="thinking-block content-block animate-scale-in">
          <summary className="cursor-pointer select-none text-sm">
            <Lightbulb className="w-4 h-4 inline-block shrink-0" /> 思考过程
          </summary>
          <div className="mt-2 italic opacity-70">
            <MarkdownRenderer content={block.thinking || block.text || ''} />
          </div>
        </details>
      );

    /* ====== 图片内容块 ====== */
    case 'image':
      if (block.source?.data && block.source?.media_type) {
        const dataUri = `data:${block.source.media_type};base64,${block.source.data}`;
        return (
          <div className="image-block animate-scale-in">
            <img
              src={dataUri}
              alt="消息图片"
              className="max-w-full rounded-lg shadow-sm"
              loading="lazy"
            />
          </div>
        );
      }
      return (
        <div className="image-block text-xs text-muted-foreground italic">
          [图片内容无法显示：缺少数据源]
        </div>
      );

    /* ====== 未知类型的降级处理 ====== */
    default:
      return (
        <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
          [{(block as MessageContent).type}] 不支持的内容类型
        </pre>
      );
  }
});
