/**
 * @file useProgressiveRender.ts - 视口驱动的渐进式渲染 Hook
 * @description
 * 为大量消息列表提供高性能渲染策略：
 *
 * 1. **初始渲染**：仅渲染列表末尾的 INITIAL_BATCH 条消息（用户通常看底部）
 * 2. **空闲扩散**：利用 requestIdleCallback 从渲染中心向外逐批扩展
 * 3. **滚动重定**：当用户滚动到未渲染区域，立即渲染该区域并重定渲染中心
 * 4. **非破坏性**：已渲染的消息永远不会被移除
 *
 * ## 性能关键设计
 *
 * 使用 **ref + 版本号** 而非直接将区间列表放入 state：
 * - `rangesRef` 存储实际区间数据（不触发渲染）
 * - `version` 是一个递增计数器（触发渲染的唯一 state）
 * - 空闲扩散在 ref 上累积多批修改，最后一次性 bump version
 * - 避免了「每批 10 条 → 重渲染 → 下一批 → 重渲染」的连锁反应
 *
 * ## 渲染优先级
 *
 * 没有固定的渲染顺序。渲染中心 (centerRef) 随用户视口动态移动：
 * - 初始中心 = 列表末尾
 * - 用户滚动 → 中心跟随视口中央的消息索引
 * - 空闲扩散始终从当前中心向外扩展
 */

import { useRef, useEffect, useCallback, useState } from 'react';

// ============ 常量 ============

/** 首次渲染的消息数量（覆盖一屏 + 少量缓冲） */
const INITIAL_BATCH = 40;

/**
 * 每次空闲帧内渲染的消息数量。
 * 设较大值减少 idle 回调次数，每次回调内不触发 React 渲染。
 */
const IDLE_BATCH = 20;

/**
 * 空闲扩散累积到此数量后触发一次 React 渲染。
 * 值越大，渲染次数越少，但用户等待空白消息的时间越长。
 */
const FLUSH_THRESHOLD = 50;

// ============ 区间工具函数 ============

/** 表示一段已渲染的连续索引区间 [lo, hi]（闭区间） */
interface Range {
  lo: number;
  hi: number;
}

/**
 * 检查指定索引是否在任意已渲染区间内
 */
function isInRanges(ranges: Range[], index: number): boolean {
  for (const r of ranges) {
    if (index >= r.lo && index <= r.hi) return true;
    if (r.lo > index) break;
  }
  return false;
}

/**
 * 向区间列表中添加一个新区间，并合并所有重叠/相邻区间
 */
