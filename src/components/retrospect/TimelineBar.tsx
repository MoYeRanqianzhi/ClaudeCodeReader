/**
 * @file TimelineBar.tsx - 时间轴控制栏组件
 * @description
 * 回溯视图底部的时间轴控制栏，包含：
 * - Range slider：在时间轴上拖动选择操作步骤
 * - 前进/后退按钮：精确步进操作
 * - 当前操作信息展示：操作类型 badge、文件路径、时间戳
 * - 进度指示：当前步骤 / 总步骤
 *
 * slider 使用自定义 CSS 类 `.retrospect-slider`，
 * 通过 CSS 变量 `var(--primary)` 实现深色模式自适应的主色调。
 * slider 的 inline gradient 需要硬编码颜色值（CSS 变量在 inline style 中不可靠），
 * 因此通过检测 `.dark` 类来切换浅色/深色模式的颜色。
 */

import React, { useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { RetrospectTimeline, OpType } from '../../types/retrospect';

/**
 * TimelineBar 组件的属性接口
 */
interface TimelineBarProps {
  /** 完整的回溯时间轴数据 */
  timeline: RetrospectTimeline;
  /** 当前选中的时间轴索引 */
  currentIndex: number;
  /** 设置当前索引的回调 */
  setCurrentIndex: (index: number) => void;
}

/**
 * 获取操作类型对应的显示名称
 *
 * @param opType - 操作类型枚举值
 * @returns 中文显示名称
 */
function getOpLabel(opType: OpType): string {
  const labels: Record<OpType, string> = {
    write: 'Write',
    edit: 'Edit',
    bash_move: 'Move',
    bash_copy: 'Copy',
    bash_delete: 'Delete',
    bash_mkdir: 'Mkdir',
  };
  return labels[opType] || opType;
}

/**
 * 获取操作类型对应的 badge 样式类
 *
 * 保留原始语义色：
 * - Write/Copy/Mkdir/Move = 绿色（emerald，创建类操作）
 * - Edit = 蓝色（修改类操作）
 * - Delete = 红色（破坏类操作）
 *
 * @param opType - 操作类型
 * @returns Tailwind CSS 类名字符串
 */
function getOpBadgeClass(opType: OpType): string {
  switch (opType) {
    case 'write':
    case 'bash_copy':
    case 'bash_mkdir':
    case 'bash_move':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'edit':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'bash_delete':
      return 'bg-red-100 text-red-700 border-red-200';
    default:
      return 'bg-orange-100 text-orange-700 border-orange-200';
  }
}

/**
 * 格式化时间戳为简短的本地时间
 *
 * @param timestamp - ISO 8601 格式的时间字符串
 * @returns 格式化后的短时间字符串（如 "2024/03/15 14:30"）
 */
function formatTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

/**
 * 获取当前主题的主色调值
 *
 * 由于 CSS 变量不能可靠地用于 inline style 的 linear-gradient 中，
 * 需要通过 JS 检测当前主题并返回硬编码的颜色值。
 *
 * @returns 十六进制颜色值（浅色模式: #8b5cf6, 深色模式: #a78bfa）
 */
function getPrimaryColor(): string {
  const isDark = document.documentElement.classList.contains('dark');
  return isDark ? '#a78bfa' : '#8b5cf6';
}

/**
 * TimelineBar - 时间轴控制栏
 *
 * 固定在回溯视图底部，提供时间轴导航和当前操作信息展示。
 * 使用毛玻璃效果（backdrop-blur）叠加在内容区上方。
 */
export const TimelineBar: React.FC<TimelineBarProps> = ({
  timeline,
  currentIndex,
  setCurrentIndex,
}) => {
  /** 总操作数量 */
  const total = timeline.totalOperations;
  /** 最大索引值（slider 的 max 值） */
  const maxIndex = Math.max(0, total - 1);
  /** 当前操作的摘要信息（可能为 undefined，当 timeline 为空时） */
  const currentOp = timeline.operations[currentIndex];

  /**
   * 计算 slider 背景渐变
   * 已填充部分使用主色调，未填充部分使用弱化色
   * 使用 useMemo 缓存，仅在 currentIndex 或 maxIndex 变化时重新计算
   */
  const sliderBackground = useMemo(() => {
    if (maxIndex === 0) return `linear-gradient(to right, ${getPrimaryColor()} 100%, #e2e8f0 100%)`;
    const percent = (currentIndex / maxIndex) * 100;
    const primary = getPrimaryColor();
    return `linear-gradient(to right, ${primary} ${percent}%, #e2e8f0 ${percent}%)`;
  }, [currentIndex, maxIndex]);

  /**
   * 后退一步
   */
  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex, setCurrentIndex]);

  /**
   * 前进一步
   */
  const handleNext = useCallback(() => {
    if (currentIndex < maxIndex) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, maxIndex, setCurrentIndex]);

  /**
   * 处理 slider 值变化
   */
  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setCurrentIndex(Number(e.target.value));
    },
    [setCurrentIndex]
  );

  return (
    <div className="bg-background/80 backdrop-blur-md border-t border-border px-4 py-3 z-10">
      {/* 上排：当前操作信息 */}
      <div className="flex items-center justify-between mb-2">
        {/* 左侧：操作类型 badge + 文件路径 */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {currentOp && (
            <>
              {/* 操作类型标签（保留语义色） */}
              <span
                className={`text-xs px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${getOpBadgeClass(currentOp.opType)}`}
              >
                {getOpLabel(currentOp.opType)}
              </span>
              {/* 文件路径（截断过长路径） */}
              <span className="text-xs text-foreground truncate">
                {currentOp.filePath}
              </span>
            </>
          )}
        </div>

        {/* 右侧：时间戳 + 步骤进度 */}
        <div className="flex items-center gap-3 flex-shrink-0 ml-3">
          {currentOp && (
            <span className="text-xs text-muted-foreground">
              {formatTime(currentOp.timestamp)}
            </span>
          )}
          {/* 步骤进度指示 */}
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
            {total > 0 ? `${currentIndex + 1} / ${total}` : '0 / 0'}
          </span>
        </div>
      </div>

      {/* 下排：slider + 步进按钮 */}
      <div className="flex items-center gap-3">
        {/* 后退按钮 */}
        <button
          onClick={handlePrev}
          disabled={currentIndex <= 0}
          className="p-1 rounded-md text-foreground hover:text-primary hover:bg-secondary
                     transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="上一步"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Range slider：自定义样式通过 .retrospect-slider CSS 类 */}
        <input
          type="range"
          min={0}
          max={maxIndex}
          value={currentIndex}
          onChange={handleSliderChange}
          className="flex-1 h-2 rounded-full cursor-pointer retrospect-slider"
          style={{ background: sliderBackground }}
        />

        {/* 前进按钮 */}
        <button
          onClick={handleNext}
          disabled={currentIndex >= maxIndex}
          className="p-1 rounded-md text-foreground hover:text-primary hover:bg-secondary
                     transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="下一步"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
