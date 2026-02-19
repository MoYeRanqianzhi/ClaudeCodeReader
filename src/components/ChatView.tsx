/**
 * @file ChatView.tsx - 聊天视图组件
 * @description 负责展示单个会话的完整聊天记录，支持消息浏览、过滤、编辑、删除、
 *              复制和多选批量操作等功能。是应用的核心内容区域，占据主界面的右侧大部分空间。
 *
 *              UI 层采用 motion/react 实现流畅动画效果，使用 lucide-react 图标库
 *              替代内联 SVG，以提升一致性和可维护性。
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronRight, Search, X, CheckSquare, Square, Filter,
  Download, FileText, FileJson, RefreshCw, ArrowDown,
  Copy, Edit2, Trash2, MessageSquare, Bot, User, Lightbulb, Wrench, Archive
} from 'lucide-react';
import type { SessionMessage, Session, DisplayMessage } from '../types/claude';
import { getMessageText, formatTimestamp } from '../utils/claudeData';
import { transformForDisplay } from '../utils/messageTransform';
import { MessageBlockList } from './MessageBlockList';
import { MessageContentRenderer } from './MessageContentRenderer';

/**
 * ChatView 组件的属性接口
 */
interface ChatViewProps {
  /** 当前选中的会话对象，为 null 时显示空状态占位界面 */
  session: Session | null;
  /** 当前会话中的所有消息列表 */
  messages: SessionMessage[];
  /** 当前项目根目录路径，用于工具显示的路径简化 */
  projectPath: string;
  /** 编辑消息的回调函数，接收消息 UUID 和按块索引的编辑列表 */
  onEditMessage: (uuid: string, blockEdits: { index: number; text: string }[]) => void;
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
  projectPath,
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
  /**
   * 编辑模式下各内容块的临时状态。
   * 每个条目记录了原始索引、块类型和用户正在修改的文本内容。
   * 仅包含可编辑的块（text 和 thinking），tool_use/tool_result/image 以只读方式展示。
   */
  const [editBlocks, setEditBlocks] = useState<{ index: number; type: string; text: string }[]>([]);
  /**
   * 正在编辑的消息的原始 UUID（sourceUuid），用于提交编辑时定位原始消息。
   * 与 editingId（displayId）配合使用：editingId 用于 UI 匹配，editingSourceUuid 用于数据操作。
   */
  const [editingSourceUuid, setEditingSourceUuid] = useState<string | null>(null);
  /** 消息过滤器状态：'all' 显示全部，'user' 仅显示用户消息，'assistant' 仅显示助手消息 */
  const [filter, setFilter] = useState<'all' | 'user' | 'assistant'>('all');
  /** 搜索关键词：用于在消息文本中查找匹配内容，空字符串表示不搜索 */
  const [searchQuery, setSearchQuery] = useState('');
  /** 控制过滤器下拉菜单的显示/隐藏状态 */
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  /** 控制导出下拉菜单的显示/隐藏状态 */
  const [showExportDropdown, setShowExportDropdown] = useState(false);

  /**
   * 将原始 SessionMessage[] 预处理为 DisplayMessage[]。
   * - 把 user 消息中的 tool_result 块拆分为独立的虚拟消息
   * - 构建 tool_use_id → ToolUseInfo 映射（用于工具结果标题显示）
   * 仅在 messages 数组引用变化时重新计算。
   */
  const { displayMessages, toolUseMap } = useMemo(
    () => transformForDisplay(messages),
    [messages]
  );

  /** 消息列表底部的哨兵元素引用，用于自动滚动定位 */
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** 标记当前会话是否为首次加载消息，首次时使用瞬间跳转而非平滑滚动 */
  const isInitialLoadRef = useRef(true);
  /** 过滤器下拉菜单容器引用，用于检测外部点击以关闭下拉菜单 */
  const filterRef = useRef<HTMLDivElement>(null);
  /** 导出下拉菜单容器引用，用于检测外部点击以关闭下拉菜单 */
  const exportRef = useRef<HTMLDivElement>(null);

