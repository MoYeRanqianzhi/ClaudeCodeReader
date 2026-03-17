/**
 * @file EditorPane.tsx - 文件内容编辑器面板
 * @description
 * 以只读代码编辑器的形式展示文件内容，带行号和语法样式。
 * 文件路径显示在顶部面包屑中，支持路径层级点击（视觉效果，不做跳转）。
 *
 * 功能：
 * - 显示文件路径面包屑（用 "/" 分隔各层级）
 * - 带行号的代码内容展示（等宽字体、可滚动）
 * - 空状态时显示"未打开文件"的占位提示
 * - 使用毛玻璃效果（backdrop-blur）提升层次感
 */

import React, { useMemo } from 'react';
import { FileCode } from 'lucide-react';

/**
 * EditorPane 组件的属性接口
 */
interface EditorPaneProps {
  /** 当前打开的文件路径（相对于项目根），为 null 表示未打开任何文件 */
  filePath: string | null;
  /** 文件的文本内容，为 null 表示未加载或不可用 */
  content: string | null;
}

/**
 * EditorPane - 文件内容查看面板
 *
 * 模拟代码编辑器的外观，左侧显示行号，右侧显示文件内容。
 * 顶部的面包屑展示当前文件在目录结构中的位置。
 */
export const EditorPane: React.FC<EditorPaneProps> = ({ filePath, content }) => {
  /**
   * 将文件内容拆分为行数组
   * 使用 useMemo 缓存结果，避免每次渲染都重新拆分
   */
  const lines = useMemo(() => {
    if (!content) return [];
    return content.split('\n');
  }, [content]);

  /**
   * 将文件路径拆分为面包屑片段
   * 如 "src/components/App.tsx" → ["src", "components", "App.tsx"]
   */
  const pathSegments = useMemo(() => {
    if (!filePath) return [];
    /* 同时支持正斜杠和反斜杠的路径分隔 */
    return filePath.split(/[/\\]/).filter(Boolean);
  }, [filePath]);

  /* ========== 空状态：未打开任何文件 ========== */
  if (!filePath || content === null) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background/60 backdrop-blur-sm">
        <div className="text-center">
          {/* 空状态提示容器：使用弱化的背景和边框 */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted text-muted-foreground border border-border">
            <FileCode className="w-4 h-4" />
            <span className="text-sm">在左侧选择一个文件以查看内容</span>
          </div>
        </div>
      </div>
    );
  }

  /* ========== 正常状态：显示文件内容 ========== */
  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background/60 backdrop-blur-sm">
      {/* 文件路径面包屑栏 */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border/50 bg-background/40">
        <FileCode className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        {/* 路径片段列表，用 "/" 分隔 */}
        {pathSegments.map((segment, idx) => (
          <React.Fragment key={idx}>
            {/* 非首个片段前显示分隔符 */}
            {idx > 0 && (
              <span className="text-muted-foreground/50 text-xs">/</span>
            )}
            {/* 路径片段：最后一个片段（文件名）加粗显示 */}
            <span
              className={`text-xs ${
                idx === pathSegments.length - 1
                  ? 'text-foreground font-medium'    /* 文件名：较深的前景色 + 中等字重 */
                  : 'text-muted-foreground'           /* 目录名：弱化色 */
              }`}
            >
              {segment}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* 代码内容区域：带行号的可滚动区域 */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className="flex min-w-0">
          {/* 行号列：固定宽度，右对齐，独立背景色 */}
          <div className="flex-shrink-0 select-none bg-muted/50 border-r border-border/50">
            {lines.map((_, idx) => (
              <div
                key={idx}
                className="px-3 py-0 text-right text-xs leading-5 text-muted-foreground font-mono"
              >
                {idx + 1}
              </div>
            ))}
          </div>

          {/* 代码内容列：等宽字体，保留空白和换行 */}
          <pre className="flex-1 min-w-0 px-4 py-0 text-xs leading-5 font-mono text-foreground whitespace-pre overflow-x-auto">
            {lines.map((line, idx) => (
              <div key={idx}>{line || ' '}</div>  /* 空行用空格占位，保持行高一致 */
            ))}
          </pre>
        </div>
      </div>
    </div>
  );
};
