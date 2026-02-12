/**
 * @file ChatView.tsx - 聊天视图组件
 * @description 负责展示单个会话的完整聊天记录，支持消息浏览、过滤、编辑、删除、
 *              复制和多选批量操作等功能。是应用的核心内容区域，占据主界面的右侧大部分空间。
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import type { SessionMessage, Session } from '../types/claude';
import { getMessageText, formatTimestamp } from '../utils/claudeData';
import { MessageBlockList } from './MessageBlockList';

/**
 * ChatView 组件的属性接口
 */
interface ChatViewProps {
  /** 当前选中的会话对象，为 null 时显示空状态占位界面 */
  session: Session | null;
  /** 当前会话中的所有消息列表 */
  messages: SessionMessage[];
  /** 编辑消息的回调函数，接收消息 UUID 和修改后的内容 */
  onEditMessage: (uuid: string, newContent: string) => void;
  /** 删除消息的回调函数，接收待删除消息的 UUID */
  onDeleteMessage: (uuid: string) => void;
  /** 刷新当前会话数据的回调函数 */
  onRefresh: () => void;
  /** 导出会话的回调函数，接收导出格式 */
  onExport: (format: 'markdown' | 'json') => void;
  /** 多选模式是否开启 */
  selectionMode: boolean;
  /** 当前已选中的消息 UUID 集合 */
  selectedMessages: Set<string>;
  /** 切换单条消息选中状态的回调 */
  onToggleSelect: (uuid: string) => void;
  /** 全选可见消息的回调，接收当前过滤后所有消息的 UUID 数组 */
  onSelectAll: (uuids: string[]) => void;
  /** 取消所有选中的回调 */
  onDeselectAll: () => void;
  /** 批量删除已选消息的回调 */
  onDeleteSelected: () => void;
  /** 切换选择模式开关的回调 */
  onToggleSelectionMode: () => void;
  /** 侧边栏是否处于折叠状态 */
  sidebarCollapsed: boolean;
  /** 展开侧边栏的回调 */
  onExpandSidebar: () => void;
}

/**
 * ChatView - 聊天记录查看与管理组件
 *
 * 提供完整的聊天消息浏览体验，包含以下功能：
 * - 按角色（用户/助手/全部）过滤消息
 * - 内联编辑消息内容
 * - 一键复制消息文本到剪贴板
 * - 删除单条消息
 * - 多选模式：复选框选择、全选/取消全选、批量删除
 * - 自动滚动到最新消息
 * - 显示每条消息的 Token 使用量和模型信息
 *
 * 当没有选中会话时，显示一个引导用户选择会话的空状态界面。
 *
 * @param props - 组件属性
 * @returns JSX 元素
 */
