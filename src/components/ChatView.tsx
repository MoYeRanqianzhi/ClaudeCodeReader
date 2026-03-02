/**
 * @file ChatView.tsx - 聊天视图组件
 * @description 负责展示单个会话的完整聊天记录，支持消息浏览、过滤、编辑、删除、
 *              复制和多选批量操作等功能。是应用的核心内容区域，占据主界面的右侧大部分空间。
 *
 *              v2.0 重构：
 *              - 移除 transformForDisplay 调用，直接使用 Rust 返回的 TransformedSession
 *              - 移除所有 rawMessage 引用，使用 DisplayMessage 上的直传字段
 *              - 搜索迁移到 Rust 后端（memchr SIMD 加速）
 *              - 多选筛选器（5 种类型 checkbox）
 *              - 视口驱动渐进式渲染（useProgressiveRender）
 *
 *              UI 层采用 motion/react 实现流畅动画效果，使用 lucide-react 图标库
 *              替代内联 SVG，以提升一致性和可维护性。
 */

import React, { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronRight, ChevronDown, ChevronUp, X, CheckSquare, Square, Filter,
  Download, FileText, FileJson, RefreshCw, ArrowLeft, Plus,
  Copy, Edit2, Trash2, Bot, User, Lightbulb, Wrench, Archive, Terminal, ExternalLink, Search
} from 'lucide-react';
import type { Session, Project, DisplayMessage, TransformedSession, ToolUseInfo, SearchHighlight } from '../types/claude';
import { formatTimestamp, searchSession, openResumeTerminal, insertMessage } from '../utils/claudeData';
import { parseJsonlPath } from '../utils/messageTransform';
import { MessageBlockList } from './MessageBlockList';
import { MessageContentRenderer } from './MessageContentRenderer';
import { useProgressiveRender } from '../hooks/useProgressiveRender';
import { useCollapsible } from '../hooks/useCollapsible';
import { NavSearchBar, type SearchRequest, type NavSearchBarHandle } from './NavSearchBar';
import { QuickFixModal } from './QuickFixModal';
import { MessageDropZone, _hoveredAfterUuid, resetHoveredAfterUuid } from './MessageDropZone';

/**
 * 可筛选的消息类型
 */
type FilterableType = 'user' | 'assistant' | 'tool_result' | 'compact_summary' | 'system';

/** 所有筛选类型列表 */
const ALL_FILTERS: FilterableType[] = ['user', 'assistant', 'tool_result', 'compact_summary', 'system'];

/**
 * ChatView 组件的属性接口
 */
interface ChatViewProps {
  /** 当前选中的会话对象，为 null 时显示空状态占位界面 */
  session: Session | null;
  /** Rust 后端返回的转换结果，包含 displayMessages、toolUseMap、tokenStats */
  transformedSession: TransformedSession | null;
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
  /** 所有项目列表，用于计划消息跳转时查找目标会话 */
  projects: Project[];
  /** 导航回退目标：跳转到引用会话后，用于显示悬浮"返回"按钮 */
  navBackTarget: { project: Project; session: Session } | null;
  /** 返回到之前的会话的回调 */
  onNavigateBack: () => void;
  /** 跳转到指定会话的回调（可能跨项目），返回是否成功 */
  onNavigateToSession: (encodedProject: string, sessionId: string) => Promise<boolean>;
}

/** 展开/收起动画的过渡参数 */
const COMPACT_EXPAND_TRANSITION = { duration: 0.25, ease: 'easeInOut' as const };

/**
 * CompactSummaryBlock - 压缩摘要消息的专用渲染组件
 *
 * 以分割线 + 默认折叠的形式展示自动压缩生成的上下文续接消息。
 * 分割线上显示 "--已压缩--" 标签，点击可展开查看完整摘要内容。
 * 使用淡青绿色背景与普通消息区分。
 */
