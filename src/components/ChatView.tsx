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

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronRight, ChevronDown, ChevronUp, Search, X, CheckSquare, Square, Filter,
  Download, FileText, FileJson, RefreshCw, ArrowLeft,
  Copy, Edit2, Trash2, Bot, User, Lightbulb, Wrench, Archive, Terminal, ExternalLink
} from 'lucide-react';
import type { Session, Project, DisplayMessage, TransformedSession, ToolUseInfo } from '../types/claude';
import { formatTimestamp, searchSession } from '../utils/claudeData';
import { parseJsonlPath } from '../utils/messageTransform';
import { MessageBlockList } from './MessageBlockList';
import { MessageContentRenderer } from './MessageContentRenderer';
import { useProgressiveRender } from '../hooks/useProgressiveRender';

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
}: {
  msg: DisplayMessage;
  projectPath: string;
  toolUseMap: Record<string, ToolUseInfo>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      key={msg.displayId}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* 分割线：--已压缩-- */}
      <div
        className="flex items-center gap-3 cursor-pointer select-none py-1"
        onClick={() => setExpanded(!expanded)}
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
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(msg.timestamp)}
                </span>
              </div>
              {/* 摘要内容 */}
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <MessageBlockList content={msg.content} projectPath={projectPath} toolUseMap={toolUseMap} />
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
 * 以紧凑的折叠卡片形式展示 Claude Code CLI 自动注入的系统消息，
 * 根据 systemLabel 显示不同的图标和标签文字：
 * - '技能'：灯泡图标，标签"技能"
 * - '计划'：文件图标，标签"计划"，折叠态显示 H1 标题，跳转按钮始终可见
 * - '系统'：终端图标，标签"系统"（默认）
 */
