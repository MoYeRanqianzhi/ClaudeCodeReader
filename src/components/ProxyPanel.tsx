/**
 * @file ProxyPanel.tsx - 中转抓包代理面板
 * @description
 * CCR 的中转抓包专用面板，替代 ChatView 显示。提供完整的 HTTP 代理管理界面：
 *
 * 布局结构：
 * ┌──────────────────────────────────────────────────────┐
 * │ 控制栏：启动/停止、模式切换、端口设置、状态指示       │
 * ├───────────────────────┬──────────────────────────────┤
 * │ 请求列表 (左侧)       │ 详情面板 (右侧)              │
 * │ 状态标识、方法、URL、  │ Tab: Headers / Body / Raw    │
 * │ 状态码、耗时           │ JSON 高亮显示                │
 * ├───────────────────────┴──────────────────────────────┤
 * │ 拦截决策栏 (仅拦截模式，有待处理请求时显示)           │
 * └──────────────────────────────────────────────────────┘
 *
 * 数据来源：
 * - Tauri Commands：invoke 调用（启动/停止/切换模式/查询记录等）
 * - Tauri Events：实时推送（proxy:request / proxy:response / proxy:intercept）
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play, Square, Radio, Eye, Shield, ChevronLeft,
  Trash2, Download, RefreshCw, ArrowRight,
  Check, X, Globe, AlertCircle, Clock, Loader,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import type {
  ProxyStatus, ProxyMode, ProxyRecord, ProxyRecordDetail,
  RecordStatus,
} from '../types/claude';
import {
  startProxy, stopProxy, getProxyStatus, setProxyMode,
  resolveIntercept, resolveResponseIntercept,
  getProxyRecords, getRecordDetail,
  clearProxyRecords, exportProxyRecords,
} from '../utils/claudeData';

// ============ 常量 ============

/** 记录列表自动刷新间隔（毫秒） */
const RECORDS_POLL_INTERVAL = 2000;
/** 每次加载的记录数量 */
const RECORDS_PAGE_SIZE = 50;

/** 代理模式标签和图标的映射 */
const MODE_CONFIG: Record<ProxyMode, { label: string; icon: typeof Radio; desc: string }> = {
  overview: { label: '总览', icon: Radio, desc: '仅记录摘要信息' },
  inspect: { label: '查看', icon: Eye, desc: '记录完整请求/响应' },
  intercept: { label: '拦截', icon: Shield, desc: '暂停请求等待决策' },
};

/** 记录状态对应的颜色和标签 */
const STATUS_CONFIG: Record<RecordStatus, { color: string; label: string }> = {
  pending: { color: 'text-yellow-500', label: '等待中' },
  intercepted: { color: 'text-orange-500', label: '已拦截' },
  responseIntercepted: { color: 'text-purple-500', label: '响应拦截' },
  completed: { color: 'text-green-500', label: '已完成' },
  dropped: { color: 'text-red-500', label: '已丢弃' },
  error: { color: 'text-destructive', label: '错误' },
};

// ============ 子组件 ============

/**
 * 状态指示灯
 * 显示代理运行状态的彩色圆点
 */
function StatusDot({ running }: { running: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${
        running ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40'
      }`}
    />
  );
}

/**
 * HTTP 方法标签
 * 根据方法类型显示不同颜色的标签
 */
function MethodBadge({ method }: { method: string }) {
  const colorMap: Record<string, string> = {
    GET: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    POST: 'bg-green-500/15 text-green-600 dark:text-green-400',
    PUT: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
    PATCH: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    DELETE: 'bg-red-500/15 text-red-600 dark:text-red-400',
  };
  const color = colorMap[method.toUpperCase()] || 'bg-muted text-muted-foreground';

  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-mono font-medium ${color}`}>
      {method}
    </span>
  );
}

/**
 * 记录状态标签
 */
function StatusBadge({ status }: { status: RecordStatus }) {
  const config = STATUS_CONFIG[status];
  return <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>;
}

// ============ 详情面板 Tabs ============

/** 详情面板 tab 类型 */
type DetailTab = 'headers' | 'body' | 'raw';

/**
 * 详情面板组件
 * 显示选中请求的完整 Headers、Body 和 Raw 数据。
 * 在拦截/响应拦截状态下，Body 变为可编辑 textarea 并显示决策按钮。
 */