function CompactSummaryBlock({
  msg,
  projectPath,
  toolUseMap,
  searchHighlight,
  searchAutoExpand,
}: {
  msg: DisplayMessage;
  projectPath: string;
  toolUseMap: Record<string, ToolUseInfo>;
  /** 搜索高亮选项，穿透到 MessageBlockList */
  searchHighlight?: SearchHighlight;
  /** 搜索导航自动展开信号：true 时自动展开，false 时自动收起（仅限自动展开的情况） */
  searchAutoExpand?: boolean;
}) {
  const { expanded, handleManualToggle } = useCollapsible(searchAutoExpand);

  return (
    <motion.div
      key={msg.displayId}
      data-flash-target
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* 分割线：--已压缩-- */}
      <div
        className="flex items-center gap-3 cursor-pointer select-none py-1"
        onClick={handleManualToggle}
        title={expanded ? '收起压缩摘要' : '展开压缩摘要'}
      >
        <div className="flex-1 border-t border-teal-400/40" />
        <span className="inline-flex items-center gap-1.5 text-xs text-teal-600 dark:text-teal-400 font-medium">
          <Archive className="w-3 h-3" />
          已压缩
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
        <div className="flex-1 border-t border-teal-400/40" />
      </div>

      {/* 折叠内容区域：展开时带高度动画 */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="compact-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={COMPACT_EXPAND_TRANSITION}
            style={{ overflow: 'hidden' }}
          >
            <div className="rounded-xl p-4 mt-1 bg-teal-500/5 border border-teal-500/10">
              {/* 头部：标签 + 时间戳 */}
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-500 text-white">
                  <Archive className="w-3 h-3" />
                  压缩
                </span>
                {msg.isAbandoned && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                    遗弃
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(msg.timestamp)}
                </span>
              </div>
              {/* 摘要内容 */}
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <MessageBlockList content={msg.content} projectPath={projectPath} toolUseMap={toolUseMap} searchHighlight={searchHighlight} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * SystemMessageBlock - 系统消息的专用渲染组件
 *
 * 以紧凑的折叠卡片形式展示 Claude Code CLI 自动注入的系统消息。
 *
 * 计划消息特殊布局（单一卡片，非两块分离）：
 * - 折叠态：📄 计划 + H1 标题 + [↗ 源会话] + [▼]
 * - 展开态：上方同上 + 分割线 + 纯计划 Markdown（无模板文本）
 *
 * 技能/系统消息保持原有紧凑折叠行为。
 */
function SystemMessageBlock({
  msg,
  projectPath,
  toolUseMap,
  onNavigateToSession,
  searchHighlight,
  searchAutoExpand,
}: {
  msg: DisplayMessage;
  projectPath: string;
  toolUseMap: Record<string, ToolUseInfo>;
  /** 跳转到指定会话的回调 */
  onNavigateToSession: (encodedProject: string, sessionId: string) => Promise<boolean>;
  /** 搜索高亮选项，穿透到 MessageBlockList */
  searchHighlight?: SearchHighlight;
  /** 搜索导航自动展开信号 */
  searchAutoExpand?: boolean;
}) {
  const { expanded, handleManualToggle } = useCollapsible(searchAutoExpand);

  const label = msg.systemLabel || '系统';
  const isPlan = label === '计划';
  const IconComponent = label === '技能' ? Lightbulb : isPlan ? FileText : Terminal;

  /**
   * 计划消息：提取第一个 H1 标题作为折叠态预览
   */
  const planTitle = useMemo(() => {
    if (!isPlan) return null;
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        const match = block.text.match(/^#\s+(.+)$/m);
        if (match) return match[1];
      }
    }
    return null;
  }, [msg.content, isPlan]);

  /**
   * 计划消息：清理内容，剥离固定模板文本 + 过滤空块。
   *
   * 移除：
   * - 头部 "Implement the following plan:\n\n"
   * - 尾部 "If you need specific details ... read the full transcript at: xxx.jsonl"
   * - 清理后为空的文本块
   */
  const cleanedContent = useMemo(() => {
    if (!isPlan) return msg.content;
    return msg.content
      .map(block => {
        if (block.type !== 'text' || !block.text) return block;
        let text = block.text;
        // 移除头部固定模板（兼容可能存在的额外空白）
        text = text.replace(/^Implement the following plan:\s*/i, '');
        // 移除尾部固定模板
        const transcriptIdx = text.lastIndexOf('read the full transcript at:');
        if (transcriptIdx !== -1) {
          let paraStart = text.lastIndexOf('\n\n', transcriptIdx);
          if (paraStart === -1) paraStart = transcriptIdx;
          text = text.substring(0, paraStart);
        }
        text = text.trim();
        return { ...block, text };
      })
      // 过滤掉清理后变空的文本块（避免空白占位）
      .filter(block => !(block.type === 'text' && (!block.text || block.text.trim() === '')));
  }, [msg.content, isPlan]);

  /**
   * 跳转按钮点击：解析路径并导航
   * 直接从 msg.planSourcePath 解析，不依赖 planInfo/planSessionStatus 中间状态
   */
  const handleJumpToSource = useCallback(() => {
    if (!msg.planSourcePath) return;
    const info = parseJsonlPath(msg.planSourcePath);
    if (info) {
      onNavigateToSession(info.encodedProject, info.sessionId);
    }
  }, [msg.planSourcePath, onNavigateToSession]);

  // ==================== 计划消息：单一卡片布局 ====================
  if (isPlan) {
    return (
      <div data-flash-target className="rounded-xl border border-border/50 bg-muted/30 overflow-hidden">
        {/* 头部栏：图标 + 标题 + 跳转按钮 + 展开/收起 */}
        <div
          className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground cursor-pointer
                     hover:bg-muted/50 transition-colors select-none"
          onClick={handleManualToggle}
        >
          <FileText className="w-3.5 h-3.5 shrink-0 text-primary/70" />
          <span className="font-medium shrink-0">计划</span>
          {msg.isAbandoned && (
            <span className="inline-flex items-center px-1.5 py-0 rounded-full text-xs font-medium bg-muted-foreground/15">
              遗弃
            </span>
          )}
          {planTitle && (
            <span className="text-foreground/80 font-medium truncate min-w-0">
              {planTitle}
            </span>
          )}
          {/* 弹簧间距：将后续元素推到右侧 */}
          <div className="flex-1" />
          {/* 跳转按钮（始终可见，只要有 planSourcePath） */}
          {msg.planSourcePath && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleJumpToSource();
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md shrink-0
                         bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-xs font-medium"
              title="跳转到源会话"
            >
              <ExternalLink className="w-3 h-3" />
              源会话
            </button>
          )}
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 shrink-0" />
            : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
        </div>

        {/* 展开区域：分割线 + 计划内容（同一卡片内） */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="plan-content"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={COMPACT_EXPAND_TRANSITION}
              style={{ overflow: 'hidden' }}
            >
              <div className="border-t border-border/50" />
              <div className="px-4 py-3 prose prose-sm dark:prose-invert max-w-none">
                <MessageBlockList content={cleanedContent} projectPath={projectPath} toolUseMap={toolUseMap} searchHighlight={searchHighlight} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ==================== 技能/系统消息：原有紧凑行为 ====================
  return (
    <div data-flash-target>
      <div
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg cursor-pointer select-none
                    bg-muted/40 border border-border/40 hover:bg-muted/60 transition-colors text-xs text-muted-foreground"
        onClick={handleManualToggle}
        title={expanded ? `收起${label}消息` : `展开${label}消息`}
      >
        <IconComponent className="w-3 h-3" />
        <span className="font-medium">{label}</span>
        {msg.isAbandoned && (
          <span className="inline-flex items-center px-1.5 py-0 rounded-full text-xs font-medium bg-muted-foreground/15">
            遗弃
          </span>
        )}
        <span className="opacity-60">{formatTimestamp(msg.timestamp)}</span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="system-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={COMPACT_EXPAND_TRANSITION}
            style={{ overflow: 'hidden' }}
          >
            <div className="rounded-xl p-4 mt-1.5 bg-muted/30 border border-border/50">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <MessageBlockList content={msg.content} projectPath={projectPath} toolUseMap={toolUseMap} searchHighlight={searchHighlight} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ==================== 工具函数（组件外部，可被 MessageItem 引用） ====================

/**
 * 将指定文本复制到系统剪贴板。
 */
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

/**
 * 获取 DisplayMessage 的文本内容，用于复制到剪贴板。
 * 直接从 content 块中提取文本，不依赖 rawMessage。
 */
function getDisplayText(msg: DisplayMessage): string {
  return msg.content.map(block => {
    if (block.type === 'text' && block.text) return block.text;
    if (block.type === 'thinking' && (block.thinking || block.text)) return block.thinking || block.text;
    if (block.type === 'tool_result') {
      if (typeof block.content === 'string') return block.content;
      if (Array.isArray(block.content)) {
        return (block.content as Array<{ text?: string }>).map(b => b.text || '').join('\n');
      }
    }
    return '';
  }).filter(Boolean).join('\n');
}

// ==================== MessageItem：带 memo 的消息渲染组件 ====================

/**
 * MessageItem 属性接口。
 *
 * 关键设计：所有集合判断（Set.has、=== id）在父组件 map 中预计算为 boolean，
 * 确保 memo 浅比较能正确判断 props 是否变化。
 */
interface MessageItemProps {
  /** 消息对象 */
  msg: DisplayMessage;
  /** 在 visibleMessages 中的索引（用于 data-msg-index） */
  index: number;
  /** 是否已渲染完整内容（由 useProgressiveRender 控制） */
  isRendered: boolean;
  /** 项目根目录路径 */
  projectPath: string;
  /** 工具调用映射表 */
  toolUseMap: Record<string, ToolUseInfo>;
  /** 搜索高亮选项（仅匹配消息传入，非匹配传 undefined） */
  searchHighlight?: SearchHighlight;
  /** 是否需要自动展开（搜索导航跳转到此消息时为 true，所有可折叠内容块均响应） */
  searchAutoExpand: boolean;
  /** 是否处于多选模式 */
  selectionMode: boolean;
  /** 此消息是否被选中 */
  isSelected: boolean;
  /** 此消息是否正在编辑 */
  isEditing: boolean;
  /** 编辑状态的块数据（仅 isEditing 时有效） */
  editBlocks: { index: number; type: string; text: string }[];
  /** 切换消息选中状态的回调 */
  onToggleSelect: (uuid: string) => void;
  /** 删除消息的回调 */
  onDeleteMessage: (uuid: string) => void;
  /** 开始编辑消息的回调 */
  onStartEdit: (msg: DisplayMessage) => void;
  /** 保存编辑的回调 */
  onSaveEdit: () => void;
  /** 取消编辑的回调 */
  onCancelEdit: () => void;
  /** 编辑块数据变更回调（直接传 setEditBlocks） */
  onEditBlockChange: (blocks: { index: number; type: string; text: string }[]) => void;
  /** 跳转到指定会话的回调（system 消息的计划跳转使用） */
  onNavigateToSession: (encodedProject: string, sessionId: string) => Promise<boolean>;
}

/**
 * 自定义 memo 比较器：只比较数据 props，忽略函数 props。
 *
 * 函数 props（onToggleSelect、onDeleteMessage 等）的引用可能因父组件 re-render 而变化，
 * 但其行为不变。忽略它们可避免因引用不稳定导致的无效重渲染。
 * editBlocks 仅在 isEditing 为 true 时才需要比较。
 */
function messageItemAreEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  return prev.msg === next.msg
    && prev.index === next.index
    && prev.isRendered === next.isRendered
    && prev.projectPath === next.projectPath
    && prev.toolUseMap === next.toolUseMap
    && prev.searchHighlight === next.searchHighlight
    && prev.searchAutoExpand === next.searchAutoExpand
    && prev.selectionMode === next.selectionMode
    && prev.isSelected === next.isSelected
    && prev.isEditing === next.isEditing
    && (!next.isEditing || prev.editBlocks === next.editBlocks);
}

/**
 * MessageItem - 单条消息的 memo 渲染组件。
 *
 * 每条消息独立 memo：ChatView 中任何 state 变化触发 map 重新执行时，
 * 只有 props 实际变化的消息会重渲染。搜索导航场景下，
 * 300+ 条消息中通常只有 0~2 条的 searchAutoExpand 变化，
 * 其余全部被 memo 跳过，将重渲染耗时从秒级降至 ~50ms。
 */
const MessageItem = memo(function MessageItem({
  msg,
  index,
  isRendered,
  projectPath,
  toolUseMap,
  searchHighlight,
  searchAutoExpand,
  selectionMode,
  isSelected,
  isEditing,
  editBlocks,
  onToggleSelect,
  onDeleteMessage,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditBlockChange,
  onNavigateToSession,
}: MessageItemProps) {
  return (
    <div
      data-msg-index={index}
      className={
        /* 入场动画仅对普通消息生效（compact_summary 使用 framer-motion，system 不需要动画）。
         * 关键：animate-msg-in 必须放在 wrapper 上而非 data-flash-target 上，
         * 因为两者都设置 CSS animation 简写属性，放在同一元素会导致 search-flash
         * 被移除时 msg-in 动画重启（opacity: 0→1），产生视觉闪烁。 */
        msg.displayType !== 'compact_summary' && msg.displayType !== 'system'
          ? 'animate-msg-in'
          : undefined
      }
    >
      {isRendered ? (
        /* ====== 已渲染：完整消息内容 ====== */
        msg.displayType === 'compact_summary' ? (
          <CompactSummaryBlock
            msg={msg}
            projectPath={projectPath}
            toolUseMap={toolUseMap}
            searchHighlight={searchHighlight}
            searchAutoExpand={searchAutoExpand}
          />
        ) :
        msg.displayType === 'system' ? (
          <SystemMessageBlock
            msg={msg}
            projectPath={projectPath}
            toolUseMap={toolUseMap}
            onNavigateToSession={onNavigateToSession}
            searchHighlight={searchHighlight}
            searchAutoExpand={searchAutoExpand}
          />
        ) :
        <div
          data-flash-target
          className={`rounded-xl p-4 message-bubble ${
            msg.displayType === 'user'
              ? 'bg-primary/5 border border-primary/10'
              : msg.displayType === 'tool_result'
                ? 'bg-emerald-500/5 border border-emerald-500/10'
                : 'bg-muted/50 border border-border'
          } ${isSelected ? 'ring-2 ring-primary' : ''}`}
          onClick={selectionMode ? () => onToggleSelect(msg.sourceUuid) : undefined}
          style={selectionMode ? { cursor: 'pointer' } : undefined}
        >
          {/* 消息头部 */}
          <div className="flex items-center justify-between mb-2 group">
            <div className="flex items-center gap-2">
              {selectionMode && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelect(msg.sourceUuid);
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isSelected ? (
                    <CheckSquare className="w-4 h-4 text-primary" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
              )}
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  msg.displayType === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : msg.displayType === 'tool_result'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-secondary text-secondary-foreground'
                }`}
              >
                {msg.displayType === 'user' ? (
                  <User className="w-3 h-3" />
                ) : msg.displayType === 'tool_result' ? (
                  <Wrench className="w-3 h-3" />
                ) : (
                  <Bot className="w-3 h-3" />
                )}
                {msg.displayType === 'user'
                  ? '用户'
                  : msg.displayType === 'tool_result'
                    ? '工具结果'
                    : '助手'}
              </span>
              {/* 遗弃标签：不在主链上的消息 */}
              {msg.isAbandoned && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                  遗弃
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {formatTimestamp(msg.timestamp)}
              </span>
              {/* 模型信息：直接从 DisplayMessage 字段获取 */}
              {msg.model && msg.displayType === 'assistant' && (
                <span className="text-xs text-muted-foreground">
                  模型: {msg.model}
                </span>
              )}
            </div>
            {!selectionMode && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => copyToClipboard(getDisplayText(msg))}
                  className="p-1.5 rounded hover:bg-accent transition-all hover:scale-110 active:scale-90"
                  title="复制"
                >
                  <Copy className="w-4 h-4" />
                </button>
                {msg.editable && (
                <button
                  onClick={() => onStartEdit(msg)}
                  className="p-1.5 rounded hover:bg-accent transition-all hover:scale-110 active:scale-90"
                  title="编辑"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                )}
                <button
                  onClick={() => onDeleteMessage(msg.sourceUuid)}
                  className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-all hover:scale-110 active:scale-90"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* 消息内容 */}
          {isEditing ? (
            <div className="space-y-2">
              {editBlocks.map((block, blockIdx) => (
                <div key={blockIdx}>
                  {block.type === 'thinking' ? (
                    <div className="thinking-block">
                      <div className="flex items-center gap-1 text-xs font-medium mb-2 opacity-70">
                        <Lightbulb className="w-4 h-4 shrink-0" /> 思考过程
                      </div>
                      <textarea
                        value={block.text}
                        onChange={(e) => {
                          const next = [...editBlocks];
                          next[blockIdx] = { ...block, text: e.target.value };
                          onEditBlockChange(next);
                        }}
                        className="w-full p-2 rounded bg-transparent text-foreground border border-purple-300/40 dark:border-purple-500/30 focus:outline-none focus:ring-2 focus:ring-purple-400/50 min-h-[80px] resize-y text-sm italic opacity-85"
                      />
                    </div>
                  ) : block.type === 'tool_use' ? (
                    <div className="rounded-lg border border-blue-300/30 dark:border-blue-500/20 bg-blue-50/30 dark:bg-blue-950/20 p-3">
                      <div className="flex items-center gap-1 text-xs font-medium mb-2 text-blue-600 dark:text-blue-400">
                        <Wrench className="w-4 h-4 shrink-0" /> 工具调用参数 (JSON)
                      </div>
                      <textarea
                        value={block.text}
                        onChange={(e) => {
                          const next = [...editBlocks];
                          next[blockIdx] = { ...block, text: e.target.value };
                          onEditBlockChange(next);
                        }}
                        className="w-full p-2 rounded bg-transparent text-foreground border border-blue-300/40 dark:border-blue-500/30 focus:outline-none focus:ring-2 focus:ring-blue-400/50 min-h-[80px] resize-y text-sm font-mono"
                      />
                    </div>
                  ) : block.type === 'tool_result' ? (
                    <div className="rounded-lg border border-emerald-300/30 dark:border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-950/20 p-3">
                      <div className="flex items-center gap-1 text-xs font-medium mb-2 text-emerald-600 dark:text-emerald-400">
                        <Wrench className="w-4 h-4 shrink-0" /> 工具结果
                      </div>
                      <textarea
                        value={block.text}
                        onChange={(e) => {
                          const next = [...editBlocks];
                          next[blockIdx] = { ...block, text: e.target.value };
                          onEditBlockChange(next);
                        }}
                        className="w-full p-2 rounded bg-transparent text-foreground border border-emerald-300/40 dark:border-emerald-500/30 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 min-h-[80px] resize-y text-sm font-mono"
                      />
                    </div>
                  ) : (
                    <textarea
                      value={block.text}
                      onChange={(e) => {
                        const next = [...editBlocks];
                        next[blockIdx] = { ...block, text: e.target.value };
                        onEditBlockChange(next);
                      }}
                      className="w-full p-3 rounded-lg bg-background text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring min-h-[100px] resize-y"
                    />
                  )}
                </div>
              ))}
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
                  onClick={onCancelEdit}
                  className="px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={onSaveEdit}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <MessageBlockList
                content={msg.content}
                projectPath={projectPath}
                toolUseMap={toolUseMap}
                searchHighlight={searchHighlight}
                searchAutoExpand={searchAutoExpand}
              />
            </div>
          )}

          {/* Token 使用量：直接从 DisplayMessage 字段获取 */}
          {msg.displayType === 'assistant' && msg.usage && (
            <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
              输入: {msg.usage.input_tokens} tokens · 输出:{' '}
              {msg.usage.output_tokens} tokens
            </div>
          )}
        </div>
      ) : (
        /* ====== 未渲染：轻量占位符（固定高度，确保 scrollHeight 稳定） ====== */
        <div className="h-[60px]" />
      )}
    </div>
  );
}, messageItemAreEqual);

/**
 * 筛选器配置项：类型 → 图标 + 标签
 */
const FILTER_CONFIG: { type: FilterableType; icon: typeof User; label: string }[] = [
  { type: 'user', icon: User, label: '用户消息' },
  { type: 'assistant', icon: Bot, label: '助手消息' },
  { type: 'tool_result', icon: Wrench, label: '工具结果' },
  { type: 'compact_summary', icon: Archive, label: '压缩摘要' },
  { type: 'system', icon: Terminal, label: '系统消息' },
];

/**
 * ChatView - 聊天记录查看与管理组件
 *
 * 提供完整的聊天消息浏览体验，包含以下功能：
 * - 按类型（5 种 checkbox 多选）过滤消息
 * - 后端搜索（debounce 300ms → Rust SIMD 加速）
 * - 视口驱动渐进式渲染（先渲染可视区域，空闲时向外扩散）
 * - 内联编辑消息内容
 * - 一键复制消息文本到剪贴板
 * - 删除单条消息
 * - 多选模式：复选框选择、全选/取消全选、批量删除
 * - 显示每条消息的 Token 使用量和模型信息
 *
 * 当没有选中会话时，显示一个引导用户选择会话的空状态界面。
 *
 * @param props - 组件属性
 * @returns JSX 元素
 */

/**
 * 模块级拖拽标志位
 *
 * 用于在 onDrop 处理器中识别当前拖拽是否来自"添加消息"按钮。
 * 使用模块级变量（而非 React state）的原因：
 *
 * 1. **避免 dataTransfer.getData() 在 WebView2 中可能返回空值的问题**
 *    HTML5 DnD 规范中 dataTransfer 在不同事件阶段有不同的访问权限，
 *    某些 WebView2 + Tauri 配置下 getData() 可能返回空字符串。
 *
 * 2. **避免 React state 闭包/批处理竞态**
 *    模块级变量是同步的，不受 React 事件批处理、useCallback 闭包捕获
 *    或 onDragEnd/onDrop 事件顺序的影响。
 */
let _addMessageDragActive = false;
export function ChatView({
  session,
  transformedSession,
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
  // projects 保留在接口中但组件内不再直接使用（跳转按钮改为延迟解析路径）
  projects: _projects,
  navBackTarget,
  onNavigateBack,
  onNavigateToSession,
}: ChatViewProps) {
  /** 当前正在编辑的消息 displayId，为 null 表示没有消息处于编辑状态 */
  const [editingId, setEditingId] = useState<string | null>(null);
  /**
   * 编辑模式下各内容块的临时状态。
   * 每个条目记录了原始索引、块类型和用户正在修改的文本内容。
   */
  const [editBlocks, setEditBlocks] = useState<{ index: number; type: string; text: string }[]>([]);
  /**
   * 正在编辑的消息的原始 UUID（sourceUuid），用于提交编辑时定位原始消息。
   */
  const [editingSourceUuid, setEditingSourceUuid] = useState<string | null>(null);
  /** 内容筛选搜索关键词（位于筛选器下拉菜单内），debounce 300ms 发送到 Rust 后端 */
  const [filterSearchQuery, setFilterSearchQuery] = useState('');
  /** 内容筛选后端搜索结果：匹配的 display_id 集合。null 表示无搜索 */
  const [filterSearchResults, setFilterSearchResults] = useState<Set<string> | null>(null);
  /** 多选筛选器激活状态 */
  const [activeFilters, setActiveFilters] = useState<Set<FilterableType>>(new Set(ALL_FILTERS));
  /** 控制过滤器下拉菜单的显示/隐藏状态 */
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  /** 控制导出下拉菜单的显示/隐藏状态 */
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  /** 控制实用工具下拉菜单的显示/隐藏状态 */
  const [showToolsDropdown, setShowToolsDropdown] = useState(false);
  /** 控制一键修复弹窗的显示/隐藏状态 */
  const [showQuickFix, setShowQuickFix] = useState(false);

  // ==================== 拖拽添加消息状态 ====================
  /** 是否正在拖拽 Add 图标（全局拖拽状态，传递给所有 MessageDropZone） */
  const [isDraggingAdd, setIsDraggingAdd] = useState(false);
  /** 正在编辑的新消息插入位置（对应 afterUuid，null 表示未在插入） */
  const [insertingAfterUuid, setInsertingAfterUuid] = useState<string | null>(null);
  /** 内联编辑器阶段：'select' = 类型选择，'edit' = 内容编辑 */
  const [insertPhase, setInsertPhase] = useState<'select' | 'edit'>('select');
  /** 内联编辑器：用户选定的消息类型 */
  const [insertType, setInsertType] = useState<string | null>(null);
  /** 内联编辑器：编辑内容 */
  const [insertContent, setInsertContent] = useState('');
  /** 内联编辑器：保存中标志 */
  const [insertSaving, setInsertSaving] = useState(false);

  // ==================== VSCode 风格导航搜索状态 ====================
  /** 导航搜索栏是否打开 */
  const [navSearchOpen, setNavSearchOpen] = useState(false);
  /**
   * 导航搜索原始结果集（Rust 后端返回的匹配 displayId 集合）。
   * 与 navSearchMatchIds 分离实现 stale-while-revalidate：
   * visibleMessages 因筛选变化时直接重新排序，无需再次调用 Rust。
   */
  const [navSearchResultSet, setNavSearchResultSet] = useState<Set<string>>(new Set());
  /** 当前定位到第几个匹配（-1 表示无匹配） */
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  /**
   * 闪烁动画清理函数 ref。
   * 闪烁通过直接 DOM 操作（classList.add/remove）实现，
   * 完全脱离 React 渲染周期，避免重渲染重启 CSS 动画。
   */
  const flashCleanupRef = useRef<(() => void) | null>(null);
  /** NavSearchBar 组件的命令式引用（focus / reset） */
  const navSearchBarRef = useRef<NavSearchBarHandle>(null);
  /**
   * 搜索高亮选项（仅在 Rust 搜索完成后更新，不随每次击键变化）。
   *
   * 将 searchHighlight 作为 state 而非 derived value 是性能关键：
   * searchHighlight 保持 undefined → React.memo 跳过所有消息子树的重渲染。
   * 只有 Rust 搜索完成后才设置新的 searchHighlight 触发高亮渲染。
   */
  const [searchHighlight, setSearchHighlight] = useState<SearchHighlight | undefined>(undefined);

  // 直接使用 Rust 返回的数据
  const displayMessages = transformedSession?.displayMessages ?? [];
  const toolUseMap = transformedSession?.toolUseMap ?? {};
  const tokenStats = transformedSession?.tokenStats;

  /** 过滤器下拉菜单容器引用，用于检测外部点击以关闭下拉菜单 */
  const filterRef = useRef<HTMLDivElement>(null);
  /** 导出下拉菜单容器引用，用于检测外部点击以关闭下拉菜单 */
  const exportRef = useRef<HTMLDivElement>(null);
  /** 实用工具下拉菜单容器引用，用于检测外部点击以关闭下拉菜单 */
  const toolsRef = useRef<HTMLDivElement>(null);
  /** 消息列表滚动容器引用 */
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  /**
   * 点击外部区域时自动关闭下拉菜单。
   */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setShowFilterDropdown(false);
      }
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) {
        setShowExportDropdown(false);
      }
      if (toolsRef.current && !toolsRef.current.contains(event.target as Node)) {
        setShowToolsDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /**
   * 内容筛选后端搜索：debounce 300ms，调用 Rust SIMD 搜索
   */
  useEffect(() => {
    if (!filterSearchQuery.trim() || !session) {
      setFilterSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const ids = await searchSession(session.filePath, filterSearchQuery);
        setFilterSearchResults(new Set(ids));
      } catch (err) {
        console.error('搜索失败:', err);
        setFilterSearchResults(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [filterSearchQuery, session]);

  /**
   * 组合筛选：类型多选 + 后端搜索结果交叉
   *
   * displayMessages 保持原始时间顺序（旧→新），前端通过 useProgressiveRender 实现视口优先加载。
   */
  const visibleMessages = useMemo(() => {
    return displayMessages.filter(msg => {
      // 类型筛选
      if (!activeFilters.has(msg.displayType as FilterableType)) return false;
      // 内容筛选搜索结果
      if (filterSearchResults !== null && !filterSearchResults.has(msg.displayId)) return false;
      return true;
    });
  }, [displayMessages, activeFilters, filterSearchResults]);

  /** 过滤前的总显示消息数，用于显示 "N/M" 计数 */
  const totalMessages = displayMessages.length;

  /**
   * 导航搜索匹配 ID 有序列表（按 visibleMessages 顺序，由 navSearchResultSet 派生）
   *
   * Stale-while-revalidate：visibleMessages 因筛选变化时，直接重排序展示已有结果，
   * 不需要重新调用 Rust 搜索。只有 navSearchResultSet 变化（新 query）才触发 Rust 调用。
   */
  const navSearchMatchIds = useMemo(() => {
    if (!navSearchResultSet.size) return [];
    return visibleMessages
      .filter(msg => navSearchResultSet.has(msg.displayId))
      .map(msg => msg.displayId);
  }, [navSearchResultSet, visibleMessages]);

  /**
   * 搜索导航自动展开的消息 displayId（派生值，非 state）。
   *
   * 从 currentMatchIndex 同步派生，避免额外的 setState 导致二次重渲染。
   * 当搜索导航跳转到任意消息时返回其 displayId，用于触发该消息内部
   * 所有可折叠组件（compact_summary、system、thinking、tool_use、tool_result）的自动展开。
   */
  const searchAutoExpandId = useMemo(() => {
    if (currentMatchIndex < 0 || currentMatchIndex >= navSearchMatchIds.length) return null;
    return navSearchMatchIds[currentMatchIndex];
  }, [currentMatchIndex, navSearchMatchIds]);

  /**
   * 渐进式渲染：视口驱动，先渲染可视区域，空闲时向外扩散。
   * isRendered(index) 判断 visibleMessages[index] 是否应渲染完整内容。
   * handleScrollForRender 绑定到滚动容器的 onScroll。
   * scrollToBottom 在初始渲染完成后调用。
   */
  const { isRendered, handleScroll: handleScrollForRender, scrollToBottom, forceRenderIndex } = useProgressiveRender(
    visibleMessages.length,
    scrollContainerRef,
  );

  /** 记录上一个会话的文件路径，用于判断是否切换了会话 */
  const prevSessionPathRef = useRef<string | null>(null);

  /**
   * 仅在切换到不同会话时自动滚动到底部。
   * 同一会话的数据更新（编辑保存、手动刷新）不触发滚动，保持用户当前阅读位置。
   *
   * 使用 setTimeout(0) 延迟调用 scrollToBottom：
   * useProgressiveRender 在 totalCount 变化时通过 setVersion() 触发重渲染，
   * 但该 version bump 与本 effect 在同一个 React 渲染周期内运行。
   * 如果立即调用 scrollToBottom，其 rAF 轮询会在初始批次消息渲染到 DOM 之前开始，
   * 导致 scrollHeight 在占位符阶段就被误判为"稳定"，过早执行滚动。
   * setTimeout(0) 将调用推迟到 React 处理完 version bump 重渲染之后。
   */
  useEffect(() => {
    if (transformedSession && session) {
      if (prevSessionPathRef.current !== session.filePath) {
        prevSessionPathRef.current = session.filePath;
        setTimeout(() => scrollToBottom(), 0);
      }
    } else if (!session) {
      prevSessionPathRef.current = null;
    }
  }, [transformedSession, session, scrollToBottom]);

  /**
   * 切换单个筛选器
   */
  const toggleFilter = useCallback((type: FilterableType) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  /**
   * 全选/取消全选筛选器
   */
  const toggleAllFilters = useCallback(() => {
    setActiveFilters(prev => {
      if (prev.size === ALL_FILTERS.length) {
        // 当前全选 → 取消全选
        return new Set<FilterableType>();
      } else {
        // 当前非全选 → 全选
        return new Set(ALL_FILTERS);
      }
    });
  }, []);

  // ==================== VSCode 风格导航搜索逻辑 ====================

  /**
   * NavSearchBar 的搜索请求回调。
   *
   * 由 NavSearchBar 在 debounce 到期 / Enter / Aa|.* 切换时调用。
   * 负责调用 Rust 后端搜索并更新 ChatView 的搜索结果状态。
   *
   * 使用 ref 存储最新请求 ID 实现 stale-while-revalidate：
   * 新请求到来时递增 ID，异步返回后检查 ID 是否仍为最新，
   * 过期的结果直接丢弃。
   */
  const searchRequestIdRef = useRef(0);
  const handleNavSearch = useCallback(async (request: SearchRequest) => {
    const { query, caseSensitive, useRegex } = request;

    // 空查询：清空所有搜索状态
    if (!query.trim() || !session) {
      searchRequestIdRef.current++;
      setNavSearchResultSet(new Set());
      setCurrentMatchIndex(-1);
      setSearchHighlight(undefined);
      return;
    }

    // ⚠ 不在此处同步调用 setSearchHighlight(undefined)！
    // 原因：handleNavSearch 是从 NavSearchBar 的 onClick 同步调用的，
    // 任何 ChatView setState 都会被 React 18 批处理到同一次渲染，
    // 导致 ChatView 在按钮点击时立即重渲染数百条消息 → 1s+ 延迟。
    //
    // 采用 stale-while-revalidate：旧高亮保留到 Rust 返回新结果后一次性替换。
    // 用户感知：按钮视觉即时切换，高亮在 ~50ms 后更新（Rust 搜索耗时）。

    // 递增请求 ID，用于丢弃 stale 结果
    const requestId = ++searchRequestIdRef.current;

    try {
      const ids = await searchSession(session.filePath, query, {
        caseSensitive,
        useRegex,
      });
      // 异步返回后检查是否已被更新的请求取代
      if (requestId !== searchRequestIdRef.current) return;
      const resultSet = new Set(ids);
      // 原子性同时更新结果集 + 高亮选项（React 18 自动批处理）
      setNavSearchResultSet(resultSet);
      setSearchHighlight(
        resultSet.size > 0
          ? { query, caseSensitive, useRegex }
          : undefined,
      );
    } catch (err) {
      if (requestId !== searchRequestIdRef.current) return;
      console.error('导航搜索失败:', err);
      setNavSearchResultSet(new Set());
      setSearchHighlight(undefined);
    }
  }, [session]);

  /**
   * 当搜索结果集变化时，重置导航到第一个匹配项。
   * （切换大小写/正则选项、输入新词后的首次定位）
   */
  useEffect(() => {
    if (navSearchResultSet.size === 0) {
      setCurrentMatchIndex(-1);
    } else {
      setCurrentMatchIndex(0);
    }
  }, [navSearchResultSet]);

  /**
   * 导航到下一个匹配项（循环）
   */
  const navSearchNext = useCallback(() => {
    if (navSearchMatchIds.length === 0) return;
    setCurrentMatchIndex(prev => (prev + 1) % navSearchMatchIds.length);
  }, [navSearchMatchIds.length]);

  /**
   * 导航到上一个匹配项（循环）
   */
  const navSearchPrev = useCallback(() => {
    if (navSearchMatchIds.length === 0) return;
    setCurrentMatchIndex(prev => (prev - 1 + navSearchMatchIds.length) % navSearchMatchIds.length);
  }, [navSearchMatchIds.length]);

  /**
   * 关闭导航搜索：清空 ChatView 搜索状态 + 重置 NavSearchBar 内部状态
   */
  const closeNavSearch = useCallback(() => {
    setNavSearchOpen(false);
    searchRequestIdRef.current++;
    setNavSearchResultSet(new Set());
    setCurrentMatchIndex(-1);
    // 清除闪烁动画（直接 DOM 操作）
    if (flashCleanupRef.current) {
      flashCleanupRef.current();
      flashCleanupRef.current = null;
    }
    // searchAutoExpandId 是 useMemo 派生值，currentMatchIndex=-1 时自动为 null
    setSearchHighlight(undefined);
    navSearchBarRef.current?.reset();
  }, []);

  /**
   * 导航跳转 + 闪烁效果：
   * currentMatchIndex 变化时，自动滚动到目标消息并触发闪烁动画。
   *
   * 自动展开由 searchAutoExpandId（useMemo 派生值）驱动，无需在此 effect 中处理。
   * 闪烁动画使用直接 DOM 操作（classList.add/remove），
   * 完全脱离 React 渲染周期，避免 setState 触发重渲染导致 CSS 动画重启。
   */
  useEffect(() => {
    // 先清理上一次的闪烁
    if (flashCleanupRef.current) {
      flashCleanupRef.current();
      flashCleanupRef.current = null;
    }

    if (currentMatchIndex < 0 || currentMatchIndex >= navSearchMatchIds.length) {
      return;
    }
    const targetDisplayId = navSearchMatchIds[currentMatchIndex];
    const targetMsg = visibleMessages.find(msg => msg.displayId === targetDisplayId);
    if (!targetMsg) return;
    const targetIdx = visibleMessages.indexOf(targetMsg);

    // 1. 确保目标消息已渲染
    forceRenderIndex(targetIdx);

    // 2. 判断是否为消息级折叠类型（compact_summary / system 整体折叠，展开动画较长）
    // 或内容块级折叠类型（thinking / tool_use / tool_result 内部折叠，展开较快）
    const isMsgLevelCollapsible = targetMsg.displayType === 'compact_summary' || targetMsg.displayType === 'system';
    // 内容块级折叠：消息内含有 thinking / tool_use / tool_result 块
    const hasBlockLevelCollapsible = !isMsgLevelCollapsible && targetMsg.content.some(
      b => b.type === 'thinking' || b.type === 'tool_use' || b.type === 'tool_result'
    );

    // 3. 滚动 + 闪烁（直接 DOM 操作，不触发 React 重渲染）
    const doScrollAndFlash = () => {
      const wrapper = scrollContainerRef.current?.querySelector(`[data-msg-index="${targetIdx}"]`);
      if (!wrapper) return;

      // 优先定位到消息内部的搜索高亮标记（展开后匹配文本可能在折叠内容深处）。
      // 如果没有高亮标记（例如匹配在 Markdown 渲染前的原始文本中），回退到消息 wrapper。
      const highlightMark = wrapper.querySelector('mark.search-highlight') as HTMLElement | null;
      const scrollTarget = highlightMark ?? wrapper as HTMLElement;

      // 瞬间定位到目标（不使用 smooth，避免滚动期间闪烁动画已经开始播放）
      // 搜索导航应该是即时跳转，与 VS Code Ctrl+F 行为一致
      scrollTarget.scrollIntoView({ behavior: 'instant', block: 'center' });

      // 查找闪烁目标元素：优先找内部带 data-flash-target 的元素，否则用 wrapper 自身
      const flashTarget = wrapper.querySelector('[data-flash-target]') as HTMLElement | null ?? wrapper as HTMLElement;

      // 直接 DOM 操作添加闪烁 class
      flashTarget.classList.remove('search-flash');
      // 强制浏览器 reflow，确保移除后重新添加能重启动画
      void flashTarget.offsetWidth;
      flashTarget.classList.add('search-flash');

      // 使用 setTimeout 而非 animationend 清除 class。
      // 原因：animationend 会被子元素的 animate-msg-in 等动画冒泡触发，
      // 即使检查 animationName 仍有 CSS 动画属性覆盖导致的可靠性问题。
      // 计时：0.3s × 3次 = 0.9s，加 0.1s 余量 = 1秒。
      const flashTimer = setTimeout(() => {
        flashTarget.classList.remove('search-flash');
      }, 1000);

      // 保存清理函数，供下次导航或关闭搜索时调用
      flashCleanupRef.current = () => {
        clearTimeout(flashTimer);
        flashTarget.classList.remove('search-flash');
      };
    };

    // 消息级折叠：延迟 400ms 等展开动画完成再滚动
    // useCollapsible 的 useEffect 在 DOM 提交后异步运行（比渲染期同步派生晚 ~1 帧），
    // 展开动画 250ms + useEffect 延迟 ~16ms + 余量 ≈ 400ms
    // 内容块级折叠：延迟 300ms（展开动画 250ms + 余量）
    // 非折叠消息：直接 rAF
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    if (isMsgLevelCollapsible) {
      scrollTimer = setTimeout(() => {
        requestAnimationFrame(doScrollAndFlash);
      }, 400);
    } else if (hasBlockLevelCollapsible) {
      scrollTimer = setTimeout(() => {
        requestAnimationFrame(doScrollAndFlash);
      }, 300);
    } else {
      requestAnimationFrame(doScrollAndFlash);
    }

    return () => {
      if (scrollTimer) clearTimeout(scrollTimer);
    };
  }, [currentMatchIndex, navSearchMatchIds, visibleMessages, forceRenderIndex]);

  /**
   * 全局快捷键：Ctrl+F / Cmd+F 打开导航搜索栏
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        // 切换搜索栏：已打开则关闭，未打开则打开
        if (navSearchOpen) {
          closeNavSearch();
        } else {
          setNavSearchOpen(true);
          // 聚焦由下方 navSearchOpen effect 处理（此时 DOM 尚未更新，ref 为 null）
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navSearchOpen, closeNavSearch]);

  /**
   * 搜索栏打开后自动聚焦。
   *
   * 不能在 setNavSearchOpen(true) 的同一事件处理中调用 focus()，
   * 因为 NavSearchBar 是条件渲染的（navSearchOpen && <NavSearchBar>），
   * setState 后 DOM 尚未更新，ref 仍为 null。
   * useEffect 在 DOM 提交后运行，此时 NavSearchBar 已挂载，ref 可用。
   */
  useEffect(() => {
    if (navSearchOpen) {
      navSearchBarRef.current?.focus();
    }
  }, [navSearchOpen]);

  /**
   * 开始编辑指定的显示消息。
   */
  const handleStartEdit = (msg: DisplayMessage) => {
    setEditingId(msg.displayId);
    setEditingSourceUuid(msg.sourceUuid);

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
          blocks.push({
            index: originalIndex,
            type: 'tool_use',
            text: JSON.stringify(block.input || {}, null, 2),
          });
          break;
        case 'tool_result': {
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
          break;
      }
    });

    if (blocks.length === 0) {
      blocks.push({ index: -1, type: 'text', text: '' });
    }
    setEditBlocks(blocks);
  };

  /**
   * 保存编辑后的消息内容。
   */
  const handleSaveEdit = () => {
    if (editingId && editingSourceUuid) {
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
   */
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingSourceUuid(null);
    setEditBlocks([]);
  };

  // ==================== 拖拽添加消息处理函数 ====================

  /**
   * 新消息保存回调：NewMessageEditor 构造好完整消息后调用。
   * 通过 Rust 后端持久化到 JSONL 文件，然后刷新会话数据。
   */
  /** 重置内联编辑器所有状态 */
  const resetInsertEditor = useCallback(() => {
    setInsertingAfterUuid(null);
    setInsertPhase('select');
    setInsertType(null);
    setInsertContent('');
    setInsertSaving(false);
  }, []);

  /** 内联编辑器：选择消息类型 → 进入编辑阶段 */
  const handleInsertTypeSelect = useCallback((type: string) => {
    setInsertType(type);
    // 根据类型预填充编辑内容
    if (type === 'file-history-snapshot') {
      setInsertContent(JSON.stringify({
        messageId: '', snapshot: { messageId: '', trackedFileBackups: {}, timestamp: new Date().toISOString() }, isSnapshotUpdate: false,
      }, null, 2));
    } else if (type === 'queue-operation') {
      setInsertContent(JSON.stringify({ operation: 'enqueue', data: {} }, null, 2));
    } else {
      setInsertContent('');
    }
    setInsertPhase('edit');
  }, []);

  /** 内联编辑器：构造完整消息并保存 */
  const handleInsertSave = useCallback(async () => {
    if (!session || !insertType || insertSaving || insertingAfterUuid === null) return;
    setInsertSaving(true);
    try {
      const uuid = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      const afterUuid = insertingAfterUuid ?? '';
      const baseMessage: Record<string, unknown> = {
        type: insertType, uuid,
        parentUuid: afterUuid || null,
        isSidechain: false,
        sessionId: session.id,
        timestamp,
      };
      switch (insertType) {
        case 'user':
          baseMessage.message = { role: 'user', content: insertContent };
          break;
        case 'assistant':
          baseMessage.message = { role: 'assistant', content: [{ type: 'text', text: insertContent }] };
          break;
        case 'custom-title':
          baseMessage.title = insertContent;
          break;
        case 'tag':
          baseMessage.value = insertContent;
          break;
        case 'file-history-snapshot':
        case 'queue-operation':
          try { Object.assign(baseMessage, JSON.parse(insertContent)); } catch { baseMessage.content = insertContent; }
          break;
      }
      await insertMessage(session.filePath, afterUuid, baseMessage);
      onRefresh();
    } catch (err) {
      console.error('插入消息失败:', err);
    } finally {
      resetInsertEditor();
    }
  }, [session, insertType, insertSaving, insertingAfterUuid, insertContent, onRefresh, resetInsertEditor]);

  /**
   * 滚动容器的统一 onDrop 处理器
   *
   * 位置确定策略（两层）：
   *
   * 1. **优先使用 DropZone 上报的位置**（O(1)，精确）
   *    当用户悬停在 DropZone 上松手时，`_hoveredAfterUuid` 已由 DropZone
   *    的 dragEnter 写入。直接读取即可，无需 DOM 遍历。
   *
   * 2. **兜底：二分查找可视消息**
   *    当用户直接在消息内容区域松手（不在 DropZone 上）时，
   *    `_hoveredAfterUuid` 为 null。此时仅对**视口内可见的消息**
   *    做二分查找，避免遍历全部 643+ 条消息的 DOM 元素。
   *
   * 通过模块级标志位 `_addMessageDragActive` 验证拖拽来源，
   * 避免依赖 `dataTransfer.getData()` 或 React state。
   */
  const handleScrollContainerDrop = useCallback((e: React.DragEvent) => {
    if (!_addMessageDragActive) return;

    e.preventDefault();
    _addMessageDragActive = false;

    // ---- 策略 1：使用 DropZone 上报的精确位置 ----
    const hoveredUuid = _hoveredAfterUuid;
    resetHoveredAfterUuid();

    if (hoveredUuid !== null) {
      setIsDraggingAdd(false);
      setInsertingAfterUuid(hoveredUuid);
      return;
    }

    // ---- 策略 2：兜底 - 仅对视口内消息做查找 ----
    const container = scrollContainerRef.current;
    if (!container || visibleMessages.length === 0) {
      setIsDraggingAdd(false);
      return;
    }

    const cursorY = e.clientY;

    // 获取视口边界，仅查询视口附近的消息（避免遍历全部 DOM）
    const containerRect = container.getBoundingClientRect();
    const msgElements = container.querySelectorAll<HTMLElement>('[data-msg-index]');
    let bestAfterUuid = '';  // 默认插入到最前方

    // 只检查视口附近的消息（top 在视口范围 ±200px 内的元素）
    const viewportTop = containerRect.top - 200;
    const viewportBottom = containerRect.bottom + 200;

    for (let i = 0; i < msgElements.length; i++) {
      const rect = msgElements[i].getBoundingClientRect();

      // 跳过完全在视口上方的元素（优化：从头跳过不可见的部分）
      if (rect.bottom < viewportTop) continue;
      // 超出视口下方的元素不再处理
      if (rect.top > viewportBottom) break;

      const midY = rect.top + rect.height / 2;
      if (cursorY > midY) {
        const msgIndex = parseInt(msgElements[i].getAttribute('data-msg-index') || '0', 10);
        bestAfterUuid = visibleMessages[msgIndex]?.sourceUuid || '';
      } else {
        break;
      }
    }

    setIsDraggingAdd(false);
    setInsertingAfterUuid(bestAfterUuid);
  }, [visibleMessages]);

  /* 空状态：未选择任何会话时显示引导界面 */
  if (!session) {
    return (
      <div className="flex-1 flex flex-col bg-background min-w-0">
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
        <div className="flex-1 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-muted-foreground"
          >
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

  /** 筛选器是否处于非全选状态（类型不全选 或 内容筛选搜索有关键词） */
  const isFiltered = activeFilters.size !== ALL_FILTERS.length || filterSearchQuery.trim() !== '';

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0">
      {/* 头部工具栏 */}
      <div className="p-4 border-b border-border flex items-start justify-between gap-4 bg-card shrink-0">
        <div className="flex items-start gap-3 min-w-0 shrink">
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
              {filterSearchQuery.trim() || isFiltered
                ? `显示 ${visibleMessages.length}/${totalMessages} 条消息`
                : `${visibleMessages.length} 条消息`}
              {/* Token 使用量汇总 */}
              {tokenStats && tokenStats.inputTokens + tokenStats.outputTokens > 0 && (
                <span className="ml-2">
                  · 输入: {tokenStats.inputTokens.toLocaleString()} · 输出: {tokenStats.outputTokens.toLocaleString()}
                  {tokenStats.cacheReadInputTokens > 0 && ` · 缓存读取: ${tokenStats.cacheReadInputTokens.toLocaleString()}`}
                  {tokenStats.cacheCreationInputTokens > 0 && ` · 缓存创建: ${tokenStats.cacheCreationInputTokens.toLocaleString()}`}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* 拖拽添加消息按钮：拖出后放置在消息间隙可插入新消息 */}
          <div
            draggable
            onDragStart={(e) => {
              // 清除上次的编辑器（所有状态）
              resetInsertEditor();
              // 设置模块级标志位 + React 状态
              _addMessageDragActive = true;
              setIsDraggingAdd(true);
              // 设置拖拽数据标识（HTML5 Drag API 要求）
              e.dataTransfer.setData('text/plain', 'add-message');
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onDragEnd={() => {
              // 始终清理模块级标志位和 React 状态（安全兜底）。
              _addMessageDragActive = false;
              resetHoveredAfterUuid();
              setIsDraggingAdd(false);
            }}
            className="p-2 rounded-lg hover:bg-accent transition-colors cursor-grab active:cursor-grabbing hover:scale-105 active:scale-95"
            title="拖拽到消息之间插入新消息"
          >
            <Plus className="w-5 h-5" />
          </div>

          {/* 实用工具下拉菜单 */}
          <div className="relative" ref={toolsRef}>
            <motion.button
              onClick={() => setShowToolsDropdown(!showToolsDropdown)}
              className={`p-2 rounded-lg transition-colors ${
                showToolsDropdown ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              }`}
              title="实用工具"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Wrench className="w-5 h-5" />
            </motion.button>
            <AnimatePresence>
              {showToolsDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-1 w-44 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
                >
                  <button
                    onClick={async () => {
                      setShowToolsDropdown(false);
                      if (!session || !projectPath) return;
                      try {
                        await openResumeTerminal(projectPath, session.id);
                      } catch (err) {
                        console.error('一键 Resume 失败:', err);
                      }
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50 transition-colors"
                  >
                    <Terminal className="w-4 h-4" />
                    <span>一键 Resume</span>
                  </button>
                  {/* 一键修复：打开修复弹窗 */}
                  <button
                    onClick={() => {
                      setShowToolsDropdown(false);
                      setShowQuickFix(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50 transition-colors"
                  >
                    <Wrench className="w-4 h-4" />
                    <span>一键修复</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 搜索按钮：点击打开 VSCode 风格导航搜索栏 */}
          <motion.button
            onClick={() => {
              setNavSearchOpen(true);
              // 聚焦由 navSearchOpen effect 处理
            }}
            className={`p-2 rounded-lg transition-colors ${
              navSearchOpen ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
            }`}
            title="搜索 (Ctrl+F)"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Search className="w-5 h-5" />
          </motion.button>

          {/* 选择模式切换按钮 */}
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

          {/* 选择模式下的操作按钮组 */}
          <AnimatePresence>
            {selectionMode && (
              <>
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => onSelectAll([...new Set(visibleMessages.map(m => m.sourceUuid))])}
                  className="px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors text-sm"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  全选
                </motion.button>
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

          {/* 多选筛选器下拉菜单 */}
          <div className="relative" ref={filterRef}>
            <motion.button
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className={`p-2 rounded-lg transition-colors relative ${
                isFiltered
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent'
              }`}
              title="筛选消息类型"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Filter className="w-5 h-5" />
              {/* 非全选时显示徽章 */}
              {isFiltered && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
                  {activeFilters.size}
                </span>
              )}
            </motion.button>
            <AnimatePresence>
              {showFilterDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-1 w-48 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
                >
                  {/* 内容筛选搜索输入框 */}
                  <div className="px-2 py-2 border-b border-border/50">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        value={filterSearchQuery}
                        onChange={(e) => setFilterSearchQuery(e.target.value)}
                        placeholder="搜索过滤..."
                        className="w-full pl-7 pr-7 py-1.5 rounded-md bg-secondary text-foreground border border-border focus:outline-none focus:border-ring text-xs"
                        onClick={(e) => e.stopPropagation()}
                      />
                      {filterSearchQuery && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setFilterSearchQuery(''); }}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  {/* 全选/取消全选 */}
                  <button
                    onClick={toggleAllFilters}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent/50 border-b border-border/50"
                  >
                    {activeFilters.size === ALL_FILTERS.length ? (
                      <CheckSquare className="w-4 h-4 text-primary" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                    <span className="flex-1 text-left font-medium">
                      {activeFilters.size === ALL_FILTERS.length ? '取消全选' : '全选'}
                    </span>
                  </button>
                  {/* 各类型 checkbox */}
                  {FILTER_CONFIG.map(({ type, icon: Icon, label }) => (
                    <button
                      key={type}
                      onClick={() => toggleFilter(type)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent/50"
                    >
                      {activeFilters.has(type) ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                      <Icon className="w-4 h-4" />
                      <span className="flex-1 text-left">{label}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 导出按钮 */}
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
            <AnimatePresence>
              {showExportDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-1 w-44 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
                >
                  <button
                    onClick={() => { onExport('markdown'); setShowExportDropdown(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50 transition-colors"
                  >
                    <FileText className="w-4 h-4" />
                    <span>Markdown</span>
                  </button>
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

          {/* 刷新按钮 */}
          <motion.button
            onClick={onRefresh}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title="刷新"
            whileHover={{ scale: 1.05, rotate: 180 }}
            whileTap={{ scale: 0.95 }}
          >
            <RefreshCw className="w-5 h-5" />
          </motion.button>
        </div>
      </div>

      {/* ==================== VSCode 风格导航搜索栏 ==================== */}
      <AnimatePresence>
        {navSearchOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="border-b border-border bg-card shrink-0 overflow-hidden"
          >
            <NavSearchBar
              ref={navSearchBarRef}
              matchCount={navSearchMatchIds.length}
              currentMatchIndex={currentMatchIndex}
              onSearch={handleNavSearch}
              onNext={navSearchNext}
              onPrev={navSearchPrev}
              onClose={closeNavSearch}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 消息列表：正常时间顺序，视口驱动渐进式渲染 */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScrollForRender}
        // 全局 dragOver：允许 HTML5 DnD 放置，防止浏览器显示禁止光标。
        // 始终绑定（非条件式），因为 dragover 仅在拖拽进行中才触发，无性能开销。
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        // 兜底 onDrop：当用户松手在消息内容上（而非 DropZone 条上）时，
        // 通过光标 Y 坐标计算最近的消息间隙位置。
        onDrop={handleScrollContainerDrop}
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 gap-4 custom-scrollbar relative flex flex-col"
      >
        {/* 渲染说明：
            displayMessages 保持原始时间顺序（旧→新）。
            useProgressiveRender 控制哪些消息渲染完整内容，未渲染的显示轻量占位符。
            加载时自动 scrollTop = scrollHeight 跳到底部。 */}

        {visibleMessages.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">没有消息</div>
        ) : (
          <>
            {visibleMessages.map((msg, index) => {
              // 计算当前消息前方放置区域的 afterUuid
              // index === 0 时 afterUuid 为空字符串（表示插入到最前方）
              // 否则为前一条消息的 sourceUuid
              const dropAfterUuid = index === 0 ? '' : visibleMessages[index - 1].sourceUuid;

              return (
                <React.Fragment key={msg.displayId}>
                  {/* 消息前方的拖拽放置区域 */}
                  <MessageDropZone
                    afterUuid={dropAfterUuid}
                    isDragging={isDraggingAdd}
                  />
                  {/* 内联编辑器：拖拽放置后就地展开的消息编辑面板 */}
                  {insertingAfterUuid === dropAfterUuid && (
                    <div style={{
                      background: 'var(--card)',
                      color: 'var(--foreground)',
                      border: '2px solid var(--primary)',
                      borderRadius: '12px',
                      padding: '16px',
                      margin: '4px 0',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    }}>
                      {insertPhase === 'select' ? (
                        /* Phase A: 类型选择 */
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 600 }}>选择消息类型</span>
                            <button onClick={resetInsertEditor} style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', padding: '4px' }}>
                              <X style={{ width: 16, height: 16 }} />
                            </button>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            {([
                              { type: 'user', Icon: User, label: '用户消息', c: 'var(--color-blue-500, #3b82f6)' },
                              { type: 'assistant', Icon: Bot, label: '助手消息', c: 'var(--color-purple-500, #8b5cf6)' },
                              { type: 'file-history-snapshot', Icon: Archive, label: '文件快照', c: 'var(--color-amber-500, #f59e0b)' },
                              { type: 'queue-operation', Icon: Terminal, label: '队列操作', c: 'var(--color-green-500, #22c55e)' },
                              { type: 'custom-title', Icon: FileText, label: '自定义标题', c: 'var(--color-cyan-500, #06b6d4)' },
                              { type: 'tag', Icon: Lightbulb, label: '标签', c: 'var(--color-rose-500, #f43f5e)' },
                            ] as const).map(({ type, Icon, label, c }) => (
                              <button
                                key={type}
                                onClick={() => handleInsertTypeSelect(type)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '8px',
                                  padding: '10px 12px',
                                  border: '1px solid var(--border)',
                                  borderRadius: '8px',
                                  background: 'var(--secondary)',
                                  color: c,
                                  cursor: 'pointer',
                                  textAlign: 'left' as const,
                                  fontSize: '13px',
                                  fontWeight: 500,
                                  transition: 'background 0.15s',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--secondary)'; }}
                              >
                                <Icon style={{ width: 16, height: 16, flexShrink: 0 }} />
                                <span>{label}</span>
                              </button>
                            ))}
                          </div>
                        </>
                      ) : (
                        /* Phase B: 内容编辑 */
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)' }}>
                              {insertType === 'user' ? '用户消息' : insertType === 'assistant' ? '助手消息'
                                : insertType === 'file-history-snapshot' ? '文件快照' : insertType === 'queue-operation' ? '队列操作'
                                : insertType === 'custom-title' ? '自定义标题' : '标签'}
                            </span>
                            <button onClick={resetInsertEditor} style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', padding: '4px' }}>
                              <X style={{ width: 16, height: 16 }} />
                            </button>
                          </div>
                          {(insertType !== 'custom-title' && insertType !== 'tag') ? (
                            <textarea
                              value={insertContent}
                              onChange={(e) => setInsertContent(e.target.value)}
                              placeholder={insertType === 'file-history-snapshot' || insertType === 'queue-operation' ? '编辑 JSON 内容...' : '输入消息内容...'}
                              autoFocus
                              style={{
                                width: '100%', height: '128px',
                                padding: '8px 12px',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                background: 'var(--secondary)',
                                color: 'var(--foreground)',
                                fontSize: '13px',
                                fontFamily: 'monospace',
                                resize: 'vertical',
                                outline: 'none',
                              }}
                            />
                          ) : (
                            <input
                              type="text"
                              value={insertContent}
                              onChange={(e) => setInsertContent(e.target.value)}
                              placeholder={insertType === 'custom-title' ? '输入自定义标题...' : '输入标签值...'}
                              autoFocus
                              style={{
                                width: '100%',
                                padding: '8px 12px',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                background: 'var(--secondary)',
                                color: 'var(--foreground)',
                                fontSize: '13px',
                                outline: 'none',
                              }}
                            />
                          )}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                            <button
                              onClick={() => { setInsertPhase('select'); setInsertType(null); setInsertContent(''); }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '4px',
                                padding: '6px 10px', border: 'none', borderRadius: '6px',
                                background: 'none', color: 'var(--muted-foreground)',
                                cursor: 'pointer', fontSize: '13px',
                              }}
                            >
                              <ArrowLeft style={{ width: 14, height: 14 }} />
                              返回
                            </button>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={resetInsertEditor}
                                style={{
                                  padding: '6px 12px', border: 'none', borderRadius: '6px',
                                  background: 'none', color: 'var(--muted-foreground)',
                                  cursor: 'pointer', fontSize: '13px',
                                }}
                              >取消</button>
                              <button
                                onClick={handleInsertSave}
                                disabled={insertSaving || !insertContent.trim()}
                                style={{
                                  padding: '6px 12px', border: 'none', borderRadius: '6px',
                                  background: (insertSaving || !insertContent.trim()) ? 'var(--muted)' : 'var(--primary)',
                                  color: (insertSaving || !insertContent.trim()) ? 'var(--muted-foreground)' : 'var(--primary-foreground)',
                                  cursor: (insertSaving || !insertContent.trim()) ? 'not-allowed' : 'pointer',
                                  fontSize: '13px', fontWeight: 500,
                                }}
                              >{insertSaving ? '保存中...' : '保存'}</button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {/* 消息本体 */}
                  <MessageItem
                    msg={msg}
                    index={index}
                    isRendered={isRendered(index)}
                    projectPath={projectPath}
                    toolUseMap={toolUseMap}
                    searchHighlight={navSearchResultSet.has(msg.displayId) ? searchHighlight : undefined}
                    searchAutoExpand={searchAutoExpandId === msg.displayId}
                    selectionMode={selectionMode}
                    isSelected={selectedMessages.has(msg.sourceUuid)}
                    isEditing={editingId === msg.displayId}
                    editBlocks={editBlocks}
                    onToggleSelect={onToggleSelect}
                    onDeleteMessage={onDeleteMessage}
                    onStartEdit={handleStartEdit}
                    onSaveEdit={handleSaveEdit}
                    onCancelEdit={handleCancelEdit}
                    onEditBlockChange={setEditBlocks}
                    onNavigateToSession={onNavigateToSession}
                  />
                </React.Fragment>
              );
            })}
            {/* 最后一条消息之后的放置区域（drop 后原地转变为编辑器） */}
            {(() => {
              const lastAfterUuid = visibleMessages.length > 0
                ? visibleMessages[visibleMessages.length - 1].sourceUuid
                : '';
              return (
                <>
                  <MessageDropZone
                    afterUuid={lastAfterUuid}
                    isDragging={isDraggingAdd}
                  />
                  {insertingAfterUuid === lastAfterUuid && (
                    <div style={{
                      background: 'var(--card)',
                      color: 'var(--foreground)',
                      border: '2px solid var(--primary)',
                      borderRadius: '12px',
                      padding: '16px',
                      margin: '4px 0',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    }}>
                      {insertPhase === 'select' ? (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 600 }}>选择消息类型</span>
                            <button onClick={resetInsertEditor} style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', padding: '4px' }}>
                              <X style={{ width: 16, height: 16 }} />
                            </button>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            {([
                              { type: 'user', Icon: User, label: '用户消息', c: 'var(--color-blue-500, #3b82f6)' },
                              { type: 'assistant', Icon: Bot, label: '助手消息', c: 'var(--color-purple-500, #8b5cf6)' },
                              { type: 'file-history-snapshot', Icon: Archive, label: '文件快照', c: 'var(--color-amber-500, #f59e0b)' },
                              { type: 'queue-operation', Icon: Terminal, label: '队列操作', c: 'var(--color-green-500, #22c55e)' },
                              { type: 'custom-title', Icon: FileText, label: '自定义标题', c: 'var(--color-cyan-500, #06b6d4)' },
                              { type: 'tag', Icon: Lightbulb, label: '标签', c: 'var(--color-rose-500, #f43f5e)' },
                            ] as const).map(({ type, Icon, label, c }) => (
                              <button key={type} onClick={() => handleInsertTypeSelect(type)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '8px',
                                  padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '8px',
                                  background: 'var(--secondary)', color: c, cursor: 'pointer',
                                  textAlign: 'left' as const, fontSize: '13px', fontWeight: 500, transition: 'background 0.15s',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--secondary)'; }}
                              >
                                <Icon style={{ width: 16, height: 16, flexShrink: 0 }} />
                                <span>{label}</span>
                              </button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)' }}>{insertType}</span>
                            <button onClick={resetInsertEditor} style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', padding: '4px' }}>
                              <X style={{ width: 16, height: 16 }} />
                            </button>
                          </div>
                          {(insertType !== 'custom-title' && insertType !== 'tag') ? (
                            <textarea value={insertContent} onChange={(e) => setInsertContent(e.target.value)} placeholder="输入消息内容..." autoFocus
                              style={{ width: '100%', height: '128px', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--secondary)', color: 'var(--foreground)', fontSize: '13px', fontFamily: 'monospace', resize: 'vertical', outline: 'none' }} />
                          ) : (
                            <input type="text" value={insertContent} onChange={(e) => setInsertContent(e.target.value)} placeholder="输入内容..." autoFocus
                              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--secondary)', color: 'var(--foreground)', fontSize: '13px', outline: 'none' }} />
                          )}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                            <button onClick={() => { setInsertPhase('select'); setInsertType(null); setInsertContent(''); }}
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', border: 'none', borderRadius: '6px', background: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: '13px' }}>
                              <ArrowLeft style={{ width: 14, height: 14 }} />返回
                            </button>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={resetInsertEditor} style={{ padding: '6px 12px', border: 'none', borderRadius: '6px', background: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: '13px' }}>取消</button>
                              <button onClick={handleInsertSave} disabled={insertSaving || !insertContent.trim()}
                                style={{ padding: '6px 12px', border: 'none', borderRadius: '6px', background: (insertSaving || !insertContent.trim()) ? 'var(--muted)' : 'var(--primary)', color: (insertSaving || !insertContent.trim()) ? 'var(--muted-foreground)' : 'var(--primary-foreground)', cursor: (insertSaving || !insertContent.trim()) ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 500 }}>
                                {insertSaving ? '保存中...' : '保存'}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </>
        )}
      </div>

      {/* 悬浮返回按钮 */}
      <AnimatePresence>
        {navBackTarget && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10"
          >
            <motion.button
              onClick={onNavigateBack}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full
                         bg-primary text-primary-foreground shadow-lg hover:bg-primary/90
                         transition-colors text-sm font-medium"
              title={`返回: ${navBackTarget.session.name || navBackTarget.session.id.substring(0, 8)}`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <ArrowLeft className="w-4 h-4" />
              返回: {navBackTarget.session.name || navBackTarget.session.id.substring(0, 8)}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 一键修复弹窗 */}
      <AnimatePresence>
        {showQuickFix && session && (
          <QuickFixModal
            sessionFilePath={session.filePath}
            onClose={() => setShowQuickFix(false)}
            onSessionUpdate={onRefresh}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
