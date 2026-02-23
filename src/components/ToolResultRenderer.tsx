/**
 * @file ToolResultRenderer.tsx - 工具结果块渲染器
 * @description
 * 渲染从 user 消息中拆分出来的 tool_result 内容块。
 *
 * 功能：
 * - 通过 tool_use_id 关联查询工具名称，显示如 "Read(src/main.rs) 结果"
 * - 超过 5 行时默认折叠，显示前 5 行 + "展开全部" 按钮
 * - 展开/收起带平滑高度动画
 * - 收起时自动滚动定位，避免用户丢失上下文
 * - Read/Write/Edit 工具结果带"打开文件位置"按钮
 * - 文件不存在时按钮禁用
 * - 错误结果用红色样式高亮
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2, XCircle, ChevronDown, ChevronUp,
  FolderOpen
} from 'lucide-react';
import type { MessageContent, ToolUseInfo, SearchHighlight } from '../types/claude';
import { formatToolArgs } from '../utils/toolFormatter';
import { checkFileExists, openInExplorer } from '../utils/claudeData';

/** 折叠阈值：超过此行数时默认折叠 */
const COLLAPSE_LINE_THRESHOLD = 5;

/** 展开/收起动画的过渡参数 */
const EXPAND_TRANSITION = { duration: 0.25, ease: 'easeInOut' as const };

/**
 * ToolResultRenderer 组件的属性接口
 */
interface ToolResultRendererProps {
  /** 要渲染的 tool_result 内容块 */
  block: MessageContent;
  /** tool_use_id → ToolUseInfo 的映射表（Rust HashMap 序列化为 Record） */
  toolUseMap: Record<string, ToolUseInfo>;
  /** 当前项目的根目录路径，用于路径简化 */
  projectPath: string;
  /** 是否为错误结果 */
  isError?: boolean;
  /**
   * 搜索高亮选项。
   * 非空时，工具结果的纯文本内容中匹配的片段将被
   * <mark class="search-highlight"> 包裹高亮。
   * 支持字面量（大小写敏感/不敏感）和正则表达式三种模式。
   */
  searchHighlight?: SearchHighlight;
}

/**
 * 提取 tool_result 的纯文本内容
 *
 * @param block - tool_result 内容块
 * @returns 纯文本字符串
 */
function extractResultText(block: MessageContent): string {
  const content = block.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text || '')
      .join('\n');
  }
  return '';
}

/**
 * HighlightedText - 纯文本搜索高亮组件
 *
 * 将文本中匹配搜索关键词的片段包裹在 <mark> 中高亮显示。
 * 支持 3 种搜索模式（由 SearchHighlight 字段控制）：
 * 1. 字面量 + 大小写不敏感：indexOf 在小写化文本上循环
 * 2. 字面量 + 大小写敏感：indexOf 在原始文本上精确匹配
 * 3. 正则表达式：RegExp exec 循环，无效正则时降级为原始文本显示
 *
 * @param text - 要渲染的原始文本
 * @param highlight - 搜索高亮选项（为空则直接返回原始文本）
 */
function HighlightedText({ text, highlight }: { text: string; highlight: SearchHighlight }) {
  const { query, caseSensitive, useRegex } = highlight;

  if (!query.trim()) return <>{text}</>;

  /** 所有匹配的 [start, end) 区间列表 */
  const matches: { start: number; end: number }[] = [];

  if (useRegex) {
    // 正则模式：compile RegExp，无效时降级显示原始文本
    try {
      const flags = 'g' + (caseSensitive ? '' : 'i');
      const re = new RegExp(query, flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; } // 防止零宽匹配死循环
        matches.push({ start: m.index, end: m.index + m[0].length });
      }
    } catch {
      // 无效正则表达式：直接返回原始文本，不高亮
      return <>{text}</>;
    }
  } else if (caseSensitive) {
    // 字面量 + 大小写敏感
    const queryLen = query.length;
    let pos = text.indexOf(query);
    while (pos !== -1) {
      matches.push({ start: pos, end: pos + queryLen });
      pos = text.indexOf(query, pos + queryLen);
    }
  } else {
    // 字面量 + 大小写不敏感（默认）
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const queryLen = lowerQuery.length;
    let pos = lowerText.indexOf(lowerQuery);
    while (pos !== -1) {
      matches.push({ start: pos, end: pos + queryLen });
      pos = lowerText.indexOf(lowerQuery, pos + queryLen);
    }
  }

  if (matches.length === 0) return <>{text}</>;

  // 拆分文本，将匹配片段包裹 <mark>
  const parts: (string | React.ReactElement)[] = [];
  let lastEnd = 0;
  let keyIdx = 0;

  for (const { start, end } of matches) {
    if (start > lastEnd) {
      parts.push(text.slice(lastEnd, start));
    }
    parts.push(
      <mark key={keyIdx++} className="search-highlight">
        {text.slice(start, end)}
      </mark>
    );
    lastEnd = end;
  }

  if (lastEnd < text.length) {
    parts.push(text.slice(lastEnd));
  }

  return <>{parts}</>;
}

