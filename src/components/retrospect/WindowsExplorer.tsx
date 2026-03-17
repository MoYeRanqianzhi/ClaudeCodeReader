/**
 * @file WindowsExplorer.tsx - Windows 资源管理器风格的文件浏览器
 * @description
 * 以类似 Windows 资源管理器的网格布局展示文件和目录。
 * 支持面包屑导航、双击进入目录、单击选中/打开文件。
 *
 * 功能特性：
 * - 面包屑地址栏：显示当前路径层级，点击可跳转到上级目录
 * - 返回上级按钮：导航到父目录
 * - 网格布局：文件和目录以图标+名称的卡片形式展示
 * - 文件类型图标：根据扩展名显示不同颜色的图标
 * - 空目录提示：当前目录无内容时显示友好提示
 *
 * 与 FileTree 组件互补：FileTree 提供传统的树形侧边栏，
 * WindowsExplorer 提供更直观的网格浏览体验。
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { ArrowLeft, Folder, FileText, FileCode, Image, FileJson, File } from 'lucide-react';
import type { FileTreeNode } from '../../types/retrospect';

/**
 * WindowsExplorer 组件的属性接口
 */
interface WindowsExplorerProps {
  /** 完整的文件树节点数组（根级） */
  nodes: FileTreeNode[];
  /** 文件选中回调，传入选中文件的路径 */
  onSelectFile: (path: string) => void;
  /** 当前选中的文件路径 */
  selectedPath: string | null;
}

/**
 * 根据文件扩展名获取对应的图标组件和颜色
 *
 * 文件类型图标保留原始语义色（非项目语义色）：
 * - 代码文件（.ts/.js/.py 等）：蓝色
 * - 样式文件（.css/.scss 等）：天蓝色
 * - JSON/配置文件：黄色
 * - 图片文件：紫色
 * - 其他文件：灰色
 *
 * @param name - 文件名
 * @returns 包含图标组件和颜色类名的对象
 */
function getFileIcon(name: string): { icon: React.ElementType; colorClass: string } {
  const ext = name.split('.').pop()?.toLowerCase() || '';

  /* 代码文件 */
  if (['ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'go', 'java', 'c', 'cpp', 'h', 'vue', 'svelte'].includes(ext)) {
    return { icon: FileCode, colorClass: 'text-blue-400' };
  }
  /* 样式文件 */
  if (['css', 'scss', 'sass', 'less', 'styl'].includes(ext)) {
    return { icon: FileCode, colorClass: 'text-cyan-400' };
  }
  /* JSON/配置文件 */
  if (['json', 'yaml', 'yml', 'toml', 'ini', 'env'].includes(ext)) {
    return { icon: FileJson, colorClass: 'text-yellow-500' };
  }
  /* 图片文件 */
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) {
    return { icon: Image, colorClass: 'text-purple-400' };
  }
  /* Markdown/文档 */
  if (['md', 'mdx', 'txt', 'doc', 'docx', 'pdf'].includes(ext)) {
    return { icon: FileText, colorClass: 'text-muted-foreground' };
  }
  /* 默认 */
  return { icon: File, colorClass: 'text-muted-foreground' };
}

/**
 * WindowsExplorer - 网格文件浏览器
 *
 * 维护一个 `currentPath` 状态表示当前浏览的目录路径。
 * 通过遍历文件树找到当前目录的子节点进行渲染。
 */