function addAndMerge(ranges: Range[], newRange: Range): Range[] {
  const all = [...ranges, newRange].sort((a, b) => a.lo - b.lo);
  const merged: Range[] = [all[0]];
  for (let i = 1; i < all.length; i++) {
    const last = merged[merged.length - 1];
    const curr = all[i];
    if (last.hi + 1 >= curr.lo) {
      last.hi = Math.max(last.hi, curr.hi);
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

/**
 * 计算已渲染的总索引数
 */
function totalRendered(ranges: Range[]): number {
  let count = 0;
  for (const r of ranges) count += r.hi - r.lo + 1;
  return count;
}

// ============ Hook 主体 ============

/**
 * useProgressiveRender - 视口驱动的渐进式渲染 Hook
 *
 * @param totalCount - 消息总数（过滤后的可见消息数）
 * @param scrollContainerRef - 滚动容器的 ref
 * @returns
 *   - `isRendered(index)`: 判断指定索引的消息是否应该渲染完整内容
 *   - `handleScroll`: 绑定到滚动容器的 onScroll 回调
 *   - `scrollToBottom`: 手动滚动到底部（在初始渲染完成后调用）
 */
export function useProgressiveRender(
  totalCount: number,
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
) {
  /**
   * 区间数据存储在 ref 中，避免每次修改触发 React 渲染。
   * 仅通过 bump version 来批量通知 React 重新读取 ref。
   */
  const rangesRef = useRef<Range[]>([]);

  /**
   * 版本计数器：每次 bump 触发一次 React 渲染。
   * 这是整个 Hook 唯一的 React state，所有渲染都由它驱动。
   */
  const [version, setVersion] = useState(0);

  /** 当前渲染中心索引 */
  const centerRef = useRef(0);

  /** requestIdleCallback 句柄 */
  const idleHandleRef = useRef(0);

  /** 上次 flush 后累积的新增渲染数 */
  const pendingCountRef = useRef(0);

  /**
   * 初始化：totalCount 变化时，设定初始渲染区间（列表末尾 INITIAL_BATCH 条）
   * 并立即 bump version 让 React 渲染这些消息。
   */
  useEffect(() => {
    cancelIdleCallback(idleHandleRef.current);
    pendingCountRef.current = 0;

    if (totalCount === 0) {
      rangesRef.current = [];
      setVersion(v => v + 1);
      return;
    }

    const center = totalCount - 1;
    centerRef.current = center;
    const lo = Math.max(0, center - INITIAL_BATCH + 1);
    rangesRef.current = [{ lo, hi: center }];
    setVersion(v => v + 1);
  }, [totalCount]);

  /**
   * 空闲扩散：version 变化后检查是否还有未渲染的消息，
   * 使用 requestIdleCallback 在后台逐批扩展。
   *
   * 关键：在 idle 回调中只修改 ref，累积到 FLUSH_THRESHOLD 后才 bump version。
   * 这样多批扩展只触发一次 React 渲染，避免连锁重渲染。
   */
  useEffect(() => {
    if (totalCount === 0) return;
    if (totalRendered(rangesRef.current) >= totalCount) return;

    const expandLoop = () => {
      const ranges = rangesRef.current;
      if (totalRendered(ranges) >= totalCount) return;

      // 找下一批待渲染索引（从 center 向外扩散）
      const center = centerRef.current;
      const maxDist = Math.max(center, totalCount - 1 - center) + 1;
      const batch: number[] = [];

      for (let dist = 0; dist < maxDist && batch.length < IDLE_BATCH; dist++) {
        const candidates = dist === 0 ? [center] : [center + dist, center - dist];
        for (const idx of candidates) {
          if (idx < 0 || idx >= totalCount) continue;
          if (!isInRanges(ranges, idx)) {
            batch.push(idx);
            if (batch.length >= IDLE_BATCH) break;
          }
        }
      }

      if (batch.length === 0) return;

      // 合并到 ref（不触发 React 渲染）
      batch.sort((a, b) => a - b);
      let updated = ranges;
      let segLo = batch[0];
      let segHi = batch[0];
      for (let i = 1; i < batch.length; i++) {
        if (batch[i] === segHi + 1) {
          segHi = batch[i];
        } else {
          updated = addAndMerge(updated, { lo: segLo, hi: segHi });
          segLo = batch[i];
          segHi = batch[i];
        }
      }
      updated = addAndMerge(updated, { lo: segLo, hi: segHi });
      rangesRef.current = updated;

      pendingCountRef.current += batch.length;

      // 累积够了 → flush：bump version 触发一次 React 渲染
      if (pendingCountRef.current >= FLUSH_THRESHOLD || totalRendered(updated) >= totalCount) {
        pendingCountRef.current = 0;
        setVersion(v => v + 1);
      }

      // 还有更多 → 继续安排下一次 idle 回调
      if (totalRendered(updated) < totalCount) {
        idleHandleRef.current = requestIdleCallback(expandLoop);
      }
    };

    idleHandleRef.current = requestIdleCallback(expandLoop);
    return () => cancelIdleCallback(idleHandleRef.current);
    // 仅在 version 和 totalCount 变化时重新启动扩散循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, totalCount]);

  /**
   * 判断指定索引是否已渲染。
   * 读取 ref 而非 state，配合 version 确保调用时 ref 已更新。
   */
  const isRendered = useCallback(
    // version 在依赖中确保 React 重渲染后能读到最新的 rangesRef
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (index: number): boolean => isInRanges(rangesRef.current, index),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );

  /**
   * 滚动事件处理：二分查找视口中心对应的消息索引，
   * 如果该索引未渲染则立即渲染一批并 bump version。
   */
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || totalCount === 0) return;

    const viewportCenterY = container.scrollTop + container.clientHeight / 2;
    const items = container.querySelectorAll<HTMLElement>('[data-msg-index]');
    if (items.length === 0) return;

    // 二分查找视口中心元素
    let lo = 0;
    let hi = items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const el = items[mid];
      const bottom = el.offsetTop + el.offsetHeight;
      if (bottom < viewportCenterY) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    const targetEl = items[lo];
    if (!targetEl) return;
    const msgIndex = parseInt(targetEl.dataset.msgIndex || '0', 10);

    // 更新渲染中心
    centerRef.current = msgIndex;

    // 如果视口附近有未渲染的消息，立即渲染
    if (!isInRanges(rangesRef.current, msgIndex)) {
      const batchLo = Math.max(0, msgIndex - Math.floor(INITIAL_BATCH / 2));
      const batchHi = Math.min(totalCount - 1, msgIndex + Math.floor(INITIAL_BATCH / 2));
      rangesRef.current = addAndMerge(rangesRef.current, { lo: batchLo, hi: batchHi });
      pendingCountRef.current = 0;
      setVersion(v => v + 1);
    }
  }, [scrollContainerRef, totalCount]);

  /**
   * 滚动到底部。
   *
   * 使用轮询策略确保在 React 渲染 + 浏览器布局完成后再滚动：
   * 1. 首次调用 rAF 等待当前帧布局完成
   * 2. 连续检查 scrollHeight 是否稳定（两帧相同即视为布局完成）
   * 3. 最多轮询 10 帧（约 160ms），防止无限等待
   */
  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    let lastHeight = 0;
    let stableFrames = 0;
    let attempts = 0;
    const maxAttempts = 10;

    const poll = () => {
      const currentHeight = el.scrollHeight;
      if (currentHeight === lastHeight && currentHeight > 0) {
        stableFrames++;
      } else {
        stableFrames = 0;
      }
      lastHeight = currentHeight;
      attempts++;

      if (stableFrames >= 2 || attempts >= maxAttempts) {
        // 布局已稳定或超时，立即滚动到底部
        el.scrollTop = currentHeight;
      } else {
        requestAnimationFrame(poll);
      }
    };

    // 首帧延迟，确保 React commit 后的 state 更新已处理
    requestAnimationFrame(poll);
  }, [scrollContainerRef]);

  return { isRendered, handleScroll, scrollToBottom };
}
