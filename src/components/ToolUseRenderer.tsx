/**
 * @file ToolUseRenderer.tsx - 工具调用块渲染器
 * @description
 * 将 tool_use 内容块渲染为紧凑的 `Tool(args)` 格式。
 *
 * 功能：
 * - 默认显示为一行紧凑格式：**Tool**(**args**)
 * - Write 工具：展示写入内容（绿色，表示新增）
 * - Edit 工具：展示替换内容（红色=删除，绿色=新增）
 * - 超过 5 行自动折叠，可展开查看全部（带平滑动画）
 * - "Raw" 按钮切换查看原始 JSON 参数（展开/收起都有动画）
 * - 收起时自动滚动定位，避免用户丢失上下文
 * - 路径参数自动简化为相对路径（如果在项目目录内）
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Wrench, Code, ChevronDown, ChevronUp } from 'lucide-react';
import type { MessageContent, SearchHighlight } from '../types/claude';
import { formatToolArgs } from '../utils/toolFormatter';
import { useCollapsible } from '../hooks/useCollapsible';
import { HighlightedText } from './HighlightedText';

/** 折叠阈值：diff 内容超过此行数时默认折叠 */
const COLLAPSE_LINE_THRESHOLD = 5;

/** 展开/收起动画的过渡参数 */
const EXPAND_TRANSITION = { duration: 0.25, ease: 'easeInOut' as const };

/**
 * ToolUseRenderer 组件的属性接口
 */
interface ToolUseRendererProps {
  /** 要渲染的 tool_use 内容块 */
  block: MessageContent;
  /** 当前项目的根目录路径，用于路径简化 */
  projectPath: string;
  /**
   * 搜索导航自动展开信号。
   * true 时自动展开 diff 折叠内容，false/undefined 时不干预。
   */
  searchAutoExpand?: boolean;
  /**
   * 搜索高亮选项。
   * 非空时，工具名称、参数和 diff 内容中匹配的片段将被高亮。
   */
  searchHighlight?: SearchHighlight;
}

/**
 * Diff 区段数据：描述一次 Write/Edit 操作的增删内容
 */
interface DiffData {
  /** 被删除的行（Edit 的 old_string，Write 没有删除行） */
  removed: string[];
  /** 被新增的行（Write 的 content 或 Edit 的 new_string） */
  added: string[];
  /** 总行数（removed + added），用于判断是否需要折叠 */
  totalLines: number;
}

/**
 * 从 Write/Edit 工具的 input 中提取 diff 数据
 *
 * @param toolName - 工具名称
 * @param input - 工具输入参数
 * @returns DiffData 或 null（非 Write/Edit 工具或无内容时）
 */
function extractDiffData(
  toolName: string,
  input: Record<string, unknown>
): DiffData | null {
  if (toolName === 'Write') {
    const content = (input.content as string) || '';
    if (!content) return null;
    const lines = content.split('\n');
    return { removed: [], added: lines, totalLines: lines.length };
  }

  if (toolName === 'Edit') {
    const oldStr = (input.old_string as string) || '';
    const newStr = (input.new_string as string) || '';
    if (!oldStr && !newStr) return null;
    const removed = oldStr ? oldStr.split('\n') : [];
    const added = newStr ? newStr.split('\n') : [];
    return { removed, added, totalLines: removed.length + added.length };
  }

  return null;
}

/**
 * 截断 diff 数据到指定行数限制
 *
 * 按「先删除后新增」的顺序分配行数配额：
 * 优先显示删除行，剩余配额分配给新增行。
 *
 * @param diff - 完整 diff 数据
 * @param limit - 最大显示行数
 * @returns 截断后的 { removed, added }
 */
function truncateDiff(
  diff: DiffData,
  limit: number
): { removed: string[]; added: string[] } {
  let remaining = limit;
  const removed = diff.removed.slice(0, remaining);
  remaining -= removed.length;
  const added = diff.added.slice(0, Math.max(0, remaining));
  return { removed, added };
}

