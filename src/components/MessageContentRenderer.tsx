/**
 * @file MessageContentRenderer.tsx - 消息内容块渲染器
 * @description
 * 负责根据 MessageContent 的 type 字段分类渲染不同类型的内容块。
 * 支持以下内容类型：
 * - text：纯文本 / Markdown 格式的文字内容
 * - tool_use：工具调用块（显示工具名称和可折叠的参数详情）
 * - tool_result：工具结果块（显示执行结果，支持嵌套内容的递归渲染）
 * - thinking：AI 思考过程块（默认折叠，斜体淡色显示）
 * - image：图片内容块（通过 Base64 data URI 渲染）
 *
 * 设计原则：
 * - 每种内容类型使用独立的视觉样式（颜色、边框、图标）便于区分
 * - 工具调用和思考过程默认折叠，减少视觉噪音
 * - 工具结果支持递归渲染嵌套的 MessageContent 数组
 * - 使用 motion/react 为各内容块添加进入动画，提升视觉流畅度
 * - 使用 lucide-react 图标替代内联 emoji，保证跨平台一致性
 */

import { motion } from 'motion/react';
import { Wrench, CheckCircle2, XCircle, Lightbulb } from 'lucide-react';
import type { MessageContent } from '../types/claude';

/**
 * MessageContentRenderer 组件的属性接口
 */
interface MessageContentRendererProps {
  /** 要渲染的单个消息内容块 */
  block: MessageContent;
}

/**
 * MessageContentRenderer - 单个消息内容块的渲染组件
 *
 * 根据 block.type 分发到不同的渲染逻辑，每种类型都有独特的视觉样式：
 * - text: 保留空白符的预格式化文本，带淡入上移动画
 * - tool_use: 蓝色左边框 + 可折叠的 JSON 参数面板，带缩放淡入动画
 * - tool_result: 绿色左边框（错误时为红色）+ 支持嵌套内容递归，带左滑淡入动画
 * - thinking: 虚线左边框 + 默认折叠 + 斜体淡色文字，带缩放动画
 * - image: 带圆角和阴影的内联图片展示，带缩放淡入动画
 *
 * @param props - 包含待渲染的内容块对象
 * @returns 渲染后的 JSX 元素
 */
export function MessageContentRenderer({ block }: MessageContentRendererProps) {
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

    /* ====== 工具调用块 ====== */
    case 'tool_use':
      return (
        <motion.details
          className="tool-use-block content-block"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
        >
          <summary className="cursor-pointer select-none">
            {/* 工具图标 + 名称 */}
            <Wrench className="w-4 h-4 inline-block shrink-0" />
            <span className="font-medium">{block.name || '未知工具'}</span>
            {/* 工具调用 ID 简短显示 */}
            {block.id && (
              <span className="text-xs text-muted-foreground ml-2">
                ({block.id.substring(0, 8)})
              </span>
            )}
          </summary>
          {/* 工具输入参数的 JSON 展示 */}
          {block.input && (
            <motion.pre
              className="code-block mt-2 text-xs overflow-x-auto custom-scrollbar"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, delay: 0.05 }}
            >
              {JSON.stringify(block.input, null, 2)}
            </motion.pre>
          )}
        </motion.details>
      );

    /* ====== 工具结果块 ====== */
    case 'tool_result': {
      /* 根据 is_error 字段动态选择样式类 */
      const resultClass = block.is_error ? 'tool-result-block tool-result-error' : 'tool-result-block';
      return (
        <motion.div
          className={resultClass}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* 结果头部标签 —— 使用 flex 布局对齐图标和文字 */}
          <div className="flex items-center gap-1 text-xs font-medium mb-1 opacity-70">
            {block.is_error ? (
              /* 错误状态：红色叉号图标 */
              <><XCircle className="w-3.5 h-3.5 shrink-0" /> 工具执行失败</>
            ) : (
              /* 成功状态：绿色勾号图标 */
              <><CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> 工具结果</>
            )}
            {/* 显示关联的工具调用 ID */}
            {block.tool_use_id && (
              <span className="text-xs text-muted-foreground ml-2">
                (关联: {block.tool_use_id.substring(0, 8)})
              </span>
            )}
          </div>
          {/* 渲染工具结果内容：支持字符串和嵌套 MessageContent[] 两种格式 */}
          {typeof block.content === 'string' ? (
            <pre className="whitespace-pre-wrap break-words text-xs custom-scrollbar">
              {block.content}
            </pre>
          ) : Array.isArray(block.content) ? (
            /* 递归渲染嵌套的内容块数组 */
            <div className="space-y-2">
              {block.content.map((nestedBlock, index) => (
                <MessageContentRenderer key={index} block={nestedBlock} />
              ))}
            </div>
          ) : null}
        </motion.div>
      );
    }

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
            {/* 灯泡图标 —— 表示 AI 思考过程 */}
            <Lightbulb className="w-4 h-4 inline-block shrink-0" /> 思考过程
          </summary>
          {/* 思考内容：斜体淡色，保留空白符 */}
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
        /* 通过 Base64 数据构造 data URI */
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
      /* 图片数据缺失时的降级显示 */
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