function SystemMessageBlock({
  msg,
  projectPath,
  toolUseMap,
  currentSession,
  projects,
  onNavigateToSession,
}: {
  msg: DisplayMessage;
  projectPath: string;
  toolUseMap: Record<string, ToolUseInfo>;
  /** 当前选中的会话，用于判断引用的会话是否为当前会话 */
  currentSession: Session | null;
  /** 所有项目列表，用于判断引用的会话是否存在 */
  projects: Project[];
  /** 跳转到指定会话的回调 */
  onNavigateToSession: (encodedProject: string, sessionId: string) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);

  // 根据 systemLabel 选择图标和标签文字
  const label = msg.systemLabel || '系统';
  const isPlan = label === '计划';
  const IconComponent = label === '技能' ? Lightbulb : isPlan ? FileText : Terminal;

  // 计划消息：解析源会话信息（仅当有 planSourcePath 时）
  const planInfo = useMemo(() => {
    if (!msg.planSourcePath) return null;
    return parseJsonlPath(msg.planSourcePath);
  }, [msg.planSourcePath]);

  // 判断计划引用的会话状态
  const planSessionStatus = useMemo(() => {
    if (!planInfo) return null;
    if (currentSession && planInfo.sessionId === currentSession.id) {
      return 'current' as const;
    }
    const targetProject = projects.find(p => p.name === planInfo.encodedProject);
    if (!targetProject) return 'not_found' as const;
    const targetSession = targetProject.sessions.find(s => s.id === planInfo.sessionId);
    if (!targetSession) return 'not_found' as const;
    return 'navigable' as const;
  }, [planInfo, currentSession, projects]);

  /**
   * 计划消息：提取第一个 H1 标题作为折叠态预览文本
   * 例如 "# Build User Auth System" → "Build User Auth System"
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
   * 计划消息：清理内容，剥离固定模板文本。
   *
   * 移除的模板：
   * - 头部：`Implement the following plan:\n\n`
   * - 尾部：`If you need specific details ... read the full transcript at: xxx.jsonl`
   *
   * 保留中间的纯计划 Markdown 内容。
   */
  const cleanedContent = useMemo(() => {
    if (!isPlan) return msg.content;
    return msg.content.map(block => {
      if (block.type !== 'text' || !block.text) return block;
      let text = block.text;
      // 移除头部固定模板
      text = text.replace(/^Implement the following plan:\s*\n*/i, '');
      // 移除尾部固定模板（从 "If you need specific details" 或 "read the full transcript at:" 到末尾）
      const transcriptIdx = text.lastIndexOf('read the full transcript at:');
      if (transcriptIdx !== -1) {
        // 查找该段落的起始位置（向前找空行）
        let paraStart = text.lastIndexOf('\n\n', transcriptIdx);
        if (paraStart === -1) paraStart = transcriptIdx;
        text = text.substring(0, paraStart);
      }
      return { ...block, text: text.trim() };
    });
  }, [msg.content, isPlan]);

  return (
    <div>
      {/* 计划消息头部栏：标签 + 标题 + 跳转按钮 + 展开/收起（始终可见） */}
      <div
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg select-none
                    bg-muted/40 border border-border/40 hover:bg-muted/60 transition-colors text-xs text-muted-foreground
                    ${isPlan ? '' : 'inline-flex cursor-pointer'}`}
        onClick={isPlan ? undefined : () => setExpanded(!expanded)}
        title={isPlan ? undefined : (expanded ? `收起${label}消息` : `展开${label}消息`)}
      >
        {/* 左侧：图标 + 标签 + 计划标题（可点击展开） */}
        <div
          className={`flex items-center gap-1.5 min-w-0 ${isPlan ? 'cursor-pointer flex-1' : ''}`}
          onClick={isPlan ? () => setExpanded(!expanded) : undefined}
          title={isPlan ? (expanded ? '收起计划内容' : '展开计划内容') : undefined}
        >
          <IconComponent className="w-3 h-3 shrink-0" />
          <span className="font-medium shrink-0">{label}</span>
          {/* 计划消息：显示 H1 标题 */}
          {isPlan && planTitle && (
            <span className="text-foreground/80 font-medium truncate">
              {planTitle}
            </span>
          )}
          {!isPlan && (
            <span className="opacity-60">{formatTimestamp(msg.timestamp)}</span>
          )}
          {expanded ? <ChevronUp className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
        </div>

        {/* 右侧：计划消息的跳转按钮（始终可见，不在折叠内） */}
        {isPlan && planInfo && planSessionStatus !== 'current' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNavigateToSession(planInfo.encodedProject, planInfo.sessionId);
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md shrink-0
                       bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-xs font-medium"
            title={`跳转到源会话 ${planInfo.sessionId.substring(0, 8)}`}
          >
            <ExternalLink className="w-3 h-3" />
            源会话
          </button>
        )}
        {isPlan && planInfo && planSessionStatus === 'current' && (
          <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium shrink-0">
            当前会话
          </span>
        )}
      </div>

      {/* 展开内容区域 */}
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
                {/* 计划消息使用清理后的内容（无模板文本），其他系统消息使用原始内容 */}
                <MessageBlockList
                  content={isPlan ? cleanedContent : msg.content}
                  projectPath={projectPath}
                  toolUseMap={toolUseMap}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
  projects,
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
  /** 搜索关键词：输入后 debounce 300ms 发送到 Rust 后端搜索 */
  const [searchQuery, setSearchQuery] = useState('');
  /** 后端搜索结果：匹配的 display_id 集合。null 表示无搜索 */
  const [searchResults, setSearchResults] = useState<Set<string> | null>(null);
  /** 多选筛选器激活状态 */
  const [activeFilters, setActiveFilters] = useState<Set<FilterableType>>(new Set(ALL_FILTERS));
  /** 控制过滤器下拉菜单的显示/隐藏状态 */
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  /** 控制导出下拉菜单的显示/隐藏状态 */
  const [showExportDropdown, setShowExportDropdown] = useState(false);

  // 直接使用 Rust 返回的数据
  const displayMessages = transformedSession?.displayMessages ?? [];
  const toolUseMap = transformedSession?.toolUseMap ?? {};
  const tokenStats = transformedSession?.tokenStats;

  /** 过滤器下拉菜单容器引用，用于检测外部点击以关闭下拉菜单 */
  const filterRef = useRef<HTMLDivElement>(null);
  /** 导出下拉菜单容器引用，用于检测外部点击以关闭下拉菜单 */
  const exportRef = useRef<HTMLDivElement>(null);
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
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /**
   * 后端搜索：debounce 300ms，调用 Rust SIMD 搜索
   */
  useEffect(() => {
    if (!searchQuery.trim() || !session) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const ids = await searchSession(session.filePath, searchQuery);
        setSearchResults(new Set(ids));
      } catch (err) {
        console.error('搜索失败:', err);
        setSearchResults(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, session]);

  /**
   * 组合筛选：类型多选 + 后端搜索结果交叉
   *
   * displayMessages 保持原始时间顺序（旧→新），前端通过 useProgressiveRender 实现视口优先加载。
   */
  const visibleMessages = useMemo(() => {
    return displayMessages.filter(msg => {
      // 类型筛选
      if (!activeFilters.has(msg.displayType as FilterableType)) return false;
      // 搜索结果筛选
      if (searchResults !== null && !searchResults.has(msg.displayId)) return false;
      return true;
    });
  }, [displayMessages, activeFilters, searchResults]);

  /** 过滤前的总显示消息数，用于显示 "N/M" 计数 */
  const totalMessages = displayMessages.length;

  /**
   * 渐进式渲染：视口驱动，先渲染可视区域，空闲时向外扩散。
   * isRendered(index) 判断 visibleMessages[index] 是否应渲染完整内容。
   * handleScrollForRender 绑定到滚动容器的 onScroll。
   * scrollToBottom 在初始渲染完成后调用。
   */
  const { isRendered, handleScroll: handleScrollForRender, scrollToBottom } = useProgressiveRender(
    visibleMessages.length,
    scrollContainerRef,
  );

  /**
   * 加载会话后自动滚动到底部。
   * scrollToBottom 内部使用双 requestAnimationFrame 确保布局完成后再滚动。
   */
  useEffect(() => {
    if (transformedSession) {
      scrollToBottom();
    }
  }, [transformedSession, scrollToBottom]);

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

  /**
   * 将指定文本复制到系统剪贴板。
   */
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  /**
   * 获取 DisplayMessage 的文本内容，用于复制到剪贴板。
   * 直接从 content 块中提取文本，不依赖 rawMessage。
   */
  const getDisplayText = (msg: DisplayMessage): string => {
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
  };

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

  /** 筛选器是否处于非全选状态 */
  const isFiltered = activeFilters.size !== ALL_FILTERS.length;

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
              {searchQuery.trim() || isFiltered
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
          {/* 搜索输入框 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索消息..."
              className="pl-8 pr-3 py-1.5 w-40 rounded-lg bg-secondary text-foreground border border-border focus:outline-none focus:border-ring text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

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

      {/* 消息列表：正常时间顺序，视口驱动渐进式渲染 */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScrollForRender}
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 gap-4 custom-scrollbar relative flex flex-col"
      >
        {/* 渲染说明：
            displayMessages 保持原始时间顺序（旧→新）。
            useProgressiveRender 控制哪些消息渲染完整内容，未渲染的显示轻量占位符。
            加载时自动 scrollTop = scrollHeight 跳到底部。 */}

        {visibleMessages.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">没有消息</div>
        ) : (
          visibleMessages.map((msg, index) => (
            <div
              key={msg.displayId}
              data-msg-index={index}
            >
              {isRendered(index) ? (
                /* ====== 已渲染：完整消息内容 ====== */
                msg.displayType === 'compact_summary' ? (
                  <CompactSummaryBlock msg={msg} projectPath={projectPath} toolUseMap={toolUseMap} />
                ) :
                msg.displayType === 'system' ? (
                  <SystemMessageBlock
                    msg={msg}
                    projectPath={projectPath}
                    toolUseMap={toolUseMap}
                    currentSession={session}
                    projects={projects}
                    onNavigateToSession={onNavigateToSession}
                  />
                ) :
            <div
              className={`rounded-xl p-4 message-bubble animate-msg-in ${
                msg.displayType === 'user'
                  ? 'bg-primary/5 border border-primary/10'
                  : msg.displayType === 'tool_result'
                    ? 'bg-emerald-500/5 border border-emerald-500/10'
                    : 'bg-muted/50 border border-border'
              } ${selectionMode && selectedMessages.has(msg.sourceUuid) ? 'ring-2 ring-primary' : ''}`}
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
                      {selectedMessages.has(msg.sourceUuid) ? (
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
                      onClick={() => handleStartEdit(msg)}
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
              {editingId === msg.displayId ? (
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
                              setEditBlocks(next);
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
                              setEditBlocks(next);
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
                              setEditBlocks(next);
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
                            setEditBlocks(next);
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
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <MessageBlockList content={msg.content} projectPath={projectPath} toolUseMap={toolUseMap} />
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
          ))
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
    </div>
  );
}