/**
 * 渲染 diff 行列表（红色删除行 + 绿色新增行），支持搜索高亮
 */
function DiffLines({ removed, added, searchHighlight }: { removed: string[]; added: string[]; searchHighlight?: SearchHighlight }) {
  return (
    <>
      {removed.map((line, i) => (
        <div
          key={`r-${i}`}
          className="px-2 py-px bg-red-500/10 text-red-700 dark:text-red-400 whitespace-pre-wrap break-all"
        >
          <span className="select-none opacity-50 mr-1">-</span>
          {searchHighlight ? <HighlightedText text={line} highlight={searchHighlight} /> : line}
        </div>
      ))}
      {added.map((line, i) => (
        <div
          key={`a-${i}`}
          className="px-2 py-px bg-green-500/10 text-green-700 dark:text-green-400 whitespace-pre-wrap break-all"
        >
          <span className="select-none opacity-50 mr-1">+</span>
          {searchHighlight ? <HighlightedText text={line} highlight={searchHighlight} /> : line}
        </div>
      ))}
    </>
  );
}

/**
 * ToolUseRenderer - 工具调用块的紧凑渲染器
 *
 * 将复杂的工具调用 JSON 参数提炼为一行易读的格式：
 * 🔧 **Read**(src/main.rs)     [Raw]
 * 🔧 **Bash**(cd E: && git diff) [Raw]
 *
 * Write/Edit 工具额外展示 diff 风格的内容预览：
 * - 绿色（+）= 写入/新增内容
 * - 红色（-）= 删除/被替换内容
 *
 * @param props - 组件属性
 * @returns JSX 元素
 */
