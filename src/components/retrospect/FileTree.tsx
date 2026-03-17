/**
 * @file FileTree.tsx - 文件树组件
 * @description
 * 以树形缩进结构展示某个时间点的项目文件目录。
 * 支持目录折叠/展开、文件选中高亮、带图标的文件类型区分。
 *
 * 渲染结构：
 * - 目录节点：带展开/折叠箭头和文件夹图标，点击切换展开状态
 * - 文件节点：带文件图标，点击触发文件选中回调
 * - 选中的文件显示高亮背景
 * - 通过递归渲染实现任意深度的树结构
 *
 * 动画：
 * - 使用 motion/react 的 AnimatePresence 实现目录展开/折叠的平滑过渡
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, ChevronDown, Folder, FileText } from 'lucide-react';
import type { FileTreeNode } from '../../types/retrospect';

/**
 * FileTree 组件的属性接口
 */
interface FileTreeProps {
  /** 文件树节点数组（顶层节点列表） */
  nodes: FileTreeNode[];
  /** 当前选中的文件路径，为 null 表示未选中任何文件 */
  selectedPath: string | null;
  /** 文件选中回调，传入选中文件的路径 */
  onSelectFile: (path: string) => void;
}

/**
 * 单个树节点的属性接口（内部递归组件使用）
 */
interface TreeNodeProps {
  /** 当前节点数据 */
  node: FileTreeNode;
  /** 缩进层级（0 = 顶层） */
  depth: number;
  /** 当前选中的文件路径 */
  selectedPath: string | null;
  /** 文件选中回调 */
  onSelectFile: (path: string) => void;
}

/**
 * TreeNode - 单个文件树节点的递归渲染组件
 *
 * 根据节点类型（file/directory）渲染不同的 UI：
 * - 目录：展开/折叠箭头 + 文件夹图标 + 目录名，点击切换展开状态
 * - 文件：文件图标 + 文件名，点击选中文件
 */
const TreeNode: React.FC<TreeNodeProps> = ({ node, depth, selectedPath, onSelectFile }) => {
  /** 目录是否处于展开状态（默认展开前两层，深层折叠） */
  const [isExpanded, setIsExpanded] = useState(depth < 2);

  /** 判断当前节点是否为目录 */
  const isDir = node.type === 'directory';
  /** 判断当前文件是否被选中 */
  const isSelected = !isDir && selectedPath === node.path;

  /**
   * 处理节点点击事件
   * - 目录：切换展开/折叠状态
   * - 文件：触发文件选中回调
   */
  const handleClick = useCallback(() => {
    if (isDir) {
      setIsExpanded(prev => !prev);
    } else {
      onSelectFile(node.path);
    }
  }, [isDir, node.path, onSelectFile]);

  return (
    <div>
      {/* 节点行：包含缩进、图标和名称 */}
      <div
        onClick={handleClick}
        className={`
          flex items-center gap-1 py-[3px] px-2 cursor-pointer rounded-md text-sm
          transition-colors duration-100 select-none
          ${isSelected
            ? 'bg-accent text-primary font-medium'        /* 选中态：高亮背景 + 主色文字 */
            : 'text-foreground hover:bg-accent/50'         /* 默认态：悬停半透明高亮 */
          }
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}   /* 根据层级计算左缩进 */
      >
        {/* 目录展开/折叠箭头（仅目录节点显示） */}
        {isDir ? (
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </span>
        ) : (
          /* 文件节点的占位空间（对齐箭头宽度） */
          <span className="w-4 h-4 flex-shrink-0" />
        )}

        {/* 节点图标：目录用文件夹图标（主色调），文件用文件图标（弱化色） */}
        {isDir ? (
          <Folder className="w-4 h-4 text-primary flex-shrink-0" />
        ) : (
          <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}

        {/* 节点名称：截断过长的文件名 */}
        <span className="truncate">{node.name}</span>
      </div>

      {/* 子节点列表：仅目录展开时渲染，带动画过渡 */}
      <AnimatePresence>
        {isDir && isExpanded && node.children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {node.children.map(child => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/**
 * FileTree - 文件树主组件
 *
 * 渲染完整的文件树结构，支持任意深度的嵌套目录。
 * 空状态时显示提示文字。
 */
export const FileTree: React.FC<FileTreeProps> = ({ nodes, selectedPath, onSelectFile }) => {
  /* 空状态：没有文件时显示提示 */
  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground text-sm">暂无文件</p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {nodes.map(node => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
};