export function ChatView({
  session,
  messages,
  onEditMessage,
  onDeleteMessage,
  onRefresh,
  onExport,
  selectionMode,
  selectedMessages,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onDeleteSelected,
  onToggleSelectionMode,
  sidebarCollapsed,
  onExpandSidebar,
}: ChatViewProps) {
  /** 当前正在编辑的消息 UUID，为 null 表示没有消息处于编辑状态 */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 编辑模式下消息内容的临时存储，保存用户正在修改的文本 */
  const [editContent, setEditContent] = useState('');
  /** 消息过滤器状态：'all' 显示全部，'user' 仅显示用户消息，'assistant' 仅显示助手消息 */
  const [filter, setFilter] = useState<'all' | 'user' | 'assistant'>('all');
  /** 搜索关键词：用于在消息文本中查找匹配内容，空字符串表示不搜索 */
  const [searchQuery, setSearchQuery] = useState('');
  /** 消息列表底部的哨兵元素引用，用于自动滚动定位 */
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** 标记当前会话是否为首次加载消息，首次时使用瞬间跳转而非平滑滚动 */
  const isInitialLoadRef = useRef(true);

  /**
   * 根据当前过滤器和搜索关键词筛选消息列表。
   * 筛选流程：
   * 1. 排除非 user/assistant 类型的系统消息
   * 2. 根据 filter 状态过滤角色
   * 3. 如果有搜索关键词，进一步过滤包含关键词的消息（大小写不敏感）
   */
  const filteredMessages = messages.filter((msg) => {
    if (msg.type !== 'user' && msg.type !== 'assistant') return false;
    if (filter !== 'all' && msg.type !== filter) return false;
    // 搜索关键词过滤：在消息文本中进行大小写不敏感的匹配
    if (searchQuery.trim()) {
      const text = getMessageText(msg).toLowerCase();
      return text.includes(searchQuery.trim().toLowerCase());
    }
    return true;
  });

  /** 过滤前的总消息数（仅 user/assistant 类型），用于显示 "N/M" 计数 */
  const totalMessages = messages.filter(
    (msg) => msg.type === 'user' || msg.type === 'assistant'
  ).length;

  /**
   * 计算当前会话的 Token 使用量汇总。
   * 遍历所有消息的 usage 字段，累加输入/输出/缓存 Token 数。
   * 使用 useMemo 缓存计算结果，仅在 messages 变化时重新计算。
   */
  const tokenStats = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;

    for (const msg of messages) {
      const usage = msg.message?.usage;
      if (usage) {
        inputTokens += usage.input_tokens || 0;
        outputTokens += usage.output_tokens || 0;
        cacheReadTokens += usage.cache_read_input_tokens || 0;
        cacheCreationTokens += usage.cache_creation_input_tokens || 0;
      }
    }

    return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
  }, [messages]);

  /**
   * 滚动到消息列表底部。
   * 根据是否为首次加载选择不同的滚动行为：
   * - 首次加载会话时使用 'instant'（瞬间跳转），避免用户看到从顶部滑到底部的动画
   * - 后续消息更新时使用 'smooth'（平滑滚动），提供流畅的视觉体验
   */
  const scrollToBottom = (instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
  };

  /** 当会话切换时，标记下一次消息变化为首次加载 */
  useEffect(() => {
    isInitialLoadRef.current = true;
  }, [session]);

  /** 当消息列表发生变化时，自动滚动到底部以展示最新消息 */
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom(isInitialLoadRef.current);
      isInitialLoadRef.current = false;
    }
  }, [messages]);

  /**
   * 开始编辑指定消息。
   * 将消息的 UUID 设为当前编辑目标，并将消息文本填充到编辑区域。
   *
   * @param msg - 要编辑的消息对象
   */
  const handleStartEdit = (msg: SessionMessage) => {
    setEditingId(msg.uuid);
    setEditContent(getMessageText(msg));
  };

  /**
   * 保存编辑后的消息内容。
   * 调用父组件的 onEditMessage 回调将修改持久化，然后退出编辑模式。
   */
  const handleSaveEdit = () => {
    if (editingId) {
      onEditMessage(editingId, editContent);
      setEditingId(null);
      setEditContent('');
    }
  };

  /**
   * 取消编辑操作。
   * 清空编辑状态，丢弃所有未保存的修改，恢复消息的只读显示。
   */
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  /**
   * 将指定文本复制到系统剪贴板。
   * 使用 Clipboard API 异步写入文本内容。
   *
   * @param text - 要复制的文本内容
   */
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  /* 空状态：未选择任何会话时显示引导界面 */
  if (!session) {
    return (
      <div className="flex-1 flex flex-col bg-background">
        {/* 侧边栏折叠时在顶部显示展开按钮，否则用户无法恢复侧边栏 */}
        {sidebarCollapsed && (
          <div className="p-2 border-b border-border bg-card">
            <button
              onClick={onExpandSidebar}
              className="p-2 rounded-lg hover:bg-accent transition-colors"
              title="展开侧边栏"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <svg
              className="w-16 h-16 mx-auto mb-4 opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-lg">选择一个会话来查看聊天记录</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* 头部工具栏：显示会话标题、消息计数、过滤器、多选操作、刷新和滚动按钮 */}
      <div className="p-4 border-b border-border flex items-center justify-between bg-card">
        <div className="flex items-center gap-3">
          {/* 侧边栏折叠时显示展开按钮 */}
          {sidebarCollapsed && (
            <button
              onClick={onExpandSidebar}
              className="p-2 rounded-lg hover:bg-accent transition-colors"
              title="展开侧边栏"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            </button>
          )}
          <div>
          <h2 className="text-lg font-semibold text-foreground">
            会话: {session.name || session.id.substring(0, 8)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {formatTimestamp(session.timestamp)} ·{' '}
            {searchQuery.trim() || filter !== 'all'
              ? `显示 ${filteredMessages.length}/${totalMessages} 条消息`
              : `${filteredMessages.length} 条消息`}
            {/* Token 使用量汇总：仅在有统计数据时显示 */}
            {tokenStats.inputTokens + tokenStats.outputTokens > 0 && (
              <span className="ml-2">
                · 输入: {tokenStats.inputTokens.toLocaleString()} · 输出: {tokenStats.outputTokens.toLocaleString()}
                {tokenStats.cacheReadTokens > 0 && ` · 缓存读取: ${tokenStats.cacheReadTokens.toLocaleString()}`}
                {tokenStats.cacheCreationTokens > 0 && ` · 缓存创建: ${tokenStats.cacheCreationTokens.toLocaleString()}`}
              </span>
            )}
          </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 搜索输入框 */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索消息..."
              className="pl-8 pr-3 py-1.5 w-40 rounded-lg bg-secondary text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring text-sm"
            />
            {/* 搜索内容不为空时显示清除按钮 */}
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* 选择模式切换按钮 */}
          <button
            onClick={onToggleSelectionMode}
            className={`p-2 rounded-lg transition-colors ${
              selectionMode ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
            }`}
            title={selectionMode ? '退出选择模式' : '进入选择模式'}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </button>

          {/* 选择模式下的操作按钮组 */}
          {selectionMode && (
            <>
              {/* 全选按钮 */}
              <button
                onClick={() => onSelectAll(filteredMessages.map(m => m.uuid))}
                className="px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors text-sm"
              >
                全选
              </button>
              {/* 取消全选按钮 */}
              <button
                onClick={onDeselectAll}
                className="px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors text-sm"
              >
                取消
              </button>
              {/* 批量删除按钮：显示已选数量，无选中时禁用 */}
              <button
                onClick={onDeleteSelected}
                disabled={selectedMessages.size === 0}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  selectedMessages.size > 0
                    ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                    : 'bg-secondary text-muted-foreground cursor-not-allowed'
                }`}
              >
                删除 ({selectedMessages.size})
              </button>
            </>
          )}

          {/* 消息角色过滤器：下拉选择框，支持全部/仅用户/仅助手 */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | 'user' | 'assistant')}
            className="px-3 py-1.5 rounded-lg bg-secondary text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">全部消息</option>
            <option value="user">仅用户</option>
            <option value="assistant">仅助手</option>
          </select>

          {/* 导出按钮：Markdown */}
          <button
            onClick={() => onExport('markdown')}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title="导出为 Markdown"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>

          {/* 导出按钮：JSON */}
          <button
            onClick={() => onExport('json')}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title="导出为 JSON"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>

          {/* 刷新按钮 */}
          <button
            onClick={onRefresh}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title="刷新"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>

          {/* 滚动到底部 */}
          <button
            onClick={() => scrollToBottom()}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title="滚动到底部"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        </div>
      </div>

      {/* 消息列表：可滚动区域，遍历渲染所有经过过滤的消息 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {filteredMessages.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">没有消息</div>
        ) : (
          filteredMessages.map((msg) => (
            <div
              key={msg.uuid}
              className={`rounded-lg p-4 ${
                msg.type === 'user' ? 'message-user' : 'message-assistant'
              } ${selectionMode && selectedMessages.has(msg.uuid) ? 'ring-2 ring-primary' : ''}`}
              onClick={selectionMode ? () => onToggleSelect(msg.uuid) : undefined}
              style={selectionMode ? { cursor: 'pointer' } : undefined}
            >
              {/* 消息头部：显示复选框（选择模式）、角色标签、时间戳、模型信息和操作按钮 */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {/* 选择模式下显示复选框 */}
                  {selectionMode && (
                    <input
                      type="checkbox"
                      checked={selectedMessages.has(msg.uuid)}
                      onChange={(e) => {
                        e.stopPropagation();
                        onToggleSelect(msg.uuid);
                      }}
                      className="w-4 h-4 rounded border-border accent-primary"
                    />
                  )}
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      msg.type === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground'
                    }`}
                  >
                    {msg.type === 'user' ? '用户' : '助手'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(msg.timestamp)}
                  </span>
                  {msg.message?.model && (
                    <span className="text-xs text-muted-foreground">
                      模型: {msg.message.model}
                    </span>
                  )}
                </div>
                {/* 非选择模式下显示操作按钮 */}
                {!selectionMode && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => copyToClipboard(getMessageText(msg))}
                      className="p-1.5 rounded hover:bg-accent transition-colors"
                      title="复制"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleStartEdit(msg)}
                      className="p-1.5 rounded hover:bg-accent transition-colors"
                      title="编辑"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={() => onDeleteMessage(msg.uuid)}
                      className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
                      title="删除"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                )}
              </div>

              {/* 消息内容：根据是否处于编辑模式显示不同的 UI */}
              {editingId === msg.uuid ? (
                /* 编辑模式：显示可编辑的文本域和保存/取消按钮 */
                <div className="space-y-2">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full p-3 rounded-lg bg-background text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring min-h-[100px] resize-y"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={handleCancelEdit}
                      className="px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      保存
                    </button>
                  </div>
                </div>
              ) : (
                /* 只读模式：通过 MessageBlockList 渲染所有类型的内容块 */
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <MessageBlockList message={msg} />
                </div>
              )}

              {/* Token 使用量：显示本条消息消耗的输入/输出 token 数 */}
              {msg.message?.usage && (
                <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
                  输入: {msg.message.usage.input_tokens} tokens · 输出:{' '}
                  {msg.message.usage.output_tokens} tokens
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
