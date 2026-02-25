/**
 * @file useCollapsible.ts - 统一折叠/展开逻辑 Hook
 * @description
 * 为所有可折叠组件提供统一的展开/收起状态管理，支持搜索导航自动展开。
 *
 * 适用组件：
 * - CompactSummaryBlock（压缩摘要消息）
 * - SystemMessageBlock（系统消息）
 * - MessageContentRenderer 中的 thinking block（思考过程）
 * - ToolUseRenderer（工具调用 diff 内容）
 * - ToolResultRenderer（工具结果内容）
 *
 * ## 行为规则
 *
 * 1. **搜索导航自动展开**：searchAutoExpand 变为 true → 自动展开
 * 2. **搜索导航自动收起**：searchAutoExpand 变为 false → 仅自动展开的消息才收起
 * 3. **手动点击展开**：不受搜索导航影响，导航离开时保持展开
 *
 * ## 实现原理
 *
 * 使用 useEffect 而非渲染期同步派生状态，确保在 React.memo 下可靠工作。
 * 初始值从 searchAutoExpand 派生，避免首次挂载时的闪烁。
 */

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useCollapsible - 统一折叠/展开 Hook
 *
 * @param searchAutoExpand - 搜索导航自动展开信号（true=展开，false/undefined=不干预）
 * @returns expanded 状态和手动切换回调
 */
export function useCollapsible(searchAutoExpand?: boolean) {
  /** 展开状态。初始值从 searchAutoExpand 派生：组件首次挂载时若已是搜索目标则直接展开 */
  const [expanded, setExpanded] = useState(!!searchAutoExpand);
  /** 标记当前展开是否由搜索导航自动触发（用于区分自动/手动展开） */
  const wasAutoExpandedRef = useRef(!!searchAutoExpand);

  useEffect(() => {
    if (searchAutoExpand) {
      // 搜索导航要求展开
      setExpanded(true);
      wasAutoExpandedRef.current = true;
    } else if (wasAutoExpandedRef.current) {
      // 搜索导航离开：仅自动展开的消息才自动收起，手动展开的保持不变
      setExpanded(false);
      wasAutoExpandedRef.current = false;
    }
  }, [searchAutoExpand]);

  /** 手动点击切换：清除自动展开标记，搜索导航离开时不会自动收起 */
  const handleManualToggle = useCallback(() => {
    setExpanded(prev => {
      wasAutoExpandedRef.current = false;
      return !prev;
    });
  }, []);

  return { expanded, handleManualToggle };
}