const DetailPanel = memo(function DetailPanel({
  detail,
  loading,
  onResolveRequest,
  onResolveResponse,
}: {
  detail: ProxyRecordDetail | null;
  loading: boolean;
  /** 请求拦截决策回调 */
  onResolveRequest: (id: number, action: 'forward' | 'forwardModified' | 'drop', editedBody?: string) => void;
  /** 响应拦截决策回调 */
  onResolveResponse: (id: number, action: 'forward' | 'forwardModified' | 'drop', editedBody?: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>('headers');
  /** 请求 Body 编辑内容（拦截时可修改） */
  const [editedRequestBody, setEditedRequestBody] = useState('');
  /** 响应 Body 编辑内容（响应拦截时可修改） */
  const [editedResponseBody, setEditedResponseBody] = useState('');

  // 当选中记录变化时，同步编辑内容
  useEffect(() => {
    if (detail) {
      setEditedRequestBody(detail.requestBody ?? '');
      setEditedResponseBody(detail.responseBody ?? '');
    }
  }, [detail?.summary.id, detail?.requestBody, detail?.responseBody]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader className="w-5 h-5 animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Globe className="w-8 h-8 mb-2 opacity-50" />
        <p className="ml-2">选择一条请求查看详情</p>
      </div>
    );
  }

  const isRequestIntercepted = detail.summary.status === 'intercepted';
  const isResponseIntercepted = detail.summary.status === 'responseIntercepted';
  const isEditable = isRequestIntercepted || isResponseIntercepted;

  const tabs: { key: DetailTab; label: string }[] = [
    { key: 'headers', label: 'Headers' },
    { key: 'body', label: 'Body' },
    { key: 'raw', label: 'Raw' },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Tab 栏 */}
      <div className="flex border-b border-border shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
        {/* 摘要信息 */}
        <div className="ml-auto flex items-center gap-2 px-3 text-xs text-muted-foreground">
          <MethodBadge method={detail.summary.method} />
          <span className="truncate max-w-[200px]">{detail.summary.url}</span>
          {detail.summary.statusCode && (
            <span className={`font-mono ${
              detail.summary.statusCode >= 400 ? 'text-red-500' : 'text-green-500'
            }`}>
              {detail.summary.statusCode}
            </span>
          )}
          {/* 拦截状态标记 */}
          {isEditable && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              isRequestIntercepted
                ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                : 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
            }`}>
              {isRequestIntercepted ? '请求拦截中' : '响应拦截中'}
            </span>
          )}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-auto p-3">
        {activeTab === 'headers' && (
          <div className="space-y-4">
            {/* 请求 Headers */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                请求 Headers
              </h4>
              <HeadersTable headers={detail.requestHeaders} />
            </div>
            {/* 响应 Headers */}
            {Object.keys(detail.responseHeaders).length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                  响应 Headers
                </h4>
                <HeadersTable headers={detail.responseHeaders} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'body' && (
          <div className="space-y-4">
            {/* 请求 Body */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                请求 Body
                {isRequestIntercepted && (
                  <span className="ml-2 text-orange-500 normal-case font-normal">（可编辑）</span>
                )}
              </h4>
              {isRequestIntercepted ? (
                <textarea
                  value={editedRequestBody}
                  onChange={e => setEditedRequestBody(e.target.value)}
                  className="w-full h-[300px] bg-muted/50 rounded-lg p-3 text-xs font-mono resize-y border border-orange-500/30 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                  spellCheck={false}
                />
              ) : detail.requestBody ? (
                <JsonBlock content={detail.requestBody} />
              ) : (
                <p className="text-muted-foreground text-xs">无请求 Body</p>
              )}
            </div>
            {/* 响应 Body */}
            {(isResponseIntercepted || detail.responseBody) && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                  响应 Body
                  {isResponseIntercepted && (
                    <span className="ml-2 text-purple-500 normal-case font-normal">（可编辑）</span>
                  )}
                </h4>
                {isResponseIntercepted ? (
                  <textarea
                    value={editedResponseBody}
                    onChange={e => setEditedResponseBody(e.target.value)}
                    className="w-full h-[300px] bg-muted/50 rounded-lg p-3 text-xs font-mono resize-y border border-purple-500/30 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                    spellCheck={false}
                  />
                ) : detail.responseBody ? (
                  <JsonBlock content={detail.responseBody} />
                ) : null}
              </div>
            )}
            {!detail.requestBody && !detail.responseBody && !isEditable && (
              <p className="text-muted-foreground text-sm">无 Body 数据（总览模式不记录 Body）</p>
            )}
          </div>
        )}

        {activeTab === 'raw' && (
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                原始请求
              </h4>
              <pre className="bg-muted/50 rounded-lg p-3 text-xs font-mono overflow-auto max-h-[300px] whitespace-pre-wrap break-all">
                {`${detail.summary.method} ${detail.summary.url}\n`}
                {Object.entries(detail.requestHeaders).map(([k, v]) => `${k}: ${v}\n`).join('')}
                {detail.requestBody ? `\n${detail.requestBody}` : ''}
              </pre>
            </div>
            {(detail.responseBody || Object.keys(detail.responseHeaders).length > 0) && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                  原始响应
                </h4>
                <pre className="bg-muted/50 rounded-lg p-3 text-xs font-mono overflow-auto max-h-[300px] whitespace-pre-wrap break-all">
                  {detail.summary.statusCode ? `HTTP ${detail.summary.statusCode}\n` : ''}
                  {Object.entries(detail.responseHeaders).map(([k, v]) => `${k}: ${v}\n`).join('')}
                  {detail.responseBody ? `\n${detail.responseBody}` : ''}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* 错误信息 */}
        {detail.errorMessage && (
          <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{detail.errorMessage}</span>
            </div>
          </div>
        )}
      </div>

      {/* ======== 详情面板底部：拦截决策按钮 ======== */}
      {isRequestIntercepted && (
        <div className="border-t border-border p-3 bg-card shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-medium text-muted-foreground">请求拦截决策</span>
            <div className="flex-1" />
            <motion.button
              onClick={() => onResolveRequest(detail.summary.id, 'forward')}
              className="px-3 py-1.5 rounded text-xs font-medium bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25 transition-colors flex items-center gap-1"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Check className="w-3 h-3" />
              放行
            </motion.button>
            {editedRequestBody !== (detail.requestBody ?? '') && (
              <motion.button
                onClick={() => onResolveRequest(detail.summary.id, 'forwardModified', editedRequestBody)}
                className="px-3 py-1.5 rounded text-xs font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 hover:bg-blue-500/25 transition-colors flex items-center gap-1"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <ArrowRight className="w-3 h-3" />
                修改放行
              </motion.button>
            )}
            <motion.button
              onClick={() => onResolveRequest(detail.summary.id, 'drop')}
              className="px-3 py-1.5 rounded text-xs font-medium bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25 transition-colors flex items-center gap-1"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <X className="w-3 h-3" />
              丢弃
            </motion.button>
          </div>
        </div>
      )}

      {isResponseIntercepted && (
        <div className="border-t border-border p-3 bg-card shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-purple-500" />
            <span className="text-xs font-medium text-muted-foreground">响应拦截决策</span>
            <div className="flex-1" />
            <motion.button
              onClick={() => onResolveResponse(detail.summary.id, 'forward')}
              className="px-3 py-1.5 rounded text-xs font-medium bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25 transition-colors flex items-center gap-1"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Check className="w-3 h-3" />
              放行
            </motion.button>
            {editedResponseBody !== (detail.responseBody ?? '') && (
              <motion.button
                onClick={() => onResolveResponse(detail.summary.id, 'forwardModified', editedResponseBody)}
                className="px-3 py-1.5 rounded text-xs font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 hover:bg-blue-500/25 transition-colors flex items-center gap-1"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <ArrowRight className="w-3 h-3" />
                修改放行
              </motion.button>
            )}
            <motion.button
              onClick={() => onResolveResponse(detail.summary.id, 'drop')}
              className="px-3 py-1.5 rounded text-xs font-medium bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25 transition-colors flex items-center gap-1"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <X className="w-3 h-3" />
              丢弃
            </motion.button>
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Headers 表格组件
 * 以键值对形式展示 HTTP headers
 */
function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-xs">无 Headers</p>;
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {entries.map(([key, value], i) => (
        <div
          key={key}
          className={`flex text-xs ${i > 0 ? 'border-t border-border' : ''}`}
        >
          <div className="w-[180px] shrink-0 px-3 py-1.5 bg-muted/30 font-mono font-medium text-foreground truncate">
            {key}
          </div>
          <div className="flex-1 px-3 py-1.5 font-mono text-muted-foreground break-all">
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * JSON 内容块
 * 尝试格式化 JSON，失败则原样显示
 */
function JsonBlock({ content }: { content: string }) {
  let formatted = content;
  try {
    const parsed = JSON.parse(content);
    formatted = JSON.stringify(parsed, null, 2);
  } catch {
    // 非 JSON 内容，保持原样
  }

  return (
    <pre className="bg-muted/50 rounded-lg p-3 text-xs font-mono overflow-auto max-h-[400px] whitespace-pre-wrap break-all">
      {formatted}
    </pre>
  );
}

// ============ 主组件 ============

/**
 * ProxyPanel 组件属性
 */
interface ProxyPanelProps {
  /** 关闭代理面板的回调，返回 ChatView */
  onClose: () => void;
  /** 侧边栏是否折叠 */
  sidebarCollapsed: boolean;
  /** 展开侧边栏的回调 */
  onExpandSidebar: () => void;
}

/**
 * ProxyPanel - 中转抓包代理面板
 *
 * 作为 ChatView 的替代视图，提供完整的 HTTP 代理管理功能。
 * 通过 Tauri Events 接收实时请求/响应数据，通过 invoke 调用控制代理。
 */
export const ProxyPanel = memo(function ProxyPanel({
  onClose,
  sidebarCollapsed,
  onExpandSidebar,
}: ProxyPanelProps) {
  // ---- 代理状态 ----
  /** 代理运行状态 */
  const [status, setStatus] = useState<ProxyStatus>({
    running: false,
    port: null,
    mode: 'overview',
    upstreamUrl: null,
    pendingIntercepts: 0,
  });
  /** 端口输入值（空字符串表示自动检测） */
  const [portInput, setPortInput] = useState('');
  /** 操作进行中标记（防止重复点击） */
  const [actionLoading, setActionLoading] = useState(false);
  /** 错误信息 */
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ---- 记录列表 ----
  /** 请求记录列表 */
  const [records, setRecords] = useState<ProxyRecord[]>([]);
  /** 选中的记录 ID */
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);
  /** 选中记录的详情 */
  const [selectedDetail, setSelectedDetail] = useState<ProxyRecordDetail | null>(null);
  /** 详情加载中 */
  const [detailLoading, setDetailLoading] = useState(false);

  // ---- refs ----
  /** 轮询定时器 */
  const pollTimerRef = useRef<ReturnType<typeof setInterval>>(null);
  /**
   * 正在解决中的记录 ID 集合
   * 用于防止 refreshRecords/事件回调 覆盖乐观更新的状态。
   * 当用户点击放行/丢弃后，该 ID 被加入集合；
   * refreshRecords 获取后端数据时，如果记录已不在 intercepted/responseIntercepted 状态，
   * 则从集合中移除并使用后端数据。
   */
  const resolvingIdsRef = useRef<Set<number>>(new Set());

  // ============ 初始化：获取当前代理状态 ============

  useEffect(() => {
    getProxyStatus()
      .then(s => {
        setStatus(s);
        if (s.port) setPortInput(String(s.port));
      })
      .catch(err => console.error('获取代理状态失败:', err));
  }, []);

  // ============ 事件监听：实时更新 ============

  useEffect(() => {
    // 监听 proxy:request 和 proxy:response 事件，触发记录列表刷新
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      // proxy:request 事件：新请求到达
      const unlisten1 = await listen('proxy:request', () => {
        refreshRecords();
      });
      unlisteners.push(unlisten1);

      // proxy:response 事件：响应完成
      const unlisten2 = await listen('proxy:response', () => {
        refreshRecords();
        // 刷新状态（可能有拦截数量变化）
        refreshStatus();
      });
      unlisteners.push(unlisten2);

      // proxy:intercept 事件：新的拦截请求
      const unlisten3 = await listen('proxy:intercept', () => {
        refreshRecords();
        refreshStatus();
      });
      unlisteners.push(unlisten3);

      // proxy:response-intercept 事件：上游响应到达，进入响应拦截
      const unlisten4 = await listen('proxy:response-intercept', () => {
        refreshRecords();
        refreshStatus();
      });
      unlisteners.push(unlisten4);
    };

    setup();

    return () => {
      unlisteners.forEach(fn => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============ 定时轮询记录（作为事件的补充） ============

  useEffect(() => {
    if (status.running) {
      // 代理运行时启动轮询
      pollTimerRef.current = setInterval(refreshRecords, RECORDS_POLL_INTERVAL);
      // 立即加载一次
      refreshRecords();
    } else {
      // 代理停止时停止轮询
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.running]);

  // ============ 操作函数 ============

  /** 刷新记录列表（保护正在解决中的记录状态） */
  const refreshRecords = useCallback(async () => {
    try {
      const recs = await getProxyRecords(0, RECORDS_PAGE_SIZE);
      setRecords(prev => {
        const resolving = resolvingIdsRef.current;
        if (resolving.size === 0) return recs;

        // 合并：对于正在解决中的记录，保留乐观状态；
        // 如果后端已更新为非拦截状态，说明解决完成，移除保护
        const prevMap = new Map(prev.map(r => [r.id, r]));
        return recs.map(r => {
          if (resolving.has(r.id)) {
            if (r.status !== 'intercepted' && r.status !== 'responseIntercepted') {
              // 后端已更新，解除保护
              resolving.delete(r.id);
              return r;
            }
            // 后端还是拦截状态，但我们已经乐观更新了，保留乐观状态
            const optimistic = prevMap.get(r.id);
            return optimistic ?? r;
          }
          return r;
        });
      });
    } catch {
      // 静默失败
    }
  }, []);

  /** 刷新代理状态 */
  const refreshStatus = useCallback(async () => {
    try {
      const s = await getProxyStatus();
      setStatus(s);
    } catch {
      // 静默失败
    }
  }, []);

  /** 启动代理 */
  const handleStart = useCallback(async () => {
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const port = portInput.trim() ? parseInt(portInput.trim(), 10) : undefined;
      if (port !== undefined && (isNaN(port) || port < 1 || port > 65535)) {
        setErrorMsg('端口号无效（1-65535）');
        return;
      }
      const s = await startProxy(port);
      setStatus(s);
      if (s.port) setPortInput(String(s.port));
    } catch (err) {
      setErrorMsg(typeof err === 'string' ? err : String(err));
    } finally {
      setActionLoading(false);
    }
  }, [portInput]);

  /** 停止代理 */
  const handleStop = useCallback(async () => {
    setActionLoading(true);
    setErrorMsg(null);
    try {
      await stopProxy();
      setStatus(prev => ({ ...prev, running: false, port: null, upstreamUrl: null, pendingIntercepts: 0 }));
      // 停止后清空列表选择
      setSelectedRecordId(null);
      setSelectedDetail(null);
    } catch (err) {
      setErrorMsg(typeof err === 'string' ? err : String(err));
    } finally {
      setActionLoading(false);
    }
  }, []);

  /** 切换模式 */
  const handleModeChange = useCallback(async (mode: ProxyMode) => {
    try {
      await setProxyMode(mode);
      setStatus(prev => ({ ...prev, mode }));
    } catch (err) {
      setErrorMsg(typeof err === 'string' ? err : String(err));
    }
  }, []);

  /** 选中一条记录并加载详情 */
  const handleSelectRecord = useCallback(async (id: number) => {
    setSelectedRecordId(id);
    setDetailLoading(true);
    try {
      const detail = await getRecordDetail(id);
      setSelectedDetail(detail);
    } catch {
      setSelectedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  /** 清空所有记录 */
  const handleClear = useCallback(async () => {
    try {
      await clearProxyRecords();
      setRecords([]);
      setSelectedRecordId(null);
      setSelectedDetail(null);
    } catch (err) {
      console.error('清空记录失败:', err);
    }
  }, []);

  /** 导出记录为 JSON */
  const handleExport = useCallback(async () => {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');

      const json = await exportProxyRecords();
      const filePath = await save({
        defaultPath: 'proxy-records.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (filePath) {
        await writeTextFile(filePath, json);
      }
    } catch (err) {
      console.error('导出记录失败:', err);
    }
  }, []);

  /**
   * 乐观更新：立即将指定记录从"已拦截"状态移除
   *
   * 点击放行/丢弃后，先更新本地 UI（按钮立刻消失），
   * 再异步调用后端。通过 resolvingIdsRef 防止后续 refreshRecords 覆盖。
   */
  const optimisticResolve = useCallback((id: number, newStatus: RecordStatus) => {
    // 将 ID 加入保护集合，防止 refreshRecords 覆盖
    resolvingIdsRef.current.add(id);
    setRecords(prev => prev.map(r =>
      r.id === id ? { ...r, status: newStatus } : r
    ));
    setStatus(prev => ({
      ...prev,
      pendingIntercepts: Math.max(0, prev.pendingIntercepts - 1),
    }));
  }, []);

  /** 处理拦截决策：放行 */
  const handleForward = useCallback(async (id: number) => {
    // 乐观更新：立即将记录标记为 pending（等待上游响应），按钮消失
    optimisticResolve(id, 'pending');
    try {
      await resolveIntercept(id, { type: 'forward' });
    } catch (err) {
      setErrorMsg(`放行失败: ${err}`);
    }
    // 异步刷新以获取最终状态
    refreshRecords();
    refreshStatus();
  }, [optimisticResolve, refreshRecords, refreshStatus]);

  /** 处理拦截决策：丢弃 */
  const handleDrop = useCallback(async (id: number) => {
    // 乐观更新：立即将记录标记为 dropped，按钮消失
    optimisticResolve(id, 'dropped');
    try {
      await resolveIntercept(id, { type: 'drop', statusCode: 403 });
    } catch (err) {
      setErrorMsg(`丢弃失败: ${err}`);
    }
    // 异步刷新以获取最终状态
    refreshRecords();
    refreshStatus();
  }, [optimisticResolve, refreshRecords, refreshStatus]);

  /**
   * 详情面板请求拦截决策回调
   * 支持放行、修改放行、丢弃三种操作
   */
  const handleDetailResolveRequest = useCallback(async (
    id: number,
    action: 'forward' | 'forwardModified' | 'drop',
    editedBody?: string,
  ) => {
    if (action === 'forward') {
      optimisticResolve(id, 'pending');
      try {
        await resolveIntercept(id, { type: 'forward' });
      } catch (err) {
        setErrorMsg(`放行失败: ${err}`);
      }
    } else if (action === 'forwardModified') {
      optimisticResolve(id, 'pending');
      try {
        await resolveIntercept(id, { type: 'forwardModified', body: editedBody });
      } catch (err) {
        setErrorMsg(`修改放行失败: ${err}`);
      }
    } else {
      optimisticResolve(id, 'dropped');
      try {
        await resolveIntercept(id, { type: 'drop', statusCode: 403 });
      } catch (err) {
        setErrorMsg(`丢弃失败: ${err}`);
      }
    }
    refreshRecords();
    refreshStatus();
  }, [optimisticResolve, refreshRecords, refreshStatus]);

  /**
   * 详情面板响应拦截决策回调
   * 支持放行、修改放行、丢弃三种操作
   */
  const handleDetailResolveResponse = useCallback(async (
    id: number,
    action: 'forward' | 'forwardModified' | 'drop',
    editedBody?: string,
  ) => {
    if (action === 'forward') {
      optimisticResolve(id, 'completed');
      try {
        await resolveResponseIntercept(id, { type: 'forward' });
      } catch (err) {
        setErrorMsg(`响应放行失败: ${err}`);
      }
    } else if (action === 'forwardModified') {
      optimisticResolve(id, 'completed');
      try {
        await resolveResponseIntercept(id, { type: 'forwardModified', body: editedBody });
      } catch (err) {
        setErrorMsg(`响应修改放行失败: ${err}`);
      }
    } else {
      optimisticResolve(id, 'dropped');
      try {
        await resolveResponseIntercept(id, { type: 'drop', statusCode: 502 });
      } catch (err) {
        setErrorMsg(`响应丢弃失败: ${err}`);
      }
    }
    refreshRecords();
    refreshStatus();
  }, [optimisticResolve, refreshRecords, refreshStatus]);

  // ============ 渲染 ============

  /** 待处理的拦截请求（包括请求拦截和响应拦截） */
  const interceptedRecords = records.filter(
    r => r.status === 'intercepted' || r.status === 'responseIntercepted'
  );

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0">
      {/* ======== 控制栏 ======== */}
      <div className="p-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          {/* 侧边栏展开按钮（侧边栏折叠时显示） */}
          {sidebarCollapsed && (
            <motion.button
              onClick={onExpandSidebar}
              className="p-2 rounded-lg hover:bg-accent transition-colors shrink-0"
              title="展开侧边栏"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <ChevronLeft className="w-5 h-5 rotate-180" />
            </motion.button>
          )}

          {/* 返回按钮 */}
          <motion.button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent transition-colors shrink-0"
            title="返回聊天"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <ChevronLeft className="w-5 h-5" />
          </motion.button>

          {/* 标题 */}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Globe className="w-5 h-5" />
              中转抓包
            </h2>
          </div>

          {/* 间距填充 */}
          <div className="flex-1" />

          {/* 状态指示 */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusDot running={status.running} />
            <span>{status.running ? '运行中' : '已停止'}</span>
            {status.running && status.port && (
              <span className="font-mono text-xs">:{status.port}</span>
            )}
            {status.pendingIntercepts > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400 text-xs font-medium">
                待处理 {status.pendingIntercepts}
              </span>
            )}
          </div>

          {/* 清空记录 */}
          <motion.button
            onClick={handleClear}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title="清空记录"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Trash2 className="w-4 h-4" />
          </motion.button>

          {/* 导出记录 */}
          <motion.button
            onClick={handleExport}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title="导出记录"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Download className="w-4 h-4" />
          </motion.button>

          {/* 刷新 */}
          <motion.button
            onClick={() => { refreshRecords(); refreshStatus(); }}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title="刷新"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <RefreshCw className="w-4 h-4" />
          </motion.button>
        </div>

        {/* 第二行：启动/停止、模式切换、端口设置 */}
        <div className="flex items-center gap-3 mt-3">
          {/* 启动/停止按钮 */}
          <motion.button
            onClick={status.running ? handleStop : handleStart}
            disabled={actionLoading}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
              status.running
                ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            } ${actionLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            whileHover={actionLoading ? {} : { scale: 1.02 }}
            whileTap={actionLoading ? {} : { scale: 0.98 }}
          >
            {actionLoading ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : status.running ? (
              <Square className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {status.running ? '停止' : '启动'}
          </motion.button>

          {/* 模式切换 */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(Object.entries(MODE_CONFIG) as [ProxyMode, typeof MODE_CONFIG['overview']][]).map(
              ([mode, config]) => {
                const Icon = config.icon;
                const isActive = status.mode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => handleModeChange(mode)}
                    disabled={!status.running}
                    title={config.desc}
                    className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent text-muted-foreground'
                    } ${!status.running ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {config.label}
                  </button>
                );
              }
            )}
          </div>

          {/* 端口输入 */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">端口:</label>
            <input
              type="text"
              value={portInput}
              onChange={e => setPortInput(e.target.value)}
              disabled={status.running}
              placeholder="自动"
              className={`w-20 px-2 py-1 rounded border border-border bg-background text-sm font-mono
                focus:outline-none focus:ring-1 focus:ring-primary
                ${status.running ? 'opacity-50 cursor-not-allowed' : ''}`}
            />
          </div>

          {/* 上游 URL 显示 */}
          {status.upstreamUrl && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ArrowRight className="w-3.5 h-3.5" />
              <span className="font-mono truncate max-w-[300px]">{status.upstreamUrl}</span>
            </div>
          )}
        </div>

        {/* 错误信息 */}
        <AnimatePresence>
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
              <button onClick={() => setErrorMsg(null)} className="ml-auto p-0.5 hover:bg-destructive/20 rounded">
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ======== 主内容区：请求列表 + 详情面板 ======== */}
      <div className="flex-1 flex min-h-0">
        {/* 左侧：请求列表 */}
        <div className="w-[360px] shrink-0 border-r border-border flex flex-col">
          {/* 列表头 */}
          <div className="px-3 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground flex items-center">
            <span className="w-[60px]">状态</span>
            <span className="w-[50px]">方法</span>
            <span className="flex-1">URL</span>
            <span className="w-[50px] text-right">耗时</span>
          </div>

          {/* 记录列表 */}
          <div className="flex-1 overflow-auto">
            {records.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
                {status.running ? (
                  <>
                    <Loader className="w-6 h-6 animate-spin mb-2 opacity-50" />
                    <p>等待请求...</p>
                  </>
                ) : (
                  <>
                    <Radio className="w-6 h-6 mb-2 opacity-50" />
                    <p>启动代理后开始抓包</p>
                  </>
                )}
              </div>
            ) : (
              records.map(record => (
                <button
                  key={record.id}
                  onClick={() => handleSelectRecord(record.id)}
                  className={`w-full px-3 py-2 flex items-center text-xs hover:bg-accent/50 transition-colors border-b border-border/50 ${
                    selectedRecordId === record.id ? 'bg-accent' : ''
                  }`}
                >
                  {/* 状态标识 */}
                  <span className="w-[60px] shrink-0">
                    <StatusBadge status={record.status} />
                  </span>
                  {/* HTTP 方法 */}
                  <span className="w-[50px] shrink-0">
                    <MethodBadge method={record.method} />
                  </span>
                  {/* URL（截断） */}
                  <span className="flex-1 truncate text-left font-mono text-muted-foreground">
                    {record.url}
                  </span>
                  {/* 耗时 */}
                  <span className="w-[50px] text-right text-muted-foreground shrink-0">
                    {record.durationMs != null ? (
                      <span className="flex items-center justify-end gap-0.5">
                        <Clock className="w-3 h-3" />
                        {record.durationMs}ms
                      </span>
                    ) : (
                      <span className="text-yellow-500">...</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 右侧：详情面板 */}
        <DetailPanel
          detail={selectedDetail}
          loading={detailLoading}
          onResolveRequest={handleDetailResolveRequest}
          onResolveResponse={handleDetailResolveResponse}
        />
      </div>

      {/* ======== 拦截决策栏（仅拦截模式且有待处理请求时显示） ======== */}
      <AnimatePresence>
        {status.mode === 'intercept' && interceptedRecords.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-border bg-card shrink-0"
          >
            <div className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-medium">
                  待处理拦截请求（{interceptedRecords.length}）
                </span>
              </div>
              <div className="space-y-2 max-h-[150px] overflow-auto">
                {interceptedRecords.map(record => (
                  <div
                    key={record.id}
                    className="flex items-center gap-2 p-2 rounded-lg bg-muted/50"
                  >
                    <MethodBadge method={record.method} />
                    <span className="text-xs font-mono text-muted-foreground truncate flex-1">
                      {record.url}
                    </span>
                    {/* 拦截阶段标识 */}
                    <span className={`text-xs font-medium shrink-0 ${
                      record.status === 'responseIntercepted'
                        ? 'text-purple-500'
                        : 'text-orange-500'
                    }`}>
                      {record.status === 'responseIntercepted' ? '响应' : '请求'}
                    </span>
                    {/* 决策按钮组 */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <motion.button
                        onClick={() => record.status === 'responseIntercepted'
                          ? handleDetailResolveResponse(record.id, 'forward')
                          : handleForward(record.id)
                        }
                        className="px-2.5 py-1 rounded text-xs font-medium bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25 transition-colors flex items-center gap-1"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        title="放行原样转发"
                      >
                        <Check className="w-3 h-3" />
                        放行
                      </motion.button>
                      <motion.button
                        onClick={() => record.status === 'responseIntercepted'
                          ? handleDetailResolveResponse(record.id, 'drop')
                          : handleDrop(record.id)
                        }
                        className="px-2.5 py-1 rounded text-xs font-medium bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25 transition-colors flex items-center gap-1"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        title={record.status === 'responseIntercepted' ? '丢弃响应（返回 502）' : '丢弃请求（返回 403）'}
                      >
                        <X className="w-3 h-3" />
                        丢弃
                      </motion.button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
