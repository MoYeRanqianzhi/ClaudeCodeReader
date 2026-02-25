/**
 * @file MessageContentRenderer.tsx - 消息内容块渲染器
 * @description
 * 负责根据 MessageContent 的 type 字段分类渲染不同类型的内容块。
 * 支持以下内容类型：
 * - text：纯文本 / Markdown 格式的文字内容
 * - tool_use：工具调用块 → 委托给 ToolUseRenderer（紧凑 Tool(args) 格式）
 * - tool_result：工具结果块 → 委托给 ToolResultRenderer（折叠 + 打开文件位置）
 * - thinking：AI 思考过程块（默认折叠，受 useCollapsible 控制）
 * - image：图片内容块（通过 Base64 data URI 渲染）
 *
 * 性能优化：
 * - 使用 React.memo 包裹，props 不变时跳过重渲染
 * - 移除 framer-motion（motion.div），使用纯 CSS 动画，零 JS 开销
 *
 * 搜索导航集成：
 * - searchAutoExpand 信号穿透到所有可折叠子组件（thinking / tool_use / tool_result）
 * - 搜索跳转时自动展开折叠内容，离开时自动收起（手动展开的不受影响）
 */

import { memo } from 'react';
import { Lightbulb, ChevronRight, ChevronDown } from 'lucide-react';
import type { MessageContent, ToolUseInfo, SearchHighlight } from '../types/claude';
import { ToolUseRenderer } from './ToolUseRenderer';
import { ToolResultRenderer } from './ToolResultRenderer';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useCollapsible } from '../hooks/useCollapsible';

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
  /**
   * 搜索高亮选项。
   * 非空时，穿透到 MarkdownRenderer 和 ToolResultRenderer 中高亮匹配文本。
   * 支持字面量（大小写敏感/不敏感）和正则表达式模式。
   */
  searchHighlight?: SearchHighlight;
  /**
   * 搜索导航自动展开信号。
   * true 时触发可折叠内容块（thinking / tool_use / tool_result）自动展开。
   * false/undefined 时不干预。
   */
  searchAutoExpand?: boolean;
}

/**
 * ThinkingBlock - 思考过程块的受控折叠组件
 *
 * 替代原来的 HTML <details> 标签，使用 useCollapsible 实现受控展开/收起，
 * 支持搜索导航自动展开。
 *
 * @param content - 思考过程的文本内容
 * @param searchHighlight - 搜索高亮选项
 * @param searchAutoExpand - 搜索导航自动展开信号
 */
function ThinkingBlock({ content, searchHighlight, searchAutoExpand }: {
  content: string;
  searchHighlight?: SearchHighlight;
  searchAutoExpand?: boolean;
}) {
  const { expanded, handleManualToggle } = useCollapsible(searchAutoExpand);

  return (
    <div className="thinking-block content-block animate-scale-in">
      <button
        onClick={handleManualToggle}
        className="cursor-pointer select-none text-sm flex items-center gap-1 w-full text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0" />
        )}
        <Lightbulb className="w-4 h-4 inline-block shrink-0" /> 思考过程
      </button>
      {expanded && (
        <div className="mt-2 italic opacity-70">
          <MarkdownRenderer content={content} searchHighlight={searchHighlight} />
        </div>
      )}
    </div>
  );
}

/**
 * MessageContentRenderer - 单个消息内容块的渲染组件（React.memo 优化）
 *
 * 根据 block.type 分发到不同的渲染逻辑：
 * - text: Markdown 渲染（通过 MarkdownRenderer）
 * - tool_use: 委托给 ToolUseRenderer（紧凑显示 + Raw 切换）
 * - tool_result: 委托给 ToolResultRenderer（折叠 + 打开文件位置）
 * - thinking: 受控折叠 + 斜体淡色（通过 ThinkingBlock + useCollapsible）
 * - image: 内联图片展示
 *
 * 所有入场动画使用 CSS @keyframes（animate-msg-in / animate-scale-in），
 * 不引入 framer-motion，由浏览器合成线程执行，不阻塞主线程。
 *
 * @param props - 包含待渲染的内容块对象
 * @returns 渲染后的 JSX 元素
 */
export const MessageContentRenderer = memo(function MessageContentRenderer({ block, projectPath, toolUseMap, searchHighlight, searchAutoExpand }: MessageContentRendererProps) {
  switch (block.type) {
    /* ====== 文本内容块（Markdown 渲染） ====== */
    case 'text':
      return (
        <div className="animate-msg-in">
          <MarkdownRenderer content={block.text || ''} searchHighlight={searchHighlight} />
        </div>
      );

    /* ====== 工具调用块 → 委托给 ToolUseRenderer ====== */
    case 'tool_use':
      return (
        <ToolUseRenderer
          block={block}
          projectPath={projectPath}
          searchAutoExpand={searchAutoExpand}
          searchHighlight={searchHighlight}
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
          searchHighlight={searchHighlight}
          searchAutoExpand={searchAutoExpand}
        />
      );

    /* ====== 思考过程块（受控折叠，支持搜索导航自动展开） ====== */
    case 'thinking':
      return (
        <ThinkingBlock
          content={block.thinking || block.text || ''}
          searchHighlight={searchHighlight}
          searchAutoExpand={searchAutoExpand}
        />
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
