/**
 * @file PluginsManager.tsx - Plugins 管理面板组件
 * @description
 * 提供 Claude Code Plugins 的查看和管理功能。面板包含：
 * - 搜索框：按名称、描述、关键词过滤插件
 * - 插件列表：按 marketplace 分组显示，每个插件显示名称、版本、描述、状态
 * - 启用/禁用开关：切换插件的启用状态（修改 settings.json 的 enabledPlugins）
 * - Marketplace 信息：在底部显示已注册的 marketplace 列表
 *
 * 数据通过 Rust 后端读取，与 Claude Code 源码的 plugins 系统完全一致：
 * - 安装元数据：~/.claude/plugins/installed_plugins.json
 * - 启用状态：~/.claude/settings.json → enabledPlugins
 * - 清单信息：每个插件的 .claude-plugin/plugin.json
 * - Marketplace：~/.claude/plugins/known_marketplaces.json
 *
 * UI 风格复用 SkillsManager / QuickFixModal 的模态框样式，使用项目的 CSS 变量系统。
 */

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Search, ChevronRight, Package, Globe, FolderOpen,
  Shield, ToggleLeft, ToggleRight, ExternalLink, RefreshCw,
  Tag, User, Store, Clock, MapPin
} from 'lucide-react';
import type { PluginInfo, PluginScope, MarketplaceInfo } from '../types/claude';
import { listPlugins, togglePlugin, listMarketplaces } from '../utils/claudeData';

// ==================== 作用域标签配置 ====================

/**
 * 每种插件安装作用域对应的显示配置
 *
 * 用于列表中的徽章颜色和标签文本。
 */
const SCOPE_CONFIG: Record<PluginScope, {
  /** 简短标签（用于徽章） */
  badge: string;
  /** Tailwind 颜色类名 */
  color: string;
  /** 图标组件 */
  icon: typeof Globe;
}> = {
  managed: {
    badge: '管理',
    color: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    icon: Shield,
  },
  user: {
    badge: '全局',
    color: 'bg-primary/15 text-primary',
    icon: Globe,
  },
  project: {
    badge: '项目',
    color: 'bg-green-500/15 text-green-600 dark:text-green-400',
    icon: FolderOpen,
  },
  local: {
    badge: '本地',
    color: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    icon: MapPin,
  },
};

// ==================== 组件属性 ====================

/**
 * PluginsManager 组件的属性接口
 */
interface PluginsManagerProps {
  /** 关闭面板的回调函数 */
  onClose: () => void;
}

// ==================== 主组件 ====================

/**
 * Plugins 管理面板组件
 *
 * 从 Rust 后端加载所有已安装的插件和 marketplace 信息，
 * 提供搜索过滤、启用/禁用切换等功能。
 */
