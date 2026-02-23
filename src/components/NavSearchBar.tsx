/**
 * @file NavSearchBar.tsx - VSCode 风格导航搜索栏组件
 * @description 从 ChatView 中提取的独立搜索栏组件。
 *
 * 性能关键设计：
 * - caseSensitive / useRegex / regexError 等状态全部留在本组件内部
 * - 切换 Aa / .* 按钮只触发本组件重渲染（极小），不会导致 ChatView 重渲染
 * - 通过 onSearch 回调将搜索请求传递给 ChatView
 * - 输入框使用非受控模式（defaultValue + ref），打字不触发任何 React re-render
 * - 150ms debounce 合并连续击键，到期后才通过 onSearch 回调通知 ChatView
 */

import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Search, ArrowUp, ArrowDown, X } from 'lucide-react';

// ==================== 类型定义 ====================

/** 搜索选项，传递给 ChatView 的 onSearch 回调 */
export interface SearchRequest {
  /** 搜索关键词 */
  query: string;
  /** 是否大小写敏感 */
  caseSensitive: boolean;
  /** 是否启用正则表达式 */
  useRegex: boolean;
}

/** NavSearchBar 对外暴露的命令式方法 */
export interface NavSearchBarHandle {
  /** 聚焦搜索输入框 */
  focus: () => void;
  /** 清空搜索栏状态（关闭时由 ChatView 调用） */
  reset: () => void;
}

/** NavSearchBar 组件 props */
interface NavSearchBarProps {
  /** 当前可见匹配数量（由 ChatView 计算后传入） */
  matchCount: number;
  /** 当前定位到第几个匹配（0-based，-1 表示无匹配） */
  currentMatchIndex: number;
  /**
   * 搜索请求回调：debounce 到期 / Enter / Aa|.* 切换时调用。
   * query 为空字符串表示清空搜索。
   */
  onSearch: (request: SearchRequest) => void;
  /** 导航到下一个匹配 */
  onNext: () => void;
  /** 导航到上一个匹配 */
  onPrev: () => void;
  /** 关闭搜索栏 */
  onClose: () => void;
}

// ==================== 组件实现 ====================

/**
 * VSCode 风格导航搜索栏。
 *
 * 使用 forwardRef + useImperativeHandle 暴露 focus() 和 reset() 方法，
 * 供 ChatView 在 Ctrl+F / 搜索按钮点击时调用。
 */