  /**
   * 点击外部区域时自动关闭下拉菜单。
   * 监听全局 mousedown 事件，如果点击目标不在下拉菜单容器内，
   * 则关闭对应的下拉菜单。
   */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      /* 检测过滤器下拉菜单的外部点击 */
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setShowFilterDropdown(false);
      }
      /* 检测导出下拉菜单的外部点击 */
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) {
        setShowExportDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /**
   * 根据当前过滤器和搜索关键词筛选 DisplayMessage 列表。
   * 筛选流程：
   * 1. 根据 filter 状态过滤角色（tool_result 仅在 'all' 模式下显示）
   * 2. 如果有搜索关键词，进一步过滤包含关键词的消息（大小写不敏感）
   */
  const filteredMessages = displayMessages.filter((msg) => {
    /* 过滤器逻辑：'user' 只显示用户消息，'assistant' 只显示助手消息，'all' 显示全部 */
    if (filter === 'user' && msg.displayType !== 'user') return false;
    if (filter === 'assistant' && msg.displayType !== 'assistant') return false;
    // 搜索关键词过滤：在消息文本中进行大小写不敏感的匹配
    if (searchQuery.trim()) {
      const text = getMessageText(msg.rawMessage).toLowerCase();
      return text.includes(searchQuery.trim().toLowerCase());
    }
    return true;
  });

  /** 过滤前的总显示消息数，用于显示 "N/M" 计数 */
  const totalMessages = displayMessages.length;

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
   * 开始编辑指定的显示消息。
   * 从 DisplayMessage 的 content 中提取所有类型的可编辑块，
   * 使用 blockIndexMap 映射回原始消息中的索引。
   *
   * 各块类型的编辑内容：
   * - text: 编辑 text 字段
   * - thinking: 编辑 thinking/text 字段
   * - tool_use: 编辑 input 字段（JSON 格式）
   * - tool_result: 编辑 content 字段（纯文本）
   *
   * @param msg - 要编辑的 DisplayMessage 对象
   */
  const handleStartEdit = (msg: DisplayMessage) => {
    setEditingId(msg.displayId);
    setEditingSourceUuid(msg.sourceUuid);

    // 从 DisplayMessage 的 content 中提取所有可编辑块
    const blocks: { index: number; type: string; text: string }[] = [];
    msg.content.forEach((block, displayIdx) => {
      const originalIndex = msg.blockIndexMap[displayIdx];
      switch (block.type) {
        case 'text':
          blocks.push({ index: originalIndex, type: 'text', text: block.text || '' });
          break;
        case 'thinking':
          blocks.push({ index: originalIndex, type: 'thinking', text: block.thinking || block.text || '' });
          break;
        case 'tool_use':
          // 将 input 对象序列化为格式化 JSON 字符串以便编辑
          blocks.push({
            index: originalIndex,
            type: 'tool_use',
            text: JSON.stringify(block.input || {}, null, 2),
          });
          break;
        case 'tool_result': {
          // 提取 tool_result 的 content 文本
          let resultText = '';
          if (typeof block.content === 'string') {
            resultText = block.content;
          } else if (Array.isArray(block.content)) {
            resultText = (block.content as Array<{ text?: string }>)
              .map(b => b.text || '').join('\n');
          }
          blocks.push({ index: originalIndex, type: 'tool_result', text: resultText });
          break;
        }
        default:
          // image 等其他类型暂不支持编辑，跳过
          break;
      }
    });

    // 如果没有可编辑块，创建一个空的 text 块
    if (blocks.length === 0) {
      blocks.push({ index: -1, type: 'text', text: '' });
    }
    setEditBlocks(blocks);
  };

  /**
   * 保存编辑后的消息内容。
   * 使用 editingSourceUuid（原始消息 UUID）通过 onEditMessage 回调持久化，然后退出编辑模式。
   */
  const handleSaveEdit = () => {
    if (editingId && editingSourceUuid) {
      // 过滤掉新建的块（index === -1 且内容为空）
      const blockEdits = editBlocks
        .filter(b => b.index >= 0)
        .map(b => ({ index: b.index, text: b.text }));
      onEditMessage(editingSourceUuid, blockEdits);
      setEditingId(null);
      setEditingSourceUuid(null);
      setEditBlocks([]);
    }
  };

  /**
   * 取消编辑操作。
   * 清空编辑状态，丢弃所有未保存的修改，恢复消息的只读显示。
   */
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingSourceUuid(null);
    setEditBlocks([]);
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

  /**
   * 获取 DisplayMessage 的文本内容，用于复制到剪贴板。
   * - user/assistant 消息：使用原始消息的文本提取
   * - tool_result 消息：提取工具返回的文本内容
   *
   * @param msg - DisplayMessage 对象
   * @returns 消息的可读文本内容
   */
  const getDisplayText = (msg: DisplayMessage): string => {
    if (msg.displayType !== 'tool_result') {
      return getMessageText(msg.rawMessage);
    }
    // tool_result 消息：提取工具返回的文本
    return msg.content.map(block => {
      if (block.type === 'tool_result') {
        if (typeof block.content === 'string') return block.content;
        if (Array.isArray(block.content)) {
          return (block.content as Array<{ text?: string }>).map(b => b.text || '').join('\n');
        }
      }
      return '';
    }).filter(Boolean).join('\n');
  };

  /* 空状态：未选择任何会话时显示引导界面 */
  if (!session) {
    return (
      <div className="flex-1 flex flex-col bg-background min-w-0">
        {/* 侧边栏折叠时在顶部显示展开按钮，否则用户无法恢复侧边栏 */}
        {sidebarCollapsed && (
          <div className="p-2 border-b border-border bg-card">
            <motion.button
              onClick={onExpandSidebar}
              className="p-2 rounded-lg hover:bg-accent transition-colors"
              title="展开侧边栏"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <ChevronRight className="w-5 h-5" />
            </motion.button>
          </div>
        )}
        {/* 空状态引导：居中显示动画图标和渐变提示文字 */}
        <div className="flex-1 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-muted-foreground"
          >
            {/* 呼吸 + 轻微摇摆动画的聊天气泡图标 */}
            <motion.svg
              animate={{ scale: [1, 1.1, 1], rotate: [0, 5, -5, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
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
            </motion.svg>
            <p className="text-lg gradient-text">选择一个会话来查看聊天记录</p>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0">
      {/* 头部工具栏：显示会话标题、消息计数、过滤器、多选操作、刷新和滚动按钮 */}
      <div className="p-4 border-b border-border flex items-start justify-between gap-4 bg-card shrink-0">
        <div className="flex items-start gap-3 min-w-0 shrink">
          {/* 侧边栏折叠时显示展开按钮 */}
          {sidebarCollapsed && (
            <motion.button
              onClick={onExpandSidebar}
              className="p-2 rounded-lg hover:bg-accent transition-colors shrink-0 mt-0.5"
              title="展开侧边栏"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <ChevronRight className="w-5 h-5" />
            </motion.button>
          )}
          <div className="min-w-[8rem]">
            <h2 className="text-lg font-semibold text-foreground truncate">
              会话: {session.name || session.id.substring(0, 8)}
            </h2>
            <p className="text-sm text-muted-foreground break-words">
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
        <div className="flex items-center gap-2 shrink-0">
          {/* 搜索输入框：带搜索图标和可选的清除按钮 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索消息..."
              className="pl-8 pr-3 py-1.5 w-40 rounded-lg bg-secondary text-foreground border border-border focus:outline-none focus:border-ring text-sm"
            />
            {/* 搜索内容不为空时显示清除按钮 */}
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 选择模式切换按钮：激活时高亮显示 */}
          <motion.button
            onClick={onToggleSelectionMode}
            className={`p-2 rounded-lg transition-colors ${
              selectionMode ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
            }`}
            title={selectionMode ? '退出选择模式' : '进入选择模式'}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <CheckSquare className="w-5 h-5" />
          </motion.button>

          {/* 选择模式下的操作按钮组：全选、取消、批量删除 */}
          <AnimatePresence>
            {selectionMode && (
              <>
                {/* 全选按钮 */}
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => onSelectAll([...new Set(filteredMessages.map(m => m.sourceUuid))])}
                  className="px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors text-sm"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  全选
                </motion.button>
                {/* 取消全选按钮 */}
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={onDeselectAll}
                  className="px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors text-sm"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  取消
                </motion.button>
                {/* 批量删除按钮：显示已选数量，无选中时禁用 */}
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={onDeleteSelected}
                  disabled={selectedMessages.size === 0}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${
                    selectedMessages.size > 0
                      ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                      : 'bg-secondary text-muted-foreground cursor-not-allowed'
                  }`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Trash2 className="w-4 h-4" />
                  删除 ({selectedMessages.size})
                </motion.button>
              </>
            )}
          </AnimatePresence>

          {/* 消息角色过滤器：自定义下拉菜单，替代原生 <select> */}
          <div className="relative" ref={filterRef}>
            <motion.button
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className={`p-2 rounded-lg transition-colors ${
                filter !== 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent'
              }`}
              title="过滤消息"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Filter className="w-5 h-5" />
            </motion.button>
            {/* 过滤器下拉菜单：带动画的选项列表 */}
            <AnimatePresence>
              {showFilterDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-1 w-44 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
                >
                  {/* 全部消息选项 */}
                  <button
                    onClick={() => { setFilter('all'); setShowFilterDropdown(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      filter === 'all' ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span className="flex-1 text-left">全部消息</span>
                    {filter === 'all' && <span className="text-primary">&#10003;</span>}
                  </button>
                  {/* 仅用户消息选项 */}
                  <button
                    onClick={() => { setFilter('user'); setShowFilterDropdown(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      filter === 'user' ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                    }`}
                  >
                    <User className="w-4 h-4" />
                    <span className="flex-1 text-left">仅用户</span>
                    {filter === 'user' && <span className="text-primary">&#10003;</span>}
                  </button>
                  {/* 仅助手消息选项 */}
                  <button
                    onClick={() => { setFilter('assistant'); setShowFilterDropdown(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      filter === 'assistant' ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                    }`}
                  >
                    <Bot className="w-4 h-4" />
                    <span className="flex-1 text-left">仅助手</span>
                    {filter === 'assistant' && <span className="text-primary">&#10003;</span>}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 导出按钮：自定义下拉菜单，统一 Markdown 和 JSON 导出入口 */}
          <div className="relative" ref={exportRef}>
            <motion.button
              onClick={() => setShowExportDropdown(!showExportDropdown)}
              className="p-2 rounded-lg hover:bg-accent transition-colors"
              title="导出会话"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Download className="w-5 h-5" />
            </motion.button>
            {/* 导出下拉菜单：带动画的格式选项列表 */}
            <AnimatePresence>
              {showExportDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-1 w-44 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
                >
                  {/* Markdown 格式导出 */}
                  <button
                    onClick={() => { onExport('markdown'); setShowExportDropdown(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50 transition-colors"
                  >
                    <FileText className="w-4 h-4" />
                    <span>Markdown</span>
                  </button>
                  {/* JSON 格式导出 */}
                  <button
                    onClick={() => { onExport('json'); setShowExportDropdown(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50 transition-colors"
                  >
                    <FileJson className="w-4 h-4" />
                    <span>JSON</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 刷新按钮：悬停时旋转 180 度提供视觉反馈 */}
          <motion.button
            onClick={onRefresh}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title="刷新"
            whileHover={{ scale: 1.05, rotate: 180 }}
            whileTap={{ scale: 0.95 }}
          >
            <RefreshCw className="w-5 h-5" />
          </motion.button>

          {/* 滚动到底部按钮 */}
          <motion.button
            onClick={() => scrollToBottom()}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title="滚动到底部"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <ArrowDown className="w-5 h-5" />
          </motion.button>
        </div>
      </div>

      {/* 消息列表：可滚动区域，遍历渲染所有经过过滤的 DisplayMessage */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 custom-scrollbar">
        {filteredMessages.length === 0 ? (
          /* 空消息列表占位提示 */
          <div className="text-center text-muted-foreground py-8">没有消息</div>
        ) : (
          filteredMessages.map((msg) => (
            <motion.div
              key={msg.displayId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`rounded-xl p-4 message-bubble ${
                msg.displayType === 'user'
                  ? 'bg-primary/5 border border-primary/10'
                  : msg.displayType === 'tool_result'
                    ? 'bg-emerald-500/5 border border-emerald-500/10'
                    : msg.displayType === 'compact_summary'
                      ? 'bg-amber-500/5 border border-amber-500/10'
                      : 'bg-muted/50 border border-border'
              } ${selectionMode && selectedMessages.has(msg.sourceUuid) ? 'ring-2 ring-primary' : ''}`}
              onClick={selectionMode ? () => onToggleSelect(msg.sourceUuid) : undefined}
              style={selectionMode ? { cursor: 'pointer' } : undefined}
            >
              {/* 消息头部：显示复选框（选择模式）、角色标签、时间戳、模型信息和操作按钮 */}
              <div className="flex items-center justify-between mb-2 group">
                <div className="flex items-center gap-2">
                  {/* 选择模式下显示复选框图标 */}
                  {selectionMode && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect(msg.sourceUuid);
                      }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {selectedMessages.has(msg.sourceUuid) ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  {/* 角色徽章：根据 displayType 区分用户/助手/工具结果/压缩摘要 */}
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      msg.displayType === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : msg.displayType === 'tool_result'
                          ? 'bg-emerald-600 text-white'
                          : msg.displayType === 'compact_summary'
                            ? 'bg-amber-500 text-white'
                            : 'bg-secondary text-secondary-foreground'
                    }`}
                  >
                    {msg.displayType === 'user' ? (
                      <User className="w-3 h-3" />
                    ) : msg.displayType === 'tool_result' ? (
                      <Wrench className="w-3 h-3" />
                    ) : msg.displayType === 'compact_summary' ? (
                      <Archive className="w-3 h-3" />
                    ) : (
                      <Bot className="w-3 h-3" />
                    )}
                    {msg.displayType === 'user'
                      ? '用户'
                      : msg.displayType === 'tool_result'
                        ? '工具结果'
                        : msg.displayType === 'compact_summary'
                          ? '压缩'
                          : '助手'}
                  </span>
                  {/* 消息时间戳 */}
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(msg.timestamp)}
                  </span>
                  {/* 模型信息：仅在消息包含模型字段时显示（通常仅 assistant 消息有） */}
                  {msg.rawMessage.message?.model && msg.displayType === 'assistant' && (
                    <span className="text-xs text-muted-foreground">
                      模型: {msg.rawMessage.message.model}
                    </span>
                  )}
                </div>
                {/* 非选择模式下显示操作按钮，鼠标悬停在消息卡片上时才可见 */}
                {!selectionMode && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* 复制按钮 */}
                    <motion.button
                      onClick={() => copyToClipboard(getDisplayText(msg))}
                      className="p-1.5 rounded hover:bg-accent transition-colors"
                      title="复制"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Copy className="w-4 h-4" />
                    </motion.button>
                    {/* 编辑按钮：仅对可编辑消息显示 */}
                    {msg.editable && (
                    <motion.button
                      onClick={() => handleStartEdit(msg)}
                      className="p-1.5 rounded hover:bg-accent transition-colors"
                      title="编辑"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Edit2 className="w-4 h-4" />
                    </motion.button>
                    )}
                    {/* 删除按钮：使用 sourceUuid 删除原始消息 */}
                    <motion.button
                      onClick={() => onDeleteMessage(msg.sourceUuid)}
                      className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
                      title="删除"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </motion.button>
                  </div>
                )}
              </div>

              {/* 消息内容：根据是否处于编辑模式显示不同的 UI */}
              {editingId === msg.displayId ? (
                /* 编辑模式：按内容块类型分别显示对应样式的编辑器 */
                <div className="space-y-2">
                  {editBlocks.map((block, blockIdx) => (
                    <div key={blockIdx}>
                      {block.type === 'thinking' ? (
                        /* 思考块编辑器：保持紫色虚线左边框 + 淡紫色背景的原始样式 */
                        <div className="thinking-block">
                          <div className="flex items-center gap-1 text-xs font-medium mb-2 opacity-70">
                            <Lightbulb className="w-4 h-4 shrink-0" /> 思考过程
                          </div>
                          <textarea
                            value={block.text}
                            onChange={(e) => {
                              const next = [...editBlocks];
                              next[blockIdx] = { ...block, text: e.target.value };
                              setEditBlocks(next);
                            }}
                            className="w-full p-2 rounded bg-transparent text-foreground border border-purple-300/40 dark:border-purple-500/30 focus:outline-none focus:ring-2 focus:ring-purple-400/50 min-h-[80px] resize-y text-sm italic opacity-85"
                          />
                        </div>
                      ) : block.type === 'tool_use' ? (
                        /* 工具调用编辑器：蓝色主题 + 等宽字体，编辑 JSON 格式的 input 参数 */
                        <div className="rounded-lg border border-blue-300/30 dark:border-blue-500/20 bg-blue-50/30 dark:bg-blue-950/20 p-3">
                          <div className="flex items-center gap-1 text-xs font-medium mb-2 text-blue-600 dark:text-blue-400">
                            <Wrench className="w-4 h-4 shrink-0" /> 工具调用参数 (JSON)
                          </div>
                          <textarea
                            value={block.text}
                            onChange={(e) => {
                              const next = [...editBlocks];
                              next[blockIdx] = { ...block, text: e.target.value };
                              setEditBlocks(next);
                            }}
                            className="w-full p-2 rounded bg-transparent text-foreground border border-blue-300/40 dark:border-blue-500/30 focus:outline-none focus:ring-2 focus:ring-blue-400/50 min-h-[80px] resize-y text-sm font-mono"
                          />
                        </div>
                      ) : block.type === 'tool_result' ? (
                        /* 工具结果编辑器：绿色主题，编辑工具返回的文本内容 */
                        <div className="rounded-lg border border-emerald-300/30 dark:border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-950/20 p-3">
                          <div className="flex items-center gap-1 text-xs font-medium mb-2 text-emerald-600 dark:text-emerald-400">
                            <Wrench className="w-4 h-4 shrink-0" /> 工具结果
                          </div>
                          <textarea
                            value={block.text}
                            onChange={(e) => {
                              const next = [...editBlocks];
                              next[blockIdx] = { ...block, text: e.target.value };
                              setEditBlocks(next);
                            }}
                            className="w-full p-2 rounded bg-transparent text-foreground border border-emerald-300/40 dark:border-emerald-500/30 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 min-h-[80px] resize-y text-sm font-mono"
                          />
                        </div>
                      ) : (
                        /* 文本块编辑器：普通样式 */
                        <textarea
                          value={block.text}
                          onChange={(e) => {
                            const next = [...editBlocks];
                            next[blockIdx] = { ...block, text: e.target.value };
                            setEditBlocks(next);
                          }}
                          className="w-full p-3 rounded-lg bg-background text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring min-h-[100px] resize-y"
                        />
                      )}
                    </div>
                  ))}
                  {/* 只读展示不可编辑的内容块（仅 image 等无法文本编辑的类型） */}
                  {msg.content.some(b =>
                    b.type !== 'text' && b.type !== 'thinking' &&
                    b.type !== 'tool_use' && b.type !== 'tool_result'
                  ) && (
                    <div className="prose prose-sm dark:prose-invert max-w-none opacity-60">
                      {msg.content
                        .filter(b =>
                          b.type !== 'text' && b.type !== 'thinking' &&
                          b.type !== 'tool_use' && b.type !== 'tool_result'
                        )
                        .map((block, idx) => (
                          <MessageContentRenderer
                            key={idx}
                            block={block}
                            projectPath={projectPath}
                            toolUseMap={toolUseMap}
                          />
                        ))}
                    </div>
                  )}
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
                  <MessageBlockList message={msg.rawMessage} projectPath={projectPath} toolUseMap={toolUseMap} />
                </div>
              )}

              {/* Token 使用量：仅对 assistant 消息显示本条消息消耗的输入/输出 token 数 */}
              {msg.displayType === 'assistant' && msg.rawMessage.message?.usage && (
                <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
                  输入: {msg.rawMessage.message.usage.input_tokens} tokens · 输出:{' '}
                  {msg.rawMessage.message.usage.output_tokens} tokens
                </div>
              )}
            </motion.div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