export function PluginsManager({ onClose }: PluginsManagerProps) {
  // ==================== 状态 ====================

  /** 所有插件列表 */
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  /** marketplace 列表 */
  const [marketplaces, setMarketplaces] = useState<MarketplaceInfo[]>([]);
  /** 加载状态 */
  const [loading, setLoading] = useState(true);
  /** 错误信息 */
  const [error, setError] = useState<string | null>(null);
  /** 搜索关键词 */
  const [searchQuery, setSearchQuery] = useState('');
  /** 正在切换状态的插件 ID（用于加载指示） */
  const [togglingId, setTogglingId] = useState<string | null>(null);
  /** 当前展开详情的插件 ID */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ==================== 数据加载 ====================

  /** 初始加载 */
  useEffect(() => {
    loadData();
  }, []);

  /** 从 Rust 后端加载插件和 marketplace 数据 */
  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [pluginList, marketplaceList] = await Promise.all([
        listPlugins(),
        listMarketplaces(),
      ]);
      setPlugins(pluginList);
      setMarketplaces(marketplaceList);
    } catch (err) {
      setError(`加载插件数据失败: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  /** 切换插件启用/禁用状态 */
  async function handleToggle(plugin: PluginInfo) {
    setTogglingId(plugin.id);
    try {
      const result = await togglePlugin(plugin.id, !plugin.enabled);
      if (result.success) {
        // 更新本地状态（避免重新加载整个列表）
        setPlugins(prev =>
          prev.map(p =>
            p.id === plugin.id ? { ...p, enabled: !p.enabled } : p
          )
        );
      }
    } catch (err) {
      console.error('切换插件状态失败:', err);
    } finally {
      setTogglingId(null);
    }
  }

  // ==================== 搜索过滤 ====================

  /** 按搜索关键词过滤后的插件列表 */
  const filteredPlugins = useMemo(() => {
    if (!searchQuery.trim()) return plugins;
    const query = searchQuery.toLowerCase();
    return plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query) ||
        p.marketplace.toLowerCase().includes(query) ||
        (p.description && p.description.toLowerCase().includes(query)) ||
        (p.keywords && p.keywords.some(k => k.toLowerCase().includes(query)))
    );
  }, [plugins, searchQuery]);

  /** 按 marketplace 分组的插件 */
  const groupedPlugins = useMemo(() => {
    const groups: Record<string, PluginInfo[]> = {};
    for (const plugin of filteredPlugins) {
      if (!groups[plugin.marketplace]) {
        groups[plugin.marketplace] = [];
      }
      groups[plugin.marketplace].push(plugin);
    }
    return groups;
  }, [filteredPlugins]);

  /** marketplace 名称列表（按名称排序） */
  const marketplaceNames = useMemo(() => {
    return Object.keys(groupedPlugins).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  }, [groupedPlugins]);

  // ==================== 格式化工具 ====================

  /** 格式化时间为相对时间描述 */
  function formatRelativeTime(isoString?: string): string {
    if (!isoString) return '未知';
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return '今天';
      if (diffDays === 1) return '昨天';
      if (diffDays < 30) return `${diffDays} 天前`;
      if (diffDays < 365) return `${Math.floor(diffDays / 30)} 个月前`;
      return `${Math.floor(diffDays / 365)} 年前`;
    } catch {
      return '未知';
    }
  }

  // ==================== 渲染 ====================

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 面板主体 */}
      <motion.div
        className="relative w-[700px] max-h-[85vh] bg-card rounded-xl shadow-2xl border border-border flex flex-col overflow-hidden"
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Plugins 管理</h2>
            {!loading && (
              <span className="text-xs text-muted-foreground">
                ({plugins.length} 个插件)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 刷新按钮 */}
            <button
              onClick={loadData}
              className="p-1.5 rounded-lg hover:bg-accent transition-colors"
              title="刷新"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {/* 关闭按钮 */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-accent transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 搜索框 */}
        <div className="p-3 border-b border-border shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索插件名称、描述、关键词..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
              autoFocus
            />
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* 加载中 */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <RefreshCw className="w-8 h-8 animate-spin mb-3" />
              <p className="text-sm">正在扫描已安装的插件...</p>
            </div>
          )}

          {/* 错误信息 */}
          {error && (
            <div className="m-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* 空状态 */}
          {!loading && !error && plugins.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Package className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-sm font-medium mb-1">暂无已安装的插件</p>
              <p className="text-xs">
                使用 <code className="px-1.5 py-0.5 bg-muted rounded text-foreground">claude plugin add</code> 命令安装插件
              </p>
            </div>
          )}

          {/* 搜索无结果 */}
          {!loading && !error && plugins.length > 0 && filteredPlugins.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Search className="w-8 h-8 mb-3 opacity-50" />
              <p className="text-sm">没有匹配的插件</p>
            </div>
          )}

          {/* 插件列表（按 marketplace 分组） */}
          {!loading && !error && filteredPlugins.length > 0 && (
            <div className="p-3 space-y-4">
              {marketplaceNames.map(marketplaceName => (
                <div key={marketplaceName}>
                  {/* marketplace 分组标题 */}
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <Store className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {marketplaceName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({groupedPlugins[marketplaceName].length})
                    </span>
                  </div>

                  {/* 插件卡片列表 */}
                  <div className="space-y-1.5">
                    {groupedPlugins[marketplaceName].map(plugin => (
                      <div
                        key={plugin.id}
                        className="rounded-lg border border-border hover:border-primary/30 transition-colors bg-background"
                      >
                        {/* 插件主行 */}
                        <div
                          className="flex items-center gap-3 p-3 cursor-pointer"
                          onClick={() => setExpandedId(expandedId === plugin.id ? null : plugin.id)}
                        >
                          {/* 启用/禁用开关 */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggle(plugin);
                            }}
                            disabled={togglingId === plugin.id}
                            className={`shrink-0 transition-colors ${
                              plugin.enabled
                                ? 'text-primary hover:text-primary/80'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                            title={plugin.enabled ? '点击禁用' : '点击启用'}
                          >
                            {togglingId === plugin.id ? (
                              <RefreshCw className="w-5 h-5 animate-spin" />
                            ) : plugin.enabled ? (
                              <ToggleRight className="w-5 h-5" />
                            ) : (
                              <ToggleLeft className="w-5 h-5" />
                            )}
                          </button>

                          {/* 插件信息 */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-medium truncate ${
                                plugin.enabled ? 'text-foreground' : 'text-muted-foreground'
                              }`}>
                                {plugin.name}
                              </span>
                              {plugin.version && (
                                <span className="text-xs text-muted-foreground shrink-0">
                                  v{plugin.version}
                                </span>
                              )}
                              {/* 作用域徽章 */}
                              {(() => {
                                const config = SCOPE_CONFIG[plugin.scope];
                                return (
                                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${config.color}`}>
                                    {config.badge}
                                  </span>
                                );
                              })()}
                            </div>
                            {plugin.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {plugin.description}
                              </p>
                            )}
                          </div>

                          {/* 展开箭头 */}
                          <ChevronRight className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${
                            expandedId === plugin.id ? 'rotate-90' : ''
                          }`} />
                        </div>

                        {/* 展开详情 */}
                        <AnimatePresence>
                          {expandedId === plugin.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-2 text-xs">
                                {/* 插件 ID */}
                                <div className="flex items-start gap-2">
                                  <span className="text-muted-foreground shrink-0 w-16">ID</span>
                                  <code className="text-foreground bg-muted px-1.5 py-0.5 rounded break-all">
                                    {plugin.id}
                                  </code>
                                </div>

                                {/* 作者 */}
                                {plugin.author && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground shrink-0 w-16">作者</span>
                                    <div className="flex items-center gap-1">
                                      <User className="w-3 h-3" />
                                      <span>{plugin.author.name}</span>
                                      {plugin.author.url && (
                                        <a
                                          href={plugin.author.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-primary hover:underline"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <ExternalLink className="w-3 h-3" />
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* 许可证 */}
                                {plugin.license && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground shrink-0 w-16">许可证</span>
                                    <span>{plugin.license}</span>
                                  </div>
                                )}

                                {/* 关键词 */}
                                {plugin.keywords && plugin.keywords.length > 0 && (
                                  <div className="flex items-start gap-2">
                                    <span className="text-muted-foreground shrink-0 w-16">标签</span>
                                    <div className="flex flex-wrap gap-1">
                                      {plugin.keywords.map(kw => (
                                        <span
                                          key={kw}
                                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-muted rounded text-muted-foreground"
                                        >
                                          <Tag className="w-2.5 h-2.5" />
                                          {kw}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* 链接 */}
                                {(plugin.homepage || plugin.repository) && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground shrink-0 w-16">链接</span>
                                    <div className="flex items-center gap-3">
                                      {plugin.homepage && (
                                        <a
                                          href={plugin.homepage}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-primary hover:underline flex items-center gap-1"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <Globe className="w-3 h-3" />
                                          主页
                                        </a>
                                      )}
                                      {plugin.repository && (
                                        <a
                                          href={plugin.repository}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-primary hover:underline flex items-center gap-1"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <ExternalLink className="w-3 h-3" />
                                          仓库
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* 安装时间 */}
                                {plugin.installedAt && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground shrink-0 w-16">安装于</span>
                                    <div className="flex items-center gap-1">
                                      <Clock className="w-3 h-3 text-muted-foreground" />
                                      <span>{formatRelativeTime(plugin.installedAt)}</span>
                                    </div>
                                  </div>
                                )}

                                {/* 安装路径 */}
                                <div className="flex items-start gap-2">
                                  <span className="text-muted-foreground shrink-0 w-16">路径</span>
                                  <code className="text-muted-foreground bg-muted px-1.5 py-0.5 rounded break-all text-[10px]">
                                    {plugin.installPath}
                                  </code>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Marketplaces 信息区域 */}
              {marketplaces.length > 0 && (
                <div className="mt-6 pt-4 border-t border-border">
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <Store className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">
                      已注册的 Marketplaces ({marketplaces.length})
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {marketplaces.map(mp => (
                      <div
                        key={mp.name}
                        className="flex items-center justify-between p-2 rounded-lg bg-muted/50 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{mp.name}</span>
                          <span className="text-muted-foreground">
                            ({mp.sourceType})
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          {mp.autoUpdate && (
                            <span className="text-primary text-[10px]">自动更新</span>
                          )}
                          <span>{formatRelativeTime(mp.lastUpdated)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="p-3 border-t border-border shrink-0 text-center">
          <p className="text-xs text-muted-foreground">
            使用 <code className="px-1.5 py-0.5 bg-muted rounded text-foreground">claude plugin add &lt;name&gt;</code> 安装新插件
            {' | '}
            <code className="px-1.5 py-0.5 bg-muted rounded text-foreground">claude plugin remove &lt;name&gt;</code> 卸载插件
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
