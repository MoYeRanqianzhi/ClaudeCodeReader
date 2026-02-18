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
 */

import { motion } from 'motion/react';
import { Lightbulb } from 'lucide-react';
import type { MessageContent } from '../types/claude';
import type { ToolUseInfo } from '../utils/messageTransform';
import { ToolUseRenderer } from './ToolUseRenderer';
import { ToolResultRenderer } from './ToolResultRenderer';

/**
 * MessageContentRenderer 组件的属性接口
 */
interface MessageContentRendererProps {
  /** 要渲染的单个消息内容块 */
  block: MessageContent;
  /** 当前项目根目录路径，用于工具显示的路径简化 */
  projectPath: string;
  /** tool_use_id → ToolUseInfo 映射，用于 tool_result 关联查询 */
  toolUseMap: Map<string, ToolUseInfo>;
}

/**
 * MessageContentRenderer - 单个消息内容块的渲染组件
 *
 * 根据 block.type 分发到不同的渲染逻辑：
 * - text: 保留空白符的预格式化文本
 * - tool_use: 委托给 ToolUseRenderer（紧凑显示 + Raw 切换）
 * - tool_result: 委托给 ToolResultRenderer（折叠 + 打开文件位置）
 * - thinking: 默认折叠 + 斜体淡色
 * - image: 内联图片展示
 *
 * @param props - 包含待渲染的内容块对象
 * @returns 渲染后的 JSX 元素
 */
export function MessageContentRenderer({ block, projectPath, toolUseMap }: MessageContentRendererProps) {
  switch (block.type) {
    /* ====== 文本内容块 ====== */
    case 'text':
      return (
        <motion.pre
          className="whitespace-pre-wrap break-words text-sm font-sans"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {block.text || ''}
        </motion.pre>
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
        <motion.details
          className="thinking-block content-block"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
        >
          <summary className="cursor-pointer select-none text-sm">
            <Lightbulb className="w-4 h-4 inline-block shrink-0" /> 思考过程
          </summary>
          <motion.pre
            className="whitespace-pre-wrap break-words text-sm font-sans mt-2 italic opacity-70 custom-scrollbar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15, delay: 0.05 }}
          >
            {block.thinking || block.text || ''}
          </motion.pre>
        </motion.details>
      );

    /* ====== 图片内容块 ====== */
    case 'image':
      if (block.source?.data && block.source?.media_type) {
        const dataUri = `data:${block.source.media_type};base64,${block.source.data}`;
        return (
          <motion.div
            className="image-block"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
          >
            <img
              src={dataUri}
              alt="消息图片"
              className="max-w-full rounded-lg shadow-sm"
              loading="lazy"
            />
          </motion.div>
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
}
