/**
 * @file ToolUseRenderer.tsx - 工具调用块渲染器
 * @description
 * 将 tool_use 内容块渲染为紧凑的 `Tool(args)` 格式。
 *
 * 功能：
 * - 默认显示为一行紧凑格式：**Tool**(**args**)
 * - Write 工具：展示写入内容（绿色，表示新增）
 * - Edit 工具：展示替换内容（红色=删除，绿色=新增）
 * - 超过 5 行自动折叠，可展开查看全部
 * - "Raw" 按钮切换查看原始 JSON 参数
 * - 路径参数自动简化为相对路径（如果在项目目录内）
 */

import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Wrench, Code, ChevronDown, ChevronUp } from 'lucide-react';
import type { MessageContent } from '../types/claude';
import { formatToolArgs } from '../utils/toolFormatter';

/** 折叠阈值：diff 内容超过此行数时默认折叠 */
const COLLAPSE_LINE_THRESHOLD = 5;

/**
 * ToolUseRenderer 组件的属性接口
 */
interface ToolUseRendererProps {
  /** 要渲染的 tool_use 内容块 */
  block: MessageContent;
  /** 当前项目的根目录路径，用于路径简化 */
  projectPath: string;
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
export function ToolUseRenderer({ block, projectPath }: ToolUseRendererProps) {
  /** 控制原始 JSON 参数面板的展开/收起状态 */
  const [showRaw, setShowRaw] = useState(false);
  /** 控制 diff 内容的展开/收起状态 */
  const [expanded, setExpanded] = useState(false);

  const toolName = block.name || '未知工具';
  const input = (block.input || {}) as Record<string, unknown>;
  const { args } = formatToolArgs(toolName, input, projectPath);

  // 提取 Write/Edit 的 diff 数据
  const diffData = useMemo(
    () => extractDiffData(toolName, input),
    [toolName, input]
  );

  const shouldCollapse = diffData !== null && diffData.totalLines > COLLAPSE_LINE_THRESHOLD;

  // 计算实际显示的 diff 行（折叠时截断）
  const displayDiff = useMemo(() => {
    if (!diffData) return null;
    if (!shouldCollapse || expanded) {
      return { removed: diffData.removed, added: diffData.added };
    }
    return truncateDiff(diffData, COLLAPSE_LINE_THRESHOLD);
  }, [diffData, shouldCollapse, expanded]);

  return (
    <motion.div
      className="tool-use-block"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* 紧凑显示行：图标 + Tool(args) + Raw 按钮 */}
      <div className="flex items-center gap-1.5 text-sm">
        <Wrench className="w-4 h-4 shrink-0 text-blue-500" />
        <span>
          <span className="font-bold">{toolName}</span>
          <span className="font-bold">(</span>
          <span className="text-muted-foreground">{args}</span>
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
      {displayDiff && (
        <div className="mt-2 rounded-md border border-border/50 overflow-hidden text-xs font-mono">
          {/* 删除行（红色） */}
          {displayDiff.removed.map((line, i) => (
            <div
              key={`r-${i}`}
              className="px-2 py-px bg-red-500/10 text-red-700 dark:text-red-400 whitespace-pre-wrap break-all"
            >
              <span className="select-none opacity-50 mr-1">-</span>
              {line}
            </div>
          ))}
          {/* 新增行（绿色） */}
          {displayDiff.added.map((line, i) => (
            <div
              key={`a-${i}`}
              className="px-2 py-px bg-green-500/10 text-green-700 dark:text-green-400 whitespace-pre-wrap break-all"
            >
              <span className="select-none opacity-50 mr-1">+</span>
              {line}
            </div>
          ))}
          {/* 折叠/展开按钮 */}
          {shouldCollapse && (
            <button
              onClick={() => setExpanded(!expanded)}
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

      {/* 原始 JSON 参数面板（可折叠） */}
      {showRaw && (
        <motion.pre
          className="code-block mt-2 text-xs overflow-x-auto custom-scrollbar"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.15 }}
        >
          {JSON.stringify(input, null, 2)}
        </motion.pre>
      )}
    </motion.div>
  );
}
