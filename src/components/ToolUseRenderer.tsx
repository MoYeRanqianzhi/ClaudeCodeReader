/**
 * @file ToolUseRenderer.tsx - 工具调用块渲染器
 * @description
 * 将 tool_use 内容块渲染为紧凑的 `Tool(args)` 格式。
 * 替代原 MessageContentRenderer 中的 <details> 展开式显示。
 *
 * 功能：
 * - 默认显示为一行紧凑格式：**Tool**(**args**)
 * - 工具名称和括号加粗显示
 * - "Raw" 按钮切换查看原始 JSON 参数
 * - 路径参数自动简化为相对路径（如果在项目目录内）
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import { Wrench, Code } from 'lucide-react';
import type { MessageContent } from '../types/claude';
import { formatToolArgs } from '../utils/toolFormatter';

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
 * ToolUseRenderer - 工具调用块的紧凑渲染器
 *
 * 将复杂的工具调用 JSON 参数提炼为一行易读的格式：
 * 🔧 **Read**(src/main.rs)     [Raw]
 * 🔧 **Bash**(cd E: && git diff) [Raw]
 *
 * @param props - 组件属性
 * @returns JSX 元素
 */
export function ToolUseRenderer({ block, projectPath }: ToolUseRendererProps) {
  /** 控制原始 JSON 参数面板的展开/收起状态 */
  const [showRaw, setShowRaw] = useState(false);

  const toolName = block.name || '未知工具';
  const input = block.input || {};
  const { args } = formatToolArgs(toolName, input, projectPath);

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