/**
 * ToolResultRenderer - 工具结果的智能渲染器
 *
 * @param props - 组件属性
 * @returns JSX 元素
 */
export function ToolResultRenderer({
  block,
  toolUseMap,
  projectPath,
  isError,
  searchHighlight,
}: ToolResultRendererProps) {
  /** 内容是否处于展开状态 */
  const [expanded, setExpanded] = useState(false);
  /** 关联文件是否存在（用于控制"打开文件位置"按钮） */
  const [fileExists, setFileExists] = useState<boolean | null>(null);
  /** 组件根元素引用，用于收起时滚动定位 */
  const containerRef = useRef<HTMLDivElement>(null);

  // 查询关联的 tool_use 块信息
  const toolUseId = block.tool_use_id || '';
  const toolInfo = toolUseMap[toolUseId];
  const toolName = toolInfo?.name || '';
  const toolInput = toolInfo?.input || {};

  // 格式化工具参数
  const { args, filePath } = useMemo(
    () => formatToolArgs(toolName, toolInput, projectPath),
    [toolName, toolInput, projectPath]
  );

  // 提取结果文本并计算行数
  const resultText = useMemo(() => extractResultText(block), [block]);
  const lines = useMemo(() => resultText.split('\n'), [resultText]);
  const totalLines = lines.length;
  const shouldCollapse = totalLines > COLLAPSE_LINE_THRESHOLD;

  // 始终显示的折叠文本（前 N 行）
  const collapsedText = useMemo(() => {
    if (!shouldCollapse) return resultText;
    return lines.slice(0, COLLAPSE_LINE_THRESHOLD).join('\n');
  }, [shouldCollapse, resultText, lines]);

  // 展开时额外显示的文本（超出阈值的部分）
  const extraText = useMemo(() => {
    if (!shouldCollapse) return '';
    return lines.slice(COLLAPSE_LINE_THRESHOLD).join('\n');
  }, [shouldCollapse, lines]);

  // 检查关联文件是否存在
  useEffect(() => {
    if (!filePath) {
      setFileExists(null);
      return;
    }
    checkFileExists(filePath).then(setFileExists);
  }, [filePath]);

  /** 处理"打开文件位置"按钮点击 */
  const handleOpenInExplorer = async () => {
    if (!filePath) return;
    try {
      await openInExplorer(filePath);
    } catch (err) {
      console.error('打开文件管理器失败:', err);
    }
  };

  /** 收起后动画完成时，滚动确保组件可见 */
  const handleCollapseComplete = () => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // 根据是否为错误状态选择样式
  const containerClass = isError
    ? 'tool-result-block tool-result-error'
    : 'tool-result-block';

  return (
    <motion.div
      ref={containerRef}
      className={containerClass}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* 头部：工具名称 + 状态 + 打开文件位置按钮 */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1 text-xs font-medium opacity-70">
          {isError ? (
            <XCircle className="w-3.5 h-3.5 shrink-0 text-red-500" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-500" />
          )}
          {toolName ? (
            <span>
              <span className="font-bold">{toolName}</span>
              <span className="font-bold">(</span>
              <span>{args}</span>
              <span className="font-bold">)</span>
              <span className="ml-1">{isError ? '失败' : '结果'}</span>
            </span>
          ) : (
            <span>{isError ? '工具执行失败' : '工具结果'}</span>
          )}
        </div>

        {/* 打开文件位置按钮（仅文件操作工具显示） */}
        {filePath && (
          <button
            onClick={handleOpenInExplorer}
            disabled={fileExists === false}
            className={`p-1 rounded text-xs transition-colors flex items-center gap-1 ${
              fileExists === false
                ? 'text-muted-foreground/50 cursor-not-allowed'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
            title={fileExists === false ? '文件不存在' : '在文件管理器中打开'}
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 结果内容：折叠部分始终可见 */}
      <pre className="whitespace-pre-wrap break-words text-xs custom-scrollbar">
        {searchHighlight ? <HighlightedText text={collapsedText} highlight={searchHighlight} /> : collapsedText}
      </pre>

      {/* 额外内容：展开时以动画滑入，收起时以动画滑出 */}
      {shouldCollapse && (
        <AnimatePresence initial={false} onExitComplete={handleCollapseComplete}>
          {expanded && (
            <motion.div
              key="extra-content"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={EXPAND_TRANSITION}
              style={{ overflow: 'hidden' }}
            >
              <pre className="whitespace-pre-wrap break-words text-xs custom-scrollbar">
                {searchHighlight ? <HighlightedText text={extraText} highlight={searchHighlight} /> : extraText}
              </pre>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* 折叠/展开按钮 */}
      {shouldCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              收起
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              展开全部 ({totalLines} 行)
            </>
          )}
        </button>
      )}
    </motion.div>
  );
}
