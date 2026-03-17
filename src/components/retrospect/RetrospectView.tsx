/**
 * @file RetrospectView.tsx - 项目回溯主容器组件
 * @description
 * 「项目回溯」功能的顶层容器，负责：
 * - 初始化回溯（调用 retrospectInit 获取时间轴数据）
 * - 管理所有回溯相关状态（时间轴、当前索引、文件树、打开的文件等）
 * - 协调子组件之间的数据流（TopBar、TimelineBar、FileTree/WindowsExplorer、EditorPane）
 * - 处理时间轴索引变化的 debounce（避免 slider 快速拖动时频繁请求后端）
 * - 实现导出功能（复制文件、另存为、导出 ZIP）
 * - 组件卸载时清理后端回溯状态（释放内存）
 *
 * 视图模式：
 * - tree 模式：WindowsExplorer（网格文件浏览器）
 * - editor 模式：左侧 FileTree + 右侧 EditorPane（双面板布局，可拖拽调整宽度）
 *
 * 数据流：
 * 1. 挂载 → retrospectInit → timeline 数据 → setTimeline + setCurrentIndex
 * 2. currentIndex 变化（debounce 150ms） → retrospectFileTree → setFileTree
 * 3. 用户点击文件 → retrospectFileContent → setOpenFileContent
 * 4. 卸载 → retrospectCleanup（释放后端缓存）
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2 } from 'lucide-react';
import type { RetrospectTimeline, FileTreeNode } from '../../types/retrospect';
import {
  retrospectInit,
  retrospectCleanup,
  retrospectFileTree,
  retrospectFileContent,
  retrospectSaveFile,
  retrospectExportZip,
} from '../../utils/retrospectData';
import { TopBar } from './TopBar';
import { TimelineBar } from './TimelineBar';
import { FileTree } from './FileTree';
import { EditorPane } from './EditorPane';
import { WindowsExplorer } from './WindowsExplorer';
import { ResizableSplitter } from './ResizableSplitter';

/**
 * RetrospectView 组件的属性接口
 */
interface RetrospectViewProps {
  /** Claude 数据目录的绝对路径（~/.claude/） */
  claudeDataPath: string;
  /** 编码后的项目目录名（用于后端查找项目数据） */
  projectName: string;
  /** 解码后的人类可读项目路径（显示在 UI 中） */
  projectPath: string;
  /** 关闭回溯视图的回调（返回到聊天视图） */
  onClose: () => void;
}

/**
 * RetrospectView - 项目回溯主容器
 *
 * 全屏覆盖式组件，替代 ChatView 显示在主内容区。
 * 内部管理完整的回溯生命周期：初始化 → 交互 → 清理。
 */
