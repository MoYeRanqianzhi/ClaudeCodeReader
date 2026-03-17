/**
 * @file retrospect.ts - 项目回溯功能类型定义
 * @description
 * 定义「项目回溯」功能所需的所有 TypeScript 类型。
 * 项目回溯允许用户在时间轴上浏览 Claude Code 对项目文件的所有操作历史，
 * 并可查看任意时间点的文件树和文件内容快照。
 *
 * 核心概念：
 * - OpType：文件操作类型（写入、编辑、移动、复制、删除、创建目录）
 * - FileOpSummary：单次文件操作的摘要信息（时间轴上的一个刻度点）
 * - RetrospectTimeline：完整的回溯时间轴，包含所有操作列表
 * - FileTreeNode：文件树节点，用于展示某个时间点的文件目录结构
 */

// ============ 操作类型 ============

/**
 * 文件操作类型枚举
 *
 * 对应 Claude Code 在会话中执行的各种文件系统操作：
 * - write：创建/覆写文件（Write 工具）
 * - edit：编辑已有文件（Edit 工具）
 * - bash_move：通过 Bash 移动文件
 * - bash_copy：通过 Bash 复制文件
 * - bash_delete：通过 Bash 删除文件
 * - bash_mkdir：通过 Bash 创建目录
 */
export type OpType = 'write' | 'edit' | 'bash_move' | 'bash_copy' | 'bash_delete' | 'bash_mkdir';

// ============ 时间轴相关 ============

/**
 * 文件操作摘要（时间轴刻度点）
 *
 * 每条记录代表时间轴上的一次文件操作，包含操作的序号、时间、类型和目标文件路径。
 * 这些摘要数据在初始化回溯时由后端一次性返回，用于渲染时间轴 slider 和信息展示。
 */
export interface FileOpSummary {
  /** 操作序号（从 0 开始），对应时间轴 slider 的值 */
  index: number;
  /** 操作时间戳（ISO 8601 格式字符串） */
  timestamp: string;
  /** 操作类型（写入/编辑/移动/复制/删除/创建目录） */
  opType: OpType;
  /** 操作的目标文件路径（相对于项目根目录） */
  filePath: string;
  /** 操作所在的会话文件名（用于定位来源会话） */
  sessionFile: string;
}

/**
 * 回溯时间轴
 *
 * 包含项目中所有文件操作的完整时间轴数据。
 * 由 `retrospect_init` 后端命令返回，是回溯功能的核心数据结构。
 */
export interface RetrospectTimeline {
  /** 总操作数量（等于 operations 数组的长度） */
  totalOperations: number;
  /** 按时间顺序排列的所有文件操作摘要列表 */
  operations: FileOpSummary[];
}

// ============ 文件树相关 ============

/**
 * 文件树节点
 *
 * 表示文件树中的一个节点（文件或目录）。
 * 目录节点包含 children 数组，文件节点的 children 为 undefined。
 * 由 `retrospect_file_tree` 后端命令返回，用于渲染文件树和资源管理器视图。
 */
export interface FileTreeNode {
  /** 节点名称（文件名或目录名，不含路径） */
  name: string;
  /** 节点的完整路径（相对于项目根目录） */
  path: string;
  /** 节点类型：'file'（文件）或 'directory'（目录） */
  type: 'file' | 'directory';
  /** 子节点列表（仅目录有此字段，文件节点为 undefined） */
  children?: FileTreeNode[];
}
