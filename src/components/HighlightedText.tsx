/**
 * @file HighlightedText.tsx - 搜索高亮文本组件
 * @description
 * 将文本中匹配搜索关键词的片段包裹在 <mark> 中高亮显示。
 * 支持 3 种搜索模式（由 SearchHighlight 字段控制）：
 * 1. 字面量 + 大小写不敏感：indexOf 在小写化文本上循环
 * 2. 字面量 + 大小写敏感：indexOf 在原始文本上精确匹配
 * 3. 正则表达式：RegExp exec 循环，无效正则时降级为原始文本显示
 *
 * 从 ToolResultRenderer 提取为共享组件，供所有需要搜索高亮的组件使用：
 * - ToolResultRenderer（工具结果内容）
 * - ToolUseRenderer（工具参数、diff 内容）
 */

import React from 'react';
import type { SearchHighlight } from '../types/claude';

/**
 * HighlightedText - 纯文本搜索高亮组件
 *
 * @param text - 要渲染的原始文本
 * @param highlight - 搜索高亮选项（为空则直接返回原始文本）
 */
export function HighlightedText({ text, highlight }: { text: string; highlight: SearchHighlight }) {
  const { query, caseSensitive, useRegex } = highlight;

  if (!query.trim()) return <>{text}</>;

  /** 所有匹配的 [start, end) 区间列表 */
  const matches: { start: number; end: number }[] = [];

  if (useRegex) {
    // 正则模式：compile RegExp，无效时降级显示原始文本
    try {
      const flags = 'g' + (caseSensitive ? '' : 'i');
      const re = new RegExp(query, flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; } // 防止零宽匹配死循环
        matches.push({ start: m.index, end: m.index + m[0].length });
      }
    } catch {
      // 无效正则表达式：直接返回原始文本，不高亮
      return <>{text}</>;
    }
  } else if (caseSensitive) {
    // 字面量 + 大小写敏感
    const queryLen = query.length;
    let pos = text.indexOf(query);
    while (pos !== -1) {
      matches.push({ start: pos, end: pos + queryLen });
      pos = text.indexOf(query, pos + queryLen);
    }
  } else {
    // 字面量 + 大小写不敏感（默认）
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const queryLen = lowerQuery.length;
    let pos = lowerText.indexOf(lowerQuery);
    while (pos !== -1) {
      matches.push({ start: pos, end: pos + queryLen });
      pos = lowerText.indexOf(lowerQuery, pos + queryLen);
    }
  }

  if (matches.length === 0) return <>{text}</>;

  // 拆分文本，将匹配片段包裹 <mark>
  const parts: (string | React.ReactElement)[] = [];
  let lastEnd = 0;
  let keyIdx = 0;

  for (const { start, end } of matches) {
    if (start > lastEnd) {
      parts.push(text.slice(lastEnd, start));
    }
    parts.push(
      <mark key={keyIdx++} className="search-highlight">
        {text.slice(start, end)}
      </mark>
    );
    lastEnd = end;
  }

  if (lastEnd < text.length) {
    parts.push(text.slice(lastEnd));
  }

  return <>{parts}</>;
}