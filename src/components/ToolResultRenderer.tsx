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

import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2, XCircle, ChevronDown, ChevronUp,
  FolderOpen
} from 'lucide-react';
import type { MessageContent, ToolUseInfo } from '../types/claude';
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
        {collapsedText}
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
                {extraText}
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
