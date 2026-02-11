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
 */

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
 * - text: 保留空白符的预格式化文本
 * - tool_use: 蓝色左边框 + 可折叠的 JSON 参数面板
 * - tool_result: 绿色左边框（错误时为红色）+ 支持嵌套内容递归
 * - thinking: 虚线左边框 + 默认折叠 + 斜体淡色文字
 * - image: 带圆角的内联图片展示
 *
 * @param props - 包含待渲染的内容块对象
 * @returns 渲染后的 JSX 元素
 */
export function MessageContentRenderer({ block }: MessageContentRendererProps) {
  switch (block.type) {
    /* ====== 文本内容块 ====== */
    case 'text':
      return (
        <pre className="whitespace-pre-wrap break-words text-sm font-sans">
          {block.text || ''}
        </pre>
      );

    /* ====== 工具调用块 ====== */
    case 'tool_use':
      return (
        <details className="tool-use-block content-block">
          <summary className="cursor-pointer select-none">
            {/* 工具图标 + 名称 */}
            <span className="tool-use-icon">&#128295;</span>
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
            <pre className="code-block mt-2 text-xs overflow-x-auto">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          )}
        </details>
      );

    /* ====== 工具结果块 ====== */
    case 'tool_result': {
      /* 根据 is_error 字段动态选择样式类 */
      const resultClass = block.is_error ? 'tool-result-block tool-result-error' : 'tool-result-block';
      return (
        <div className={resultClass}>
          {/* 结果头部标签 */}
          <div className="text-xs font-medium mb-1 opacity-70">
            {block.is_error ? '&#10060; 工具执行失败' : '&#9989; 工具结果'}
            {/* 显示关联的工具调用 ID */}
            {block.tool_use_id && (
              <span className="text-xs text-muted-foreground ml-2">
                (关联: {block.tool_use_id.substring(0, 8)})
              </span>
            )}
          </div>
          {/* 渲染工具结果内容：支持字符串和嵌套 MessageContent[] 两种格式 */}
          {typeof block.content === 'string' ? (
            <pre className="whitespace-pre-wrap break-words text-xs">
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
        </div>
      );
    }

    /* ====== 思考过程块 ====== */
    case 'thinking':
      return (
        <details className="thinking-block content-block">
          <summary className="cursor-pointer select-none text-sm">
            &#128161; 思考过程
          </summary>
          <pre className="whitespace-pre-wrap break-words text-sm font-sans mt-2 italic opacity-70">
            {block.thinking || block.text || ''}
          </pre>
        </details>
      );

    /* ====== 图片内容块 ====== */
    case 'image':
      if (block.source?.data && block.source?.media_type) {
        /* 通过 Base64 数据构造 data URI */
        const dataUri = `data:${block.source.media_type};base64,${block.source.data}`;
        return (
          <div className="image-block">
            <img
              src={dataUri}
              alt="消息图片"
              className="max-w-full rounded-lg"
              loading="lazy"
            />
          </div>
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
