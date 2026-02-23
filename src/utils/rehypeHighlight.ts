/**
 * @file rehypeHighlight.ts - 搜索文本高亮 rehype 插件
 * @description
 * 零外部依赖的 rehype 插件，遍历 HAST（HTML Abstract Syntax Tree）树中的
 * 文本节点，将匹配搜索关键词的片段包裹在 `<mark class="search-highlight">` 中。
 *
 * 支持 3 种搜索模式（由 SearchHighlight 的 caseSensitive / useRegex 字段控制）：
 * 1. **字面量 + 大小写不敏感（默认）**：indexOf 在小写化文本上循环，最快
 * 2. **字面量 + 大小写敏感**：indexOf 在原始文本上精确匹配
 * 3. **正则表达式**：RegExp（g/gi 标志）exec 循环；无效正则静默跳过，不抛错
 *
 * 工作原理：
 * 1. 接收 SearchHighlight 对象，在函数创建阶段编译 MatchFinder（正则表达式一次编译）
 * 2. 递归遍历 HAST 树的所有子节点
 * 3. 对 type === 'text' 的节点调用 MatchFinder 获取所有匹配区间
 * 4. 将匹配片段替换为 `<mark>` 元素节点，非匹配片段保持为文本节点
 * 5. 从末尾向前 splice，避免索引偏移
 *
 * 性能特点：
 * - 仅在 query 非空时生成插件，无 query 时不注入 rehype 管线
 * - MatchFinder 在插件创建阶段构造一次，不在每个节点重复计算
 * - 不引入任何第三方依赖
 */

import type { SearchHighlight } from '../types/claude';

// ============ HAST 节点类型定义（最小化，仅覆盖插件所需） ============

/** HAST 文本节点 */
interface HastText {
  type: 'text';
  value: string;
}

/** HAST 元素节点 */
interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}

/** HAST 根节点 */
interface HastRoot {
  type: 'root';
  children: HastNode[];
}

/** HAST 节点联合类型 */
type HastNode = HastText | HastElement | HastRoot;

/** 带 children 的父节点类型 */
type HastParent = HastElement | HastRoot;

/** 文本中单个匹配区间 */
interface MatchRange {
  start: number;
  end: number;
}

/**
 * 匹配查找器函数类型
 * 给定一段文本，返回所有匹配区间（按 start 升序排列）
 */
type MatchFinder = (text: string) => MatchRange[];

// ============ 三种 MatchFinder 工厂函数 ============

/**
 * 字面量 + 大小写不敏感的匹配查找器
 * 将文本和查询词均小写化后做 indexOf 循环。
 *
 * @param query - 原始查询词（内部自动小写化）
 */
function createLiteralInsensitiveFinder(query: string): MatchFinder {
  const lowerQuery = query.toLowerCase();
  const queryLen = lowerQuery.length;
  return (text: string): MatchRange[] => {
    const lowerText = text.toLowerCase();
    const matches: MatchRange[] = [];
    let pos = lowerText.indexOf(lowerQuery);
    while (pos !== -1) {
      matches.push({ start: pos, end: pos + queryLen });
      pos = lowerText.indexOf(lowerQuery, pos + queryLen);
    }
    return matches;
  };
}

/**
 * 字面量 + 大小写敏感的匹配查找器
 * 直接在原始文本上做 indexOf 循环，不做大小写转换。
 *
 * @param query - 精确查询词
 */
function createLiteralSensitiveFinder(query: string): MatchFinder {
  const queryLen = query.length;
  return (text: string): MatchRange[] => {
    const matches: MatchRange[] = [];
    let pos = text.indexOf(query);
    while (pos !== -1) {
      matches.push({ start: pos, end: pos + queryLen });
      pos = text.indexOf(query, pos + queryLen);
    }
    return matches;
  };
}

/**
 * 正则表达式匹配查找器
 * 使用带 g（或 gi）标志的 RegExp exec 循环。
 * 遇到零宽匹配时自动递增 lastIndex，避免死循环。
 *
 * @param pattern - 正则表达式字符串（不含 flags）
 * @param caseInsensitive - 是否大小写不敏感（对应 i 标志）
 * @returns MatchFinder，或 null（pattern 为无效正则时返回 null）
 */
