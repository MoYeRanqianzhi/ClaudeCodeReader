/**
 * @file toolFormatter.ts - 工具参数格式化工具
 * @description
 * 将各种 Claude Code 工具调用的 input 参数提取为紧凑的显示字符串。
 * 用于在 ToolUseRenderer 中以 `Tool(args)` 格式显示。
 *
 * 支持的工具：
 * - Read/Write/Edit：显示文件路径（支持相对路径简化）
 * - Bash：显示命令内容（截断过长命令）
 * - Glob/Grep：显示搜索模式和路径
 * - Task：显示任务描述
 * - LSP：显示操作类型和文件位置
 * - AskUserQuestion：显示问题内容
 * - WebSearch：显示搜索查询
 * - WebFetch：显示 URL
 * - NotebookEdit：显示笔记本路径
 * - TodoWrite：显示待办项数量
 * - 其他工具：尝试提取第一个字符串参数，无则显示 "..."
 */

import { toRelativePath } from './messageTransform';

/** Bash 命令显示的最大字符数 */
const BASH_COMMAND_MAX_LENGTH = 80;
/** Task 描述显示的最大字符数 */
const TASK_DESC_MAX_LENGTH = 60;
/** 通用文本参数显示的最大字符数 */
const GENERIC_TEXT_MAX_LENGTH = 80;

/**
 * 截断过长文本并添加省略号
 *
 * @param text - 原始文本
 * @param maxLength - 最大长度
 * @returns 截断后的文本（超出时末尾加 "..."）
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * 工具格式化结果
 */
export interface ToolFormatResult {
  /** 格式化后的参数字符串，显示在括号内 */
  args: string;
  /**
   * 关联的文件路径（如果工具操作了文件）。
   * 用于 ToolResultRenderer 的"打开文件位置"按钮。
   * null 表示该工具不涉及文件操作。
   */
  filePath: string | null;
}

/**
 * 格式化工具调用的参数为紧凑显示字符串
 *
 * 根据工具名称提取关键参数，生成类似函数签名的显示格式：
 * - Read → Read(src/main.rs)
 * - Bash → Bash(cd E: && git diff)
 * - Grep → Grep(pattern, path)
 *
 * @param toolName - 工具名称
 * @param input - 工具输入参数对象
 * @param projectPath - 当前项目路径，用于相对路径简化
 * @returns 格式化后的参数字符串和关联文件路径
 */
export function formatToolArgs(
  toolName: string,
  input: Record<string, unknown>,
  projectPath: string
): ToolFormatResult {
  switch (toolName) {
    // ====== 文件操作工具 ======
    case 'Read': {
      const filePath = (input.file_path as string) || '';
      return {
        args: toRelativePath(filePath, projectPath),
        filePath,
      };
    }
    case 'Write': {
      const filePath = (input.file_path as string) || '';
      return {
        args: toRelativePath(filePath, projectPath),
        filePath,
      };
    }
    case 'Edit': {
      const filePath = (input.file_path as string) || '';
      return {
        args: toRelativePath(filePath, projectPath),
        filePath,
      };
    }

    // ====== Shell 命令 ======
    case 'Bash': {
      const command = (input.command as string) || '';
      return {
        args: truncate(command, BASH_COMMAND_MAX_LENGTH),
        filePath: null,
      };
    }

    // ====== 搜索工具 ======
    case 'Glob': {
      const pattern = (input.pattern as string) || '';
      return {
        args: pattern,
        filePath: null,
      };
    }
    case 'Grep': {
      const pattern = (input.pattern as string) || '';
      const path = (input.path as string) || '';
      const displayPath = path ? toRelativePath(path, projectPath) : '';
      return {
        args: displayPath ? `${pattern}, ${displayPath}` : pattern,
        filePath: null,
      };
    }

    // ====== 任务代理 ======
    case 'Task': {
      const desc = (input.description as string) || (input.prompt as string) || '';
      return {
        args: truncate(desc, TASK_DESC_MAX_LENGTH),
        filePath: null,
      };
    }

    // ====== LSP 操作 ======
    case 'LSP': {
      const operation = (input.operation as string) || '';
      const lspFile = (input.filePath as string) || '';
      const line = input.line as number | undefined;
      const displayFile = toRelativePath(lspFile, projectPath);
      const location = line ? `${displayFile}:${line}` : displayFile;
      return {
        args: `${operation}, ${location}`,
        filePath: lspFile || null,
      };
    }

    // ====== 其他常见 Claude Code 工具 ======

    case 'AskUserQuestion': {
      const question = (input.question as string) || '';
      return {
        args: truncate(question, GENERIC_TEXT_MAX_LENGTH),
        filePath: null,
      };
    }

    case 'WebSearch': {
      const query = (input.query as string) || '';
      return {
        args: truncate(query, GENERIC_TEXT_MAX_LENGTH),
        filePath: null,
      };
    }

    case 'WebFetch': {
      const url = (input.url as string) || '';
      return {
        args: truncate(url, GENERIC_TEXT_MAX_LENGTH),
        filePath: null,
      };
    }

    case 'NotebookEdit': {
      const notebookPath = (input.notebook_path as string) || '';
      return {
        args: toRelativePath(notebookPath, projectPath),
        filePath: notebookPath || null,
      };
    }

    case 'TodoWrite': {
      const todos = input.todos;
      const count = Array.isArray(todos) ? todos.length : 0;
      return {
        args: `${count} 项`,
        filePath: null,
      };
    }

    // ====== 其他工具：通用降级（尝试提取第一个字符串参数） ======
    default: {
      // 尝试从 input 中找到第一个有意义的字符串值作为摘要
      const firstStringValue = Object.values(input).find(
        (v): v is string => typeof v === 'string' && v.length > 0
      );
      return {
        args: firstStringValue ? truncate(firstStringValue, GENERIC_TEXT_MAX_LENGTH) : '...',
        filePath: null,
      };
    }
  }
}
