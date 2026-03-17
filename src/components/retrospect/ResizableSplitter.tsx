/**
 * @file ResizableSplitter.tsx - 可拖拽分割线组件
 * @description
 * 用于在回溯视图中分隔左侧文件树面板和右侧编辑器面板。
 * 支持鼠标拖拽调整左侧面板宽度，并提供视觉反馈（高亮、光标变化）。
 *
 * 工作原理：
 * - 在 mousedown 时进入拖拽状态，注册全局 mousemove/mouseup 监听器
 * - mousemove 时根据鼠标 X 坐标实时更新左侧面板宽度（clamp 在 min/max 之间）
 * - mouseup 时退出拖拽状态，清理全局监听器和临时样式
 * - 使用 useCallback + useEffect 确保事件监听器闭包中的值始终最新
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * ResizableSplitter 组件的属性接口
 */
interface ResizableSplitterProps {
  /** 当前左侧面板宽度（像素） */
  leftWidth: number;
  /** 设置左侧面板宽度的 state setter */
  setLeftWidth: React.Dispatch<React.SetStateAction<number>>;
  /** 左侧面板最小宽度（像素），默认 180 */
  minWidth?: number;
  /** 左侧面板最大宽度（像素），默认 400 */
  maxWidth?: number;
}

/**
 * ResizableSplitter - 可拖拽分割线
 *
 * 渲染一条垂直的分割线（默认 1px 宽），鼠标悬停时加宽到 3px 并变色为主色调。
 * 拖拽过程中持续更新左侧面板宽度，提供流畅的调整体验。
 */
export const ResizableSplitter: React.FC<ResizableSplitterProps> = ({
  setLeftWidth,
  minWidth = 180,
  maxWidth = 400,
}) => {
  /** 是否正在拖拽中 */
  const [isDragging, setIsDragging] = useState(false);

  /** 父容器左边界偏移量（像素），用于修正 clientX 在有侧边栏时的位置偏差 */
  const offsetRef = useRef(0);

  /**
   * 处理拖拽过程中的鼠标移动
   * 使用 clientX 减去父容器左边界偏移，得到相对于父容器的实际宽度，
   * 然后 clamp 在 min/max 范围内
   */
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      /* 使用 clientX 减去父容器偏移，确保侧边栏可见时拖拽位置准确 */
      const newWidth = Math.min(maxWidth, Math.max(minWidth, e.clientX - offsetRef.current));
      setLeftWidth(newWidth);
    },
    [minWidth, maxWidth, setLeftWidth]
  );

  /**
   * 处理鼠标释放：结束拖拽
   * 恢复全局光标样式和文字选择功能
   */
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    /* 恢复默认光标 */
    document.body.style.cursor = '';
    /* 恢复文字选择能力 */
    document.body.style.userSelect = '';
  }, []);

  /**
   * 拖拽状态副作用：在 isDragging 为 true 时注册全局事件监听器
   *
   * 使用全局 document 级监听器而非分割线元素的事件，
   * 确保鼠标移出分割线范围后仍能正常响应拖拽。
   */
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    /* 清理：组件卸载或 isDragging 变为 false 时移除监听器 */
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  /**
   * 处理分割线上的鼠标按下：进入拖拽状态
   * 记录父容器的左边界位置作为基准偏移，修正侧边栏导致的 clientX 偏差。
   * 设置全局光标为 col-resize，禁用文字选择防止拖拽时误选。
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    /* 记录父容器的左边界位置，作为 clientX 的基准偏移 */
    const parentRect = (e.currentTarget.parentElement as HTMLElement)?.getBoundingClientRect();
    offsetRef.current = parentRect?.left ?? 0;
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`
        w-[1px] cursor-col-resize transition-all duration-150 flex-shrink-0
        ${isDragging
          ? 'bg-primary w-[3px]'           /* 拖拽中：主色调 + 加宽 */
          : 'bg-border hover:bg-primary hover:w-[3px]'  /* 默认/悬停 */
        }
      `}
    />
  );
};