export const RetrospectView: React.FC<RetrospectViewProps> = ({
  claudeDataPath,
  projectName,
  projectPath,
  onClose,
}) => {
  // ============ 状态声明 ============

  /** 视图模式：'tree'（文件管理器网格）或 'editor'（双面板编辑器） */
  const [currentView, setCurrentView] = useState<'tree' | 'editor'>('tree');
  /** 当前时间轴索引（slider 的值） */
  const [currentIndex, setCurrentIndex] = useState(0);
  /** 当前打开的文件路径 */
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  /** 当前打开的文件内容 */
  const [openFileContent, setOpenFileContent] = useState<string | null>(null);
  /** 编辑器模式下左侧面板宽度（像素） */
  const [splitWidth, setSplitWidth] = useState(240);
  /** 是否正在初始化（首次加载 timeline） */
  const [isInitializing, setIsInitializing] = useState(true);
  /** 是否正在加载回放数据（切换 index 时的文件树加载） */
  const [isPlaybackLoading, setIsPlaybackLoading] = useState(false);
  /** 回溯时间轴数据 */
  const [timeline, setTimeline] = useState<RetrospectTimeline | null>(null);
  /** 当前时间点的文件树 */
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  /** 错误信息 */
  const [error, setError] = useState<string | null>(null);
  /** toast 消息：用于显示导出操作的成功/失败反馈，3 秒后自动消失 */
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  /** debounce 定时器引用，用于 slider 快速拖动时的请求节流 */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 记录最近一次成功加载文件树的 index，避免重复请求 */
  const lastLoadedIndexRef = useRef<number>(-1);

  // ============ 初始化 ============

  /**
   * 初始化回溯数据
   *
   * 组件挂载时调用 retrospectInit 从后端获取时间轴数据。
   * 成功后设置 timeline 和 currentIndex（默认定位到最后一步操作）。
   *
   * 触发条件：仅在组件首次挂载时执行
   */
  useEffect(() => {
    let cancelled = false;  /* 防止组件卸载后的异步状态更新 */

    const init = async () => {
      try {
        setIsInitializing(true);
        setError(null);

        /* 调用后端初始化回溯 */
        const tl = await retrospectInit(claudeDataPath, projectName);

        if (cancelled) return;

        setTimeline(tl);
        /* 默认定位到最后一步（展示项目最终状态） */
        if (tl.totalOperations > 0) {
          setCurrentIndex(tl.totalOperations - 1);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('回溯初始化失败:', err);
        setError(err instanceof Error ? err.message : '初始化回溯失败');
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    };

    init();

    /* 组件卸载时：取消标志 + 清理后端状态 */
    return () => {
      cancelled = true;
      retrospectCleanup().catch(console.error);
    };
  }, [claudeDataPath, projectName]);

  // ============ Index 变化时加载文件树（debounce） ============

  /**
   * 当时间轴索引变化时，debounce 150ms 后加载对应时间点的文件树
   *
   * Debounce 策略：用户快速拖动 slider 时只在停止后才发起请求，
   * 避免每帧都调用后端造成性能问题。
   *
   * 使用 cancelled 标志防止组件卸载或依赖变化后异步回调仍执行状态更新。
   * 依赖数组仅包含 currentIndex，不包含 openFilePath，避免文件选择时
   * 不必要地重新触发文件树加载。openFilePath 通过 ref 在回调内读取。
   *
   * 触发条件：currentIndex 变化
   */
  useEffect(() => {
    /* timeline 未加载完成时跳过 */
    if (!timeline || timeline.totalOperations === 0) return;

    /** 取消标志：组件卸载或依赖变化时设为 true，防止异步回调执行状态更新 */
    let cancelled = false;

    /* 清除之前的 debounce 定时器 */
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    setIsPlaybackLoading(true);

    debounceRef.current = setTimeout(async () => {
      /* 如果已取消，不执行后续操作 */
      if (cancelled) return;

      /* 如果该 index 已经加载过，跳过重复请求 */
      if (lastLoadedIndexRef.current === currentIndex) {
        if (!cancelled) setIsPlaybackLoading(false);
        return;
      }

      try {
        const tree = await retrospectFileTree(currentIndex);
        if (cancelled) return;

        setFileTree(tree);
        lastLoadedIndexRef.current = currentIndex;

        /* 如果之前打开的文件在新的文件树中不存在了，清除打开状态 */
        if (openFilePath) {
          const fileExists = findFileInTree(tree, openFilePath);
          if (!fileExists) {
            if (!cancelled) {
              setOpenFilePath(null);
              setOpenFileContent(null);
            }
          } else {
            /* 文件仍存在，重新加载其内容（内容可能已变化） */
            try {
              const content = await retrospectFileContent(currentIndex, openFilePath);
              if (!cancelled) {
                setOpenFileContent(content);
              }
            } catch {
              /* 加载失败（如文件在该时间点内容不可用），清除 */
              if (!cancelled) {
                setOpenFilePath(null);
                setOpenFileContent(null);
              }
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('加载文件树失败:', err);
        }
      } finally {
        if (!cancelled) {
          setIsPlaybackLoading(false);
        }
      }
    }, 150);

    /* 清理：组件卸载或依赖变化时设置取消标志并清除定时器 */
    return () => {
      cancelled = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps -- 仅依赖 currentIndex，openFilePath 通过闭包读取当前值

  // ============ Toast 自动消失 ============

  /**
   * toast 消息自动消失副作用
   *
   * 当 toastMessage 不为 null 时，设置 3 秒定时器自动清除消息。
   * 返回清理函数确保组件卸载或消息变化时不会残留定时器。
   */
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // ============ 文件选中处理 ============

  /**
   * 处理文件选中事件
   *
   * 当用户在文件树或资源管理器中点击文件时调用。
   * 从后端获取该文件在当前时间点的内容。
   *
   * @param path - 选中文件的路径
   */
  const handleSelectFile = useCallback(
    async (path: string) => {
      setOpenFilePath(path);

      try {
        const content = await retrospectFileContent(currentIndex, path);
        setOpenFileContent(content);

        /* 点击文件后自动切换到编辑器视图以查看内容 */
        if (currentView === 'tree') {
          setCurrentView('editor');
        }
      } catch (err) {
        console.error('加载文件内容失败:', err);
        setOpenFileContent(null);
      }
    },
    [currentIndex, currentView]
  );

  // ============ 导出功能 ============

  /**
   * 复制当前文件内容到剪贴板
   * 成功或失败时均通过 toast 消息通知用户
   */
  const handleCopyFile = useCallback(async () => {
    if (!openFileContent) return;
    try {
      await navigator.clipboard.writeText(openFileContent);
      setToastMessage('已复制到剪贴板');
    } catch (err) {
      console.error('复制到剪贴板失败:', err);
      setToastMessage('复制失败: ' + String(err));
    }
  }, [openFileContent]);

  /**
   * 另存为当前打开的文件
   *
   * 使用 Tauri dialog 弹出保存对话框，然后调用后端 API 写入文件。
   * 成功或失败时均通过 toast 消息通知用户。
   */
  const handleSaveFile = useCallback(async () => {
    if (!openFilePath) return;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      /* 从文件路径中提取文件名作为默认保存名 */
      const fileName = openFilePath.split(/[/\\]/).pop() || 'file.txt';
      const savePath = await save({
        defaultPath: fileName,
      });
      /* 用户取消保存时 savePath 为 null */
      if (savePath) {
        await retrospectSaveFile(currentIndex, openFilePath, savePath);
        setToastMessage('文件已保存');
      }
    } catch (err) {
      console.error('另存为失败:', err);
      setToastMessage('另存为失败: ' + String(err));
    }
  }, [currentIndex, openFilePath]);

  /**
   * 导出当前时间点的项目快照为 ZIP 文件
   *
   * 使用 Tauri dialog 弹出保存对话框，然后调用后端 API 打包导出。
   * 成功或失败时均通过 toast 消息通知用户。
   */
  const handleExportZip = useCallback(async () => {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const savePath = await save({
        defaultPath: `snapshot-step-${currentIndex + 1}.zip`,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      });
      if (savePath) {
        await retrospectExportZip(currentIndex, savePath);
        setToastMessage('ZIP 导出成功');
      }
    } catch (err) {
      console.error('导出 ZIP 失败:', err);
      setToastMessage('导出 ZIP 失败: ' + String(err));
    }
  }, [currentIndex]);

  // ============ 辅助函数 ============

  /**
   * 在文件树中递归查找指定路径的文件是否存在
   *
   * @param tree - 文件树节点数组
   * @param targetPath - 要查找的文件路径
   * @returns 文件是否存在于树中
   */
  function findFileInTree(tree: FileTreeNode[], targetPath: string): boolean {
    for (const node of tree) {
      if (node.path === targetPath && node.type === 'file') return true;
      if (node.children && findFileInTree(node.children, targetPath)) return true;
    }
    return false;
  }

  // ============ 渲染 ============

  /* === 初始化加载状态 === */
  if (isInitializing) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">正在初始化项目回溯...</p>
        </div>
      </div>
    );
  }

  /* === 错误状态 === */
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-6">
          <p className="text-destructive text-sm mb-3">{error}</p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  /* === Timeline 为空（项目没有任何文件操作） === */
  if (!timeline || timeline.totalOperations === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground text-sm mb-3">
            该项目没有检测到文件操作记录
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  /* === 正常渲染：三段式布局（TopBar + 内容 + TimelineBar） === */
  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background relative">
      {/* 顶栏：导航、视图切换、导出 */}
      <TopBar
        onBack={onClose}
        currentView={currentView}
        setCurrentView={setCurrentView}
        projectName={projectPath}
        hasOpenFile={!!openFilePath && openFileContent !== null}
        currentIndex={currentIndex}
        openFilePath={openFilePath}
        openFileContent={openFileContent}
        onCopyFile={handleCopyFile}
        onSaveFile={handleSaveFile}
        onExportZip={handleExportZip}
      />

      {/* 主内容区：根据视图模式渲染不同布局 */}
      <div className="flex-1 flex min-w-0 min-h-0 relative">
        <AnimatePresence mode="wait">
          {currentView === 'tree' ? (
            /* ===== 文件管理器视图（WindowsExplorer） ===== */
            <motion.div
              key="tree-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1 flex min-w-0"
            >
              <WindowsExplorer
                nodes={fileTree}
                onSelectFile={handleSelectFile}
                selectedPath={openFilePath}
              />
            </motion.div>
          ) : (
            /* ===== 编辑器视图（FileTree + EditorPane） ===== */
            <motion.div
              key="editor-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1 flex min-w-0"
            >
              {/* 左侧：文件树面板 */}
              <div
                className="flex-shrink-0 overflow-y-auto custom-scrollbar bg-background/40 border-r border-border/50"
                style={{ width: splitWidth }}
              >
                {/* 面板标题 */}
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground bg-background/30 border-b border-border/50 uppercase tracking-wider">
                  资源管理器
                </div>
                {/* 文件树内容 */}
                {fileTree.length > 0 ? (
                  <FileTree
                    nodes={fileTree}
                    selectedPath={openFilePath}
                    onSelectFile={handleSelectFile}
                  />
                ) : (
                  <div className="flex items-center justify-center h-32">
                    <p className="text-muted-foreground text-xs">暂无文件</p>
                  </div>
                )}
              </div>

              {/* 可拖拽分割线 */}
              <ResizableSplitter
                leftWidth={splitWidth}
                setLeftWidth={setSplitWidth}
              />

              {/* 右侧：编辑器面板 */}
              <EditorPane
                filePath={openFilePath}
                content={openFileContent}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* 回放加载中覆盖层（切换时间轴索引时显示） */}
        <AnimatePresence>
          {isPlaybackLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-background/40 flex items-center justify-center z-20"
            >
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background/90 border border-border shadow-sm">
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
                <span className="text-sm text-muted-foreground">加载中...</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 底部时间轴控制栏 */}
      <TimelineBar
        timeline={timeline}
        currentIndex={currentIndex}
        setCurrentIndex={setCurrentIndex}
      />

      {/* Toast 消息：导出操作的成功/失败反馈，3 秒自动消失 */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 bg-foreground text-background px-4 py-2 rounded-lg shadow-lg text-sm"
          >
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