export const WindowsExplorer: React.FC<WindowsExplorerProps> = ({
  nodes,
  onSelectFile,
  selectedPath,
}) => {
  /** 当前浏览的目录路径，空字符串表示根目录 */
  const [currentPath, setCurrentPath] = useState('');

  /**
   * 当文件树根节点变化时（如时间轴切换），验证当前导航路径是否仍然有效。
   * 如果当前路径指向的目录在新文件树中不存在，重置到根目录，
   * 避免用户看到空白或无效的导航状态。
   *
   * 触发条件：仅依赖 nodes（即 rootNodes）变化
   */
  useEffect(() => {
    /* 已在根目录，无需验证 */
    if (!currentPath) return;

    /**
     * 递归查找指定路径的目录节点是否存在于文件树中
     * @param searchNodes - 要搜索的节点列表
     * @param targetPath - 目标目录路径
     * @returns 目录是否存在
     */
    const findDirectory = (searchNodes: FileTreeNode[], targetPath: string): boolean => {
      for (const node of searchNodes) {
        if (node.path === targetPath && node.type === 'directory') return true;
        if (node.children && findDirectory(node.children, targetPath)) return true;
      }
      return false;
    };

    /* 如果当前路径在新文件树中不存在，重置到根目录 */
    if (!findDirectory(nodes, currentPath)) {
      setCurrentPath('');
    }
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps -- 仅依赖 nodes 变化，currentPath 不加入避免无限循环

  /**
   * 根据当前路径查找对应的子节点列表
   *
   * 从根节点开始，按路径层级逐层深入，找到当前目录的 children。
   * 如果当前路径为空（根目录），直接返回顶层节点。
   */
  const currentNodes = useMemo(() => {
    if (!currentPath) return nodes;

    /* 从根节点递归查找目标目录 */
    const findNode = (searchNodes: FileTreeNode[], targetPath: string): FileTreeNode[] => {
      for (const node of searchNodes) {
        if (node.path === targetPath && node.type === 'directory') {
          return node.children || [];
        }
        if (node.children) {
          const result = findNode(node.children, targetPath);
          if (result.length > 0 || node.children.some(c => c.path === targetPath)) {
            if (result.length > 0) return result;
            const target = node.children.find(c => c.path === targetPath);
            return target?.children || [];
          }
        }
      }
      return [];
    };

    return findNode(nodes, currentPath);
  }, [nodes, currentPath]);

  /**
   * 将当前路径拆分为面包屑片段
   * 每个片段包含名称和完整路径（用于点击跳转）
   */
  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.split(/[/\\]/).filter(Boolean);
    const crumbs: { name: string; path: string }[] = [];
    let accumulated = '';
    for (const part of parts) {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      crumbs.push({ name: part, path: accumulated });
    }
    return crumbs;
  }, [currentPath]);

  /**
   * 处理项目点击（单击）
   * - 目录：进入该目录
   * - 文件：触发文件选中回调
   */
  const handleItemClick = useCallback(
    (node: FileTreeNode) => {
      if (node.type === 'directory') {
        setCurrentPath(node.path);
      } else {
        onSelectFile(node.path);
      }
    },
    [onSelectFile]
  );

  /**
   * 返回上级目录
   */
  const handleGoUp = useCallback(() => {
    if (!currentPath) return;
    const parts = currentPath.split(/[/\\]/).filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join('/'));
  }, [currentPath]);

  /**
   * 对节点排序：目录在前，文件在后，各自按名称字母序
   */
  const sortedNodes = useMemo(() => {
    return [...currentNodes].sort((a, b) => {
      /* 目录优先 */
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      /* 同类型按名称排序 */
      return a.name.localeCompare(b.name);
    });
  }, [currentNodes]);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background/80 backdrop-blur-sm">
      {/* ===== 工具栏：返回按钮 + 面包屑地址栏 ===== */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/80 border-b border-border">
        {/* 返回上级按钮 */}
        <button
          onClick={handleGoUp}
          disabled={!currentPath}
          className="p-1 rounded-md text-foreground hover:bg-accent transition-colors
                     disabled:opacity-30 disabled:cursor-not-allowed"
          title="返回上级"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        {/* 面包屑地址栏 */}
        <div className="flex items-center gap-1 flex-1 min-w-0 px-2 py-1 rounded-md bg-background border border-border text-xs">
          {/* 根目录入口 */}
          <button
            onClick={() => setCurrentPath('')}
            className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
          >
            /
          </button>
          {/* 各层级面包屑 */}
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={crumb.path}>
              <span className="text-muted-foreground/50">/</span>
              <button
                onClick={() => setCurrentPath(crumb.path)}
                className={`truncate hover:text-primary transition-colors ${
                  idx === breadcrumbs.length - 1
                    ? 'text-foreground font-medium'       /* 当前目录名加粗 */
                    : 'text-muted-foreground'
                }`}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ===== 文件网格区域 ===== */}
      <div className="flex-1 overflow-auto custom-scrollbar p-3">
        {sortedNodes.length === 0 ? (
          /* 空目录提示 */
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm">此目录为空</p>
          </div>
        ) : (
          /* 网格布局：响应式列数 */
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {sortedNodes.map(node => {
              /* 获取文件图标和颜色 */
              const { icon: IconComponent, colorClass } = node.type === 'directory'
                ? { icon: Folder, colorClass: 'text-primary fill-secondary' }
                : getFileIcon(node.name);

              return (
                <div
                  key={node.path}
                  onClick={() => handleItemClick(node)}
                  className={`group flex flex-col items-center gap-1.5 p-3 rounded-lg cursor-pointer
                              border border-transparent transition-all
                              hover:bg-secondary hover:border-primary/20 ${
                                selectedPath === node.path ? 'bg-secondary border-primary/20' : ''
                              }`}
                >
                  {/* 文件/目录图标 */}
                  <IconComponent className={`w-10 h-10 ${colorClass} transition-colors`} />
                  {/* 文件/目录名称 */}
                  <span className="text-xs text-center truncate w-full text-foreground group-hover:text-primary transition-colors">
                    {node.name}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