export const NavSearchBar = forwardRef<NavSearchBarHandle, NavSearchBarProps>(
  function NavSearchBar({ matchCount, currentMatchIndex, onSearch, onNext, onPrev, onClose }, ref) {

    // ==================== 内部状态 ====================

    /** 是否大小写敏感（Aa 按钮） */
    const [caseSensitive, setCaseSensitive] = useState(false);
    /** 是否启用正则表达式模式（.* 按钮） */
    const [useRegex, setUseRegex] = useState(false);
    /** 正则表达式错误信息（无效 regex 时显示） */
    const [regexError, setRegexError] = useState<string | null>(null);
    /**
     * 是否已提交过搜索（用于控制计数器显示）。
     * 在 debounce 期间不显示"无结果"，只有搜索真正提交后才显示。
     */
    const [hasSubmitted, setHasSubmitted] = useState(false);

    /** 搜索输入框 DOM ref */
    const inputRef = useRef<HTMLInputElement>(null);
    /**
     * 非受控输入的当前值（同步跟踪 DOM input.value）。
     * 打字只更新此 ref，不触发 React re-render。
     */
    const inputValueRef = useRef('');
    /** debounce 定时器引用 */
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /**
     * 最新的 caseSensitive / useRegex 值的 ref 快照。
     * debounce 回调中需要读取最新值，但不能依赖闭包捕获的 state（可能是旧值）。
     */
    const optionsRef = useRef({ caseSensitive: false, useRegex: false });
    optionsRef.current = { caseSensitive, useRegex };

    // ==================== 暴露命令式方法 ====================

    useImperativeHandle(ref, () => ({
      focus: () => {
        requestAnimationFrame(() => inputRef.current?.focus());
      },
      reset: () => {
        setCaseSensitive(false);
        setUseRegex(false);
        setRegexError(null);
        setHasSubmitted(false);
        inputValueRef.current = '';
        if (inputRef.current) {
          inputRef.current.value = '';
        }
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      },
    }), []);

    // ==================== 搜索提交逻辑 ====================

    /**
     * 提交搜索请求到 ChatView。
     * 在提交前进行 regex 前端验证，无效时显示错误并发送空查询清除结果。
     */
    const submitSearch = useCallback((query: string, cs: boolean, re: boolean) => {
      if (re && query.trim()) {
        try {
          new RegExp(query);
          setRegexError(null);
        } catch {
          setRegexError('无效正则表达式');
          onSearch({ query: '', caseSensitive: cs, useRegex: re });
          return;
        }
      } else {
        setRegexError(null);
      }
      setHasSubmitted(query.trim().length > 0);
      onSearch({ query, caseSensitive: cs, useRegex: re });
    }, [onSearch]);

    /**
     * 非受控输入的 onChange 处理器。
     * 打字时仅更新 ref + 重启 debounce 定时器，不调用 setState。
     */
    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      inputValueRef.current = e.target.value;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const opts = optionsRef.current;
        submitSearch(inputValueRef.current, opts.caseSensitive, opts.useRegex);
      }, 150);
    }, [submitSearch]);

    /**
     * 立即提交当前输入值（跳过 debounce）。
     * 用于 Enter 键 / Aa|.* 切换。可通过参数覆盖 caseSensitive / useRegex。
     *
     * 当 defer=true 时，使用 requestAnimationFrame 将 onSearch 推迟到下一帧，
     * 确保按钮视觉状态先渲染到屏幕，再触发可能导致 ChatView 重渲染的搜索回调。
     */
    const commitNow = useCallback((csOverride?: boolean, reOverride?: boolean, defer = false) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const cs = csOverride ?? optionsRef.current.caseSensitive;
      const re = reOverride ?? optionsRef.current.useRegex;
      if (defer) {
        // 推迟到下一帧：当前帧只渲染按钮视觉切换，下一帧再触发搜索
        requestAnimationFrame(() => {
          submitSearch(inputValueRef.current, cs, re);
        });
      } else {
        submitSearch(inputValueRef.current, cs, re);
      }
    }, [submitSearch]);

    /** 组件卸载时清理 debounce 定时器 */
    useEffect(() => {
      return () => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
        }
      };
    }, []);

    // ==================== 渲染 ====================

    return (
      <div className="flex items-center gap-2 px-4 py-2">
        {/* 搜索输入框（Aa / .* 按钮内嵌在右侧，类似 VSCode） */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            defaultValue=""
            onChange={handleChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (timerRef.current !== null) {
                  // 有未提交的 debounce → 立即提交，搜索完成后自动定位到首个结果
                  commitNow();
                } else {
                  // 已同步 → 直接导航到上/下一个匹配
                  if (e.shiftKey) onPrev(); else onNext();
                }
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="搜索消息..."
            className={`w-full pl-8 pr-[4.25rem] py-1.5 rounded-lg bg-secondary text-foreground border focus:outline-none focus:border-ring text-sm ${
              regexError ? 'border-destructive' : 'border-border'
            }`}
          />
          {/* Aa 和 .* 按钮（内嵌在输入框右侧） */}
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            <button
              onClick={() => {
                const newVal = !caseSensitive;
                setCaseSensitive(newVal);
                // defer=true：先渲染按钮状态，下一帧再触发搜索
                commitNow(newVal, undefined, true);
              }}
              className={`px-1 py-0.5 rounded text-xs font-mono leading-none transition-colors ${
                caseSensitive
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-background/80 text-muted-foreground'
              }`}
              title={caseSensitive ? '大小写敏感（点击切换）' : '大小写不敏感（点击切换）'}
              tabIndex={-1}
            >
              Aa
            </button>
            <button
              onClick={() => {
                const newVal = !useRegex;
                setUseRegex(newVal);
                // defer=true：先渲染按钮状态，下一帧再触发搜索
                commitNow(undefined, newVal, true);
              }}
              className={`px-1 py-0.5 rounded text-xs font-mono leading-none transition-colors ${
                useRegex
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-background/80 text-muted-foreground'
              }`}
              title={useRegex ? '正则表达式模式（点击切换）' : '字面量搜索模式（点击切换）'}
              tabIndex={-1}
            >
              .*
            </button>
          </div>
        </div>

        {/* 匹配计数器 / 正则错误提示 */}
        <span className="text-xs whitespace-nowrap min-w-[4rem] text-center">
          {regexError ? (
            <span className="text-destructive">⚠ 无效正则</span>
          ) : hasSubmitted ? (
            matchCount > 0
              ? <span className="text-muted-foreground">{currentMatchIndex + 1}/{matchCount}</span>
              : <span className="text-muted-foreground">无结果</span>
          ) : null}
        </span>

        {/* 上一个匹配 */}
        <button
          onClick={onPrev}
          disabled={matchCount === 0}
          className="p-1.5 rounded-lg hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="上一个匹配 (Shift+Enter)"
        >
          <ArrowUp className="w-4 h-4" />
        </button>

        {/* 下一个匹配 */}
        <button
          onClick={onNext}
          disabled={matchCount === 0}
          className="p-1.5 rounded-lg hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="下一个匹配 (Enter)"
        >
          <ArrowDown className="w-4 h-4" />
        </button>

        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-accent transition-colors"
          title="关闭搜索 (Escape)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  },
);
