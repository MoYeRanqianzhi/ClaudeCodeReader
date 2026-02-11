/**
 * @file ChatView.tsx - 聊天视图组件
 * @description 负责展示单个会话的完整聊天记录，支持消息浏览、过滤、编辑、删除和复制等操作。
 *              是应用的核心内容区域，占据主界面的右侧大部分空间。
 */

import { useState, useRef, useEffect } from 'react';
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
}

/**
 * ChatView - 聊天记录查看与管理组件
 *
 * 提供完整的聊天消息浏览体验，包含以下功能：
 * - 按角色（用户/助手/全部）过滤消息
 * - 内联编辑消息内容
 * - 一键复制消息文本到剪贴板
 * - 删除单条消息
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
}: ChatViewProps) {
  /** 当前正在编辑的消息 UUID，为 null 表示没有消息处于编辑状态 */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 编辑模式下消息内容的临时存储，保存用户正在修改的文本 */
  const [editContent, setEditContent] = useState('');
  /** 消息过滤器状态：'all' 显示全部，'user' 仅显示用户消息，'assistant' 仅显示助手消息 */
  const [filter, setFilter] = useState<'all' | 'user' | 'assistant'>('all');
  /** 消息列表底部的哨兵元素引用，用于自动滚动定位 */
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /**
   * 根据当前过滤器筛选消息列表。
   * 首先排除非 user/assistant 类型的系统消息，然后根据 filter 状态进一步过滤。
   */
  const filteredMessages = messages.filter((msg) => {
    if (msg.type !== 'user' && msg.type !== 'assistant') return false;
    if (filter === 'all') return true;
    return msg.type === filter;
  });

  /**
   * 平滑滚动到消息列表底部。
   * 通过 scrollIntoView 将底部哨兵元素滚入可视区域。
   */
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  /** 当消息列表发生变化时，自动滚动到底部以展示最新消息 */
  useEffect(() => {
    scrollToBottom();
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
      <div className="flex-1 flex items-center justify-center bg-background">
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
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* 头部工具栏：显示会话标题、消息计数、过滤器、刷新和滚动按钮 */}
      <div className="p-4 border-b border-border flex items-center justify-between bg-card">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            会话: {session.name || session.id.substring(0, 8)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {formatTimestamp(session.timestamp)} · {filteredMessages.length} 条消息
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            onClick={scrollToBottom}
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
              }`}
            >
              {/* 消息头部：显示角色标签、时间戳、模型信息和操作按钮（复制/编辑/删除） */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
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