function createRegexFinder(pattern: string, caseInsensitive: boolean): MatchFinder | null {
  let re: RegExp;
  try {
    const flags = 'g' + (caseInsensitive ? 'i' : '');
    re = new RegExp(pattern, flags);
  } catch {
    // 无效正则表达式：返回 null，调用方将跳过注入
    return null;
  }

  return (text: string): MatchRange[] => {
    const matches: MatchRange[] = [];
    re.lastIndex = 0; // 每次搜索前重置，因为 RegExp 对象被复用
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        // 零宽匹配（如 /a*/）：手动递增避免死循环
        re.lastIndex++;
        continue;
      }
      matches.push({ start: m.index, end: m.index + m[0].length });
    }
    return matches;
  };
}

// ============ 核心 HAST 遍历逻辑 ============

/**
 * 递归遍历父节点的子节点列表，对文本节点执行高亮拆分。
 *
 * 修改是就地的（in-place）：直接替换 parent.children 数组中的元素。
 * 从末尾向前遍历（reverse order），避免 splice 导致的索引偏移问题。
 *
 * @param parent - 当前正在处理的父节点
 * @param finder - 匹配查找器，返回文本中所有匹配区间
 */
function walkChildren(parent: HastParent, finder: MatchFinder): void {
  const children = parent.children;

  // 从末尾向前遍历，避免 splice 后索引错位
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];

    // 递归处理元素节点的子节点
    if (child.type === 'element' || child.type === 'root') {
      walkChildren(child as HastParent, finder);
      continue;
    }

    // 仅处理文本节点
    if (child.type !== 'text') continue;

    const text = child.value;
    const matches = finder(text);

    // 无匹配，跳过（快速路径）
    if (matches.length === 0) continue;

    // 根据匹配区间拆分文本节点
    const parts: HastNode[] = [];
    let lastEnd = 0;

    for (const { start, end } of matches) {
      // 匹配前的普通文本
      if (start > lastEnd) {
        parts.push({ type: 'text', value: text.slice(lastEnd, start) });
      }
      // 匹配片段 → <mark class="search-highlight">
      parts.push({
        type: 'element',
        tagName: 'mark',
        properties: { className: 'search-highlight' },
        children: [{ type: 'text', value: text.slice(start, end) }],
      });
      lastEnd = end;
    }

    // 尾部剩余的普通文本
    if (lastEnd < text.length) {
      parts.push({ type: 'text', value: text.slice(lastEnd) });
    }

    // 用拆分后的节点列表替换原文本节点
    if (parts.length > 0) {
      children.splice(i, 1, ...parts);
    }
  }
}

// ============ 插件工厂函数 ============

/**
 * 创建搜索高亮 rehype 插件。
 *
 * 用法：
 * ```tsx
 * const plugins = searchHighlight ? [rehypeHighlight(searchHighlight)] : undefined;
 * <ReactMarkdown rehypePlugins={plugins}>...</ReactMarkdown>
 * ```
 *
 * 当 query 为空或正则表达式无效时，返回空插件（无操作），不会抛出错误。
 *
 * @param highlight - 搜索高亮选项（query、caseSensitive、useRegex）
 * @returns rehype 插件函数（接收 HAST 树，就地修改）
 */
export function rehypeHighlight(highlight: SearchHighlight) {
  const { query, caseSensitive, useRegex } = highlight;

  // 空查询：返回空插件（不修改任何节点）
  if (!query.trim()) {
    return function emptyPlugin() {
      return function noopTransformer(_tree: HastRoot) { /* no-op */ };
    };
  }

  // 根据搜索模式构建 MatchFinder
  let finder: MatchFinder | null;

  if (useRegex) {
    // 正则模式：compile 一次，无效 regex 时静默返回空插件
    finder = createRegexFinder(query, !caseSensitive);
  } else if (caseSensitive) {
    finder = createLiteralSensitiveFinder(query);
  } else {
    finder = createLiteralInsensitiveFinder(query);
  }

  // 无效正则表达式：返回空插件，不抛错
  if (!finder) {
    return function invalidRegexPlugin() {
      return function noopTransformer(_tree: HastRoot) { /* no-op */ };
    };
  }

  const capturedFinder = finder;

  /**
   * rehype 插件入口：接收 HAST 根节点，递归遍历并高亮匹配文本
   */
  return function plugin() {
    return function transformer(tree: HastRoot) {
      walkChildren(tree, capturedFinder);
    };
  };
}
