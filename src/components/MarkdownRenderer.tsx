/**
 * @file MarkdownRenderer.tsx - Markdown 内容渲染组件
 * @description
 * 使用 react-markdown + remark-gfm 将 Markdown 文本渲染为 HTML。
 * 支持 GitHub Flavored Markdown（表格、删除线、任务列表等）。
 *
 * 自定义渲染：
 * - 代码块（```）：等宽字体 + 主题适配背景
 * - 行内代码（`）：紫色背景标签样式
 * - 链接（[text](url)）：禁用点击（桌面查看器，非浏览器）
 * - 其他元素：通过 CSS 类 `.markdown-body` 统一控制排版
 *
 * 性能优化：
 * - React.memo 包裹：content（string 原始值）相同时跳过整个 react-markdown 解析流程。
 *   react-markdown 内部会将 Markdown 文本经 remark → rehype → React 元素 的三阶段转换，
 *   每次重渲染都需完整执行，是编辑场景下最昂贵的操作。memo 可彻底避免。
 */

import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * MarkdownRenderer 组件的属性接口
 */
interface MarkdownRendererProps {
  /** 要渲染的 Markdown 文本 */
  content: string;
  /** 额外的 CSS 类名 */
  className?: string;
}

/** remark 插件列表（稳定引用，避免 ReactMarkdown 重渲染） */
const remarkPlugins = [remarkGfm];

/**
 * MarkdownRenderer - 将 Markdown 文本渲染为格式化 HTML（React.memo 优化）
 *
 * React.memo 对 content（string 原始值）使用 === 比较，
 * 相同文本直接跳过 remark → rehype → React 的完整解析管线。
 *
 * @param props - 包含 Markdown 文本和可选类名
 * @returns 渲染后的 JSX 元素
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  // 自定义组件映射（稳定引用）
  const components = useMemo(() => ({
    /**
     * 代码渲染：区分行内代码和代码块
     * - 行内代码：<code> 标签 + 紫色背景
     * - 代码块：<pre><code> 组合 + 主题适配背景
     */
    code({ className: codeClassName, children, ...rest }: React.ComponentProps<'code'> & { node?: unknown }) {
      // react-markdown 对代码块会包裹 <pre>，行内代码不会
      // 通过 className 中的 language-xxx 判断是否为代码块
      const isBlock = typeof codeClassName === 'string' && codeClassName.startsWith('language-');

      if (isBlock) {
        return (
          <code className={`${codeClassName || ''} block`} {...rest}>
            {children}
          </code>
        );
      }

      // 行内代码
      return (
        <code
          className="inline-code"
          {...rest}
        >
          {children}
        </code>
      );
    },

    /**
     * 代码块外层 <pre> 渲染
     */
    pre({ children, ...rest }: React.ComponentProps<'pre'>) {
      return (
        <pre className="code-block overflow-x-auto custom-scrollbar" {...rest}>
          {children}
        </pre>
      );
    },

    /**
     * 链接渲染：显示但禁用跳转（桌面查看器，不是浏览器）
     */
    a({ children, href, ...rest }: React.ComponentProps<'a'>) {
      return (
        <a
          href={href}
          title={href}
          onClick={(e) => e.preventDefault()}
          className="text-primary underline underline-offset-2 hover:text-primary/80 cursor-default"
          {...rest}
        >
          {children}
        </a>
      );
    },
  }), []);

  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