export function ToolUseRenderer({ block, projectPath, searchAutoExpand, searchHighlight }: ToolUseRendererProps) {
  /** 控制原始 JSON 参数面板的展开/收起状态 */
  const [showRaw, setShowRaw] = useState(false);
  /**
   * 控制 diff 内容的展开/收起状态。
   * 使用 useCollapsible 统一管理：搜索导航时自动展开，离开时自动收起。
   * 仅在有可折叠 diff 内容时 searchAutoExpand 才有实际效果。
   */
  const { expanded, handleManualToggle: toggleExpanded } = useCollapsible(searchAutoExpand);
  /** 组件根元素引用，用于收起时滚动定位 */
  const containerRef = useRef<HTMLDivElement>(null);
  /** 标记 Raw 面板是否由搜索导航自动展开（用于区分自动/手动展开） */
  const wasRawAutoExpandedRef = useRef(false);

  const toolName = block.name || '未知工具';
  const input = (block.input || {}) as Record<string, unknown>;
  const { args } = formatToolArgs(toolName, input, projectPath);

  // 提取 Write/Edit 的 diff 数据
  const diffData = useMemo(
    () => extractDiffData(toolName, input),
    [toolName, input]
  );

  /**
   * 搜索导航自动展开 Raw 面板（仅对无 diff 内容的工具生效）。
   *
   * 对于 AskUserQuestion、WebSearch 等非 Write/Edit 工具，
   * 紧凑格式只显示 "Tool(...)"，实际内容藏在 Raw JSON 面板中。
   * 搜索导航跳转到这些工具时，自动展开 Raw 面板使匹配内容可见。
   * 导航离开时自动收起（手动展开的不受影响）。
   */
  useEffect(() => {
    if (searchAutoExpand && !diffData) {
      setShowRaw(true);
      wasRawAutoExpandedRef.current = true;
    } else if (!searchAutoExpand && wasRawAutoExpandedRef.current) {
      setShowRaw(false);
      wasRawAutoExpandedRef.current = false;
    }
  }, [searchAutoExpand, diffData]);

  const shouldCollapse = diffData !== null && diffData.totalLines > COLLAPSE_LINE_THRESHOLD;

  // 折叠状态下始终显示的行（前 N 行）
  const collapsedDiff = useMemo(() => {
    if (!diffData) return null;
    if (!shouldCollapse) return { removed: diffData.removed, added: diffData.added };
    return truncateDiff(diffData, COLLAPSE_LINE_THRESHOLD);
  }, [diffData, shouldCollapse]);

  // 展开时额外显示的行（超出阈值的部分）
  const extraDiff = useMemo(() => {
    if (!diffData || !shouldCollapse) return null;
    const collapsed = truncateDiff(diffData, COLLAPSE_LINE_THRESHOLD);
    return {
      removed: diffData.removed.slice(collapsed.removed.length),
      added: diffData.added.slice(collapsed.added.length),
    };
  }, [diffData, shouldCollapse]);

  /** 收起后动画完成时，滚动确保组件可见 */
  const handleCollapseComplete = () => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  return (
    <motion.div
      ref={containerRef}
      className="tool-use-block"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* 紧凑显示行：图标 + Tool(args) + Raw 按钮 */}
      <div className="flex items-center gap-1.5 text-sm">
        <Wrench className="w-4 h-4 shrink-0 text-blue-500" />
        <span>
          <span className="font-bold">{searchHighlight ? <HighlightedText text={toolName} highlight={searchHighlight} /> : toolName}</span>
          <span className="font-bold">(</span>
          <span className="text-muted-foreground">{searchHighlight ? <HighlightedText text={args} highlight={searchHighlight} /> : args}</span>
          <span className="font-bold">)</span>
        </span>
        {/* 工具调用 ID 简短显示 */}
        {block.id && (
          <span className="text-xs text-muted-foreground ml-1">
            ({block.id.substring(0, 8)})
          </span>
        )}
        {/* Raw 切换按钮 */}
        <button
          onClick={() => setShowRaw(!showRaw)}
          className={`ml-auto px-1.5 py-0.5 text-xs rounded transition-colors flex items-center gap-1 ${
            showRaw
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
          title={showRaw ? '收起原始参数' : '查看原始参数'}
        >
          <Code className="w-3 h-3" />
          Raw
        </button>
      </div>

      {/* Write/Edit 工具的 diff 内容展示 */}
      {collapsedDiff && (
        <div className="mt-2 rounded-md border border-border/50 overflow-hidden text-xs font-mono">
          {/* 始终可见的折叠行 */}
          <DiffLines removed={collapsedDiff.removed} added={collapsedDiff.added} searchHighlight={searchHighlight} />

          {/* 额外行：展开时以动画滑入，收起时以动画滑出 */}
          <AnimatePresence initial={false} onExitComplete={handleCollapseComplete}>
            {expanded && extraDiff && (
              <motion.div
                key="extra-diff"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={EXPAND_TRANSITION}
                style={{ overflow: 'hidden' }}
              >
                <DiffLines removed={extraDiff.removed} added={extraDiff.added} searchHighlight={searchHighlight} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* 折叠/展开按钮 */}
          {shouldCollapse && (
            <button
              onClick={toggleExpanded}
              className="w-full px-2 py-1 text-xs text-primary hover:bg-accent/50 transition-colors flex items-center justify-center gap-1 border-t border-border/50"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  收起
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  展开全部 ({diffData!.totalLines} 行)
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* 原始 JSON 参数面板（展开/收起都有动画，支持搜索高亮） */}
      <AnimatePresence initial={false}>
        {showRaw && (
          <motion.div
            key="raw-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={EXPAND_TRANSITION}
            style={{ overflow: 'hidden' }}
          >
            <pre className="code-block mt-2 text-xs overflow-x-auto custom-scrollbar">
              {searchHighlight
                ? <HighlightedText text={JSON.stringify(input, null, 2)} highlight={searchHighlight} />
                : JSON.stringify(input, null, 2)
              }
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
