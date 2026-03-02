/**
 * @file MessageDropZone.tsx - 消息间隙放置区域组件
 * @description
 * 在消息列表中每两条消息之间渲染的拖拽放置区域。
 * 仅负责拖拽指示功能，不包含编辑器逻辑。
 *
 * ## 位置上报机制
 * 悬停时通过模块级变量 `_hoveredAfterUuid` 上报位置（O(1)）。
 *
 * ## 条件渲染
 * `isDragging === false` 时返回 null，避免 flex gap 污染。
 */

import { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';

/**
 * 模块级变量：当前被悬停的 DropZone 的 afterUuid
 */
export let _hoveredAfterUuid: string | null = null;

/**
 * 重置悬停位置（拖拽结束时由父组件调用）
 */
export function resetHoveredAfterUuid(): void {
  _hoveredAfterUuid = null;
}

/**
 * MessageDropZone 组件的属性接口
 */
interface MessageDropZoneProps {
  /** 此放置区域位于哪条消息之后（空字符串表示列表最前方） */
  afterUuid: string;
  /** 全局拖拽状态：是否正在拖拽 Add 图标 */
  isDragging: boolean;
}

/**
 * MessageDropZone - 消息间隙放置区域（纯指示器）
 */
export function MessageDropZone({ afterUuid, isDragging }: MessageDropZoneProps) {
  const [isOver, setIsOver] = useState(false);
  const [, setDragCounter] = useState(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => {
      const next = prev + 1;
      if (next === 1) {
        setIsOver(true);
        _hoveredAfterUuid = afterUuid;
      }
      return next;
    });
  }, [afterUuid]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => {
      const next = prev - 1;
      if (next <= 0) {
        setIsOver(false);
        if (_hoveredAfterUuid === afterUuid) {
          _hoveredAfterUuid = null;
        }
        return 0;
      }
      return next;
    });
  }, [afterUuid]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  if (!isDragging) return null;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
    >
      <motion.div
        initial={{ height: 24, opacity: 1 }}
        animate={{ height: isOver ? 56 : 24 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="overflow-hidden shrink-0"
      >
        <div
          className={`
            h-full rounded-lg flex items-center justify-center gap-2 transition-colors duration-150
            ${isOver
              ? 'border-2 border-dashed border-primary/40 bg-primary/5'
              : 'border border-dashed border-border/30'
            }
          `}
        >
          {isOver && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 text-primary/60"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">在此处插入消息</span>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
