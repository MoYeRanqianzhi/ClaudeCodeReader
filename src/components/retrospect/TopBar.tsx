/**
 * @file TopBar.tsx - 回溯视图顶栏组件
 * @description
 * 回溯视图最顶部的工具栏，包含：
 * - 返回按钮：退出回溯视图
 * - 项目名称标识
 * - 视图切换器：在「文件管理器」和「编辑器」两种视图间切换
 * - 导出下拉菜单：复制文件内容、另存为、导出 ZIP
 *
 * 导出功能对接真实的 Tauri API：
 * - 复制文件：使用 navigator.clipboard.writeText
 * - 另存为文件：使用 @tauri-apps/plugin-dialog 的 save() + retrospectSaveFile
 * - 导出 ZIP：使用 save() + retrospectExportZip
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, FolderOpen, Code, Download, Copy, Save, Archive } from 'lucide-react';

/**
 * TopBar 组件的属性接口
 */
interface TopBarProps {
  /** 返回（退出回溯视图）的回调 */
  onBack: () => void;
  /** 当前活跃的视图模式：'tree'（文件管理器）或 'editor'（编辑器） */
  currentView: 'tree' | 'editor';
  /** 设置视图模式的回调 */
  setCurrentView: (view: 'tree' | 'editor') => void;
  /** 项目路径（人类可读的解码路径），显示在顶栏中 */
  projectName: string;
  /** 是否有打开的文件（控制导出按钮的可用状态） */
  hasOpenFile: boolean;
  /** 当前时间轴索引 */
  currentIndex: number;
  /** 当前打开的文件路径 */
  openFilePath: string | null;
  /** 当前打开的文件内容 */
  openFileContent: string | null;
  /** 复制当前文件内容的回调 */
  onCopyFile: () => void;
  /** 另存为当前文件的回调 */
  onSaveFile: () => void;
  /** 导出当前快照为 ZIP 的回调 */
  onExportZip: () => void;
}

/**
 * TopBar - 回溯视图顶部工具栏
 *
 * 使用毛玻璃效果（backdrop-blur）悬浮在内容区域上方，
 * 提供导航、视图切换和导出功能。
 */
export const TopBar: React.FC<TopBarProps> = ({
  onBack,
  currentView,
  setCurrentView,
  projectName,
  hasOpenFile,
  currentIndex: _currentIndex,
  openFilePath: _openFilePath,
  openFileContent: _openFileContent,
  onCopyFile,
  onSaveFile,
  onExportZip,
}) => {
  /** 导出下拉菜单是否打开 */
  const [showExportMenu, setShowExportMenu] = useState(false);
  /** 导出菜单的 DOM 引用，用于点击外部关闭 */
  const exportMenuRef = useRef<HTMLDivElement>(null);

  /**
   * 点击外部关闭导出菜单
   * 监听全局 mousedown 事件，如果点击目标不在菜单内则关闭
   */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };

    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportMenu]);

  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-background/70 backdrop-blur-md border-b border-border z-10">
      {/* ===== 左侧：返回按钮 + 项目名称 ===== */}
      <div className="flex items-center gap-3">
        {/* 返回按钮：退出回溯视图 */}
        <motion.button
          onClick={onBack}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          title="退出回溯"
        >
          <ArrowLeft className="w-5 h-5" />
        </motion.button>

        {/* 标题和项目名称 */}
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-foreground">项目回溯</h1>
          {/* 项目名称标签 */}
          <span className="text-xs px-2 py-0.5 rounded-md bg-muted border border-border/50 text-muted-foreground truncate max-w-[300px]">
            {projectName}
          </span>
        </div>
      </div>

      {/* ===== 中间：视图切换器 ===== */}
      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted border border-border/50">
        {/* 文件管理器视图按钮 */}
        <button
          onClick={() => setCurrentView('tree')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
            currentView === 'tree'
              ? 'bg-background text-primary shadow-sm'              /* 激活态 */
              : 'text-muted-foreground hover:text-foreground'       /* 非激活态 */
          }`}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>文件管理器</span>
        </button>

        {/* 编辑器视图按钮 */}
        <button
          onClick={() => setCurrentView('editor')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
            currentView === 'editor'
              ? 'bg-background text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Code className="w-3.5 h-3.5" />
          <span>编辑器</span>
        </button>
      </div>

      {/* ===== 右侧：导出下拉菜单 ===== */}
      <div className="relative" ref={exportMenuRef}>
        <motion.button
          onClick={() => setShowExportMenu(!showExportMenu)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                     text-foreground bg-background border border-border
                     hover:text-primary transition-colors"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Download className="w-3.5 h-3.5" />
          <span>导出</span>
        </motion.button>

        {/* 导出下拉菜单 */}
        <AnimatePresence>
          {showExportMenu && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              transition={{ duration: 0.12 }}
              className="absolute right-0 top-full mt-1 w-52 bg-background/90 backdrop-blur-md
                         border border-border rounded-lg shadow-lg z-50 overflow-hidden py-1"
            >
              {/* 复制当前文件内容 */}
              <button
                onClick={() => {
                  setShowExportMenu(false);
                  onCopyFile();
                }}
                disabled={!hasOpenFile}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground
                           hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Copy className="w-4 h-4" />
                <span>复制当前文件</span>
              </button>

              {/* 另存为当前文件 */}
              <button
                onClick={() => {
                  setShowExportMenu(false);
                  onSaveFile();
                }}
                disabled={!hasOpenFile}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground
                           hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" />
                <span>另存为当前文件</span>
              </button>

              {/* 分隔线 */}
              <div className="border-t border-border my-1" />

              {/* 导出当前快照为 ZIP */}
              <button
                onClick={() => {
                  setShowExportMenu(false);
                  onExportZip();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground
                           hover:bg-secondary transition-colors"
              >
                <Archive className="w-4 h-4" />
                <span>导出当前快照为 ZIP</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
