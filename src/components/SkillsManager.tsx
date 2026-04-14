/**
 * @file SkillsManager.tsx - Skills 管理面板组件
 * @description
 * 提供 Claude Code Skills 的查看和管理功能。面板包含两个视图：
 * - 列表视图：顶部搜索框 + 分组显示的 skills 列表（全局/项目级/旧版命令）
 * - 详情视图：skill 的完整 frontmatter 信息 + markdown prompt 内容
 *
 * Skills 数据通过 Rust 后端扫描获取，读取逻辑与 Claude Code 源码中的
 * `getSkillDirCommands()` 完全一致（扫描路径、文件格式、解析规则）。
 *
 * UI 风格复用 QuickFixModal 的模态框样式，使用项目的 CSS 变量系统。
 */

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Search, ArrowLeft, ChevronRight,
  Zap, FolderOpen, Archive, Globe, Eye, EyeOff,
  FileText, Wrench, Copy, CheckCircle
} from 'lucide-react';
import type { SkillInfo, SkillDetail, SkillSource } from '../types/claude';
import { listSkills, getSkillDetail } from '../utils/claudeData';

// ==================== 来源标签配置 ====================

/**
 * 每种 Skill 来源对应的显示配置
 *
 * 用于列表视图中的分组标题和徽章颜色。
 */
const SOURCE_CONFIG: Record<SkillSource, {
  /** 分组标题 */
  label: string;
  /** 简短标签（用于徽章） */
  badge: string;
  /** Tailwind 颜色类名 */
  color: string;
  /** 图标组件 */
  icon: typeof Zap;
}> = {
  user: {
    label: '全局 Skills',
    badge: '全局',
    color: 'bg-primary/15 text-primary',
    icon: Globe,
  },
  project: {
    label: '项目 Skills',
    badge: '项目',
    color: 'bg-green-500/15 text-green-600 dark:text-green-400',
    icon: FolderOpen,
  },
  legacyCommands: {
    label: '旧版 Commands',
    badge: '旧版',
    color: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    icon: Archive,
  },
  managed: {
    label: '受管理 Skills',
    badge: '管理',
    color: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    icon: Wrench,
  },
  bundled: {
    label: '内置 Skills',
    badge: '内置',
    color: 'bg-gray-500/15 text-gray-600 dark:text-gray-400',
    icon: Zap,
  },
};

// ==================== 组件属性 ====================

/**
 * SkillsManager 组件的属性接口
 */
interface SkillsManagerProps {
  /** 当前项目路径（可选，用于扫描项目级 skills） */
  projectPath?: string;
  /** 关闭面板的回调函数 */
  onClose: () => void;
}

// ==================== 主组件 ====================

/**
 * Skills 管理面板组件
 *
 * 从 Rust 后端加载所有可用的 skills，按来源分组展示。
 * 支持搜索过滤和查看 skill 详情（包含完整的 markdown prompt 内容）。
 */
export function SkillsManager({ projectPath, onClose }: SkillsManagerProps) {
  // ==================== 状态 ====================

  /** 所有 skills 列表 */
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  /** 加载状态 */
  const [loading, setLoading] = useState(true);
  /** 错误信息 */
  const [error, setError] = useState<string | null>(null);
  /** 搜索关键词 */
  const [searchQuery, setSearchQuery] = useState('');
  /** 当前选中查看详情的 skill（null 表示列表视图） */
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  /** skill 详情数据 */
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
  /** 详情加载状态 */
  const [detailLoading, setDetailLoading] = useState(false);
  /** 复制成功提示 */
  const [copied, setCopied] = useState(false);

  // ==================== 数据加载 ====================

  /** 初始加载 skills 列表 */
  useEffect(() => {
    loadSkills();
  }, [projectPath]);

  /** 从 Rust 后端加载 skills */
  async function loadSkills() {
    setLoading(true);
    setError(null);
    try {
      const result = await listSkills(projectPath);
      setSkills(result);
    } catch (err) {
      setError(`加载 Skills 失败: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  /** 加载 skill 详情 */
  async function loadDetail(skill: SkillInfo) {
    setSelectedSkill(skill);
    setDetailLoading(true);
    setSkillDetail(null);
    try {
      const detail = await getSkillDetail(skill.sourcePath);
      setSkillDetail(detail);
    } catch (err) {
      console.error('加载 Skill 详情失败:', err);
    } finally {
      setDetailLoading(false);
    }
  }

  // ==================== 搜索过滤 ====================

  /** 按搜索关键词过滤后的 skills 列表 */
  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const query = searchQuery.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query) ||
        (s.displayName && s.displayName.toLowerCase().includes(query)) ||
        (s.whenToUse && s.whenToUse.toLowerCase().includes(query))
    );
  }, [skills, searchQuery]);

  /** 按来源分组的 skills */
  const groupedSkills = useMemo(() => {
    const groups: Partial<Record<SkillSource, SkillInfo[]>> = {};
    for (const skill of filteredSkills) {
      if (!groups[skill.source]) {
        groups[skill.source] = [];
      }
      groups[skill.source]!.push(skill);
    }
    return groups;
  }, [filteredSkills]);

  /** 分组显示顺序 */
  const sourceOrder: SkillSource[] = ['user', 'project', 'managed', 'bundled', 'legacyCommands'];

  // ==================== 事件处理 ====================

  /** 复制 skill 调用命令到剪贴板 */
  async function copySkillCommand(name: string) {
    try {
      await navigator.clipboard.writeText(`/${name}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板访问失败，静默处理
    }
  }

  // ==================== 渲染 ====================

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* 遮罩层 */}
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />

        {/* 面板主体 */}
        <motion.div
          className="relative w-[720px] max-h-[80vh] bg-popover border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <div className="flex items-center gap-3">
              {selectedSkill && (
                <button
                  onClick={() => { setSelectedSkill(null); setSkillDetail(null); }}
                  className="p-1 rounded hover:bg-accent transition-colors"
                  title="返回列表"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <Zap className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">
                {selectedSkill ? `/${selectedSkill.name}` : 'Skills 管理'}
              </h2>
              {!selectedSkill && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {filteredSkills.length} 个
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-accent transition-colors"
              title="关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 内容区域 */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {selectedSkill ? (
              /* ====== 详情视图 ====== */
              <DetailView
                skill={selectedSkill}
                detail={skillDetail}
                loading={detailLoading}
                copied={copied}
                onCopy={() => copySkillCommand(selectedSkill.name)}
              />
            ) : (
              /* ====== 列表视图 ====== */
              <>
                {/* 搜索栏 */}
                <div className="px-5 py-3 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="搜索 Skills（名称、描述、使用场景）..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-muted/50 border border-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                      autoFocus
                    />
                  </div>
                </div>

                {/* 列表内容 */}
                <div className="px-5 py-3">
                  {loading ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground">
                      <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                      正在扫描 Skills...
                    </div>
                  ) : error ? (
                    <div className="text-center py-12 text-destructive text-sm">{error}</div>
                  ) : filteredSkills.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground text-sm">
                      {searchQuery ? '没有匹配的 Skills' : '未发现任何 Skills'}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {sourceOrder.map((source) => {
                        const group = groupedSkills[source];
                        if (!group || group.length === 0) return null;
                        const config = SOURCE_CONFIG[source];
                        return (
                          <div key={source}>
                            {/* 分组标题 */}
                            <div className="flex items-center gap-2 mb-2">
                              <config.icon className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                {config.label}
                              </span>
                              <span className="text-xs text-muted-foreground">({group.length})</span>
                            </div>
                            {/* Skill 列表项 */}
                            <div className="space-y-1">
                              {group.map((skill) => (
                                <SkillListItem
                                  key={`${source}-${skill.name}`}
                                  skill={skill}
                                  onClick={() => loadDetail(skill)}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ==================== 子组件 ====================

/**
 * Skill 列表项组件
 *
 * 显示 skill 的名称、描述和来源徽章，点击进入详情视图。
 */
function SkillListItem({ skill, onClick }: { skill: SkillInfo; onClick: () => void }) {
  const config = SOURCE_CONFIG[skill.source];

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-accent/50 transition-colors text-left group"
    >
      {/* 左侧：名称和描述 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">
            /{skill.displayName || skill.name}
          </span>
          {/* 来源徽章 */}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${config.color}`}>
            {config.badge}
          </span>
          {/* user-invocable 标记 */}
          {skill.userInvocable ? (
            <Eye className="w-3 h-3 text-muted-foreground shrink-0" title="用户可调用" />
          ) : (
            <EyeOff className="w-3 h-3 text-muted-foreground/50 shrink-0" title="仅模型可调用" />
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {skill.description}
        </p>
      </div>

      {/* 右侧：箭头 */}
      <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-foreground shrink-0 transition-colors" />
    </button>
  );
}

/**
 * Skill 详情视图组件
 *
 * 显示 skill 的完整信息，包括：
 * - 元数据表格（来源、模型、工具、版本等）
 * - Markdown prompt 内容（等宽字体显示原始文本）
 */
function DetailView({
  skill,
  detail,
  loading,
  copied,
  onCopy,
}: {
  skill: SkillInfo;
  detail: SkillDetail | null;
  loading: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const config = SOURCE_CONFIG[skill.source];

  return (
    <div className="px-5 py-4 space-y-4">
      {/* 基本信息卡片 */}
      <div className="space-y-3">
        {/* 名称 + 复制按钮 */}
        <div className="flex items-center gap-2">
          <code className="text-lg font-mono font-semibold text-primary">/{skill.name}</code>
          <button
            onClick={onCopy}
            className="p-1 rounded hover:bg-accent transition-colors"
            title="复制调用命令"
          >
            {copied ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        </div>

        {/* 描述 */}
        <p className="text-sm text-foreground/80">{skill.description}</p>

        {/* 元数据表格 */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <MetaRow label="来源" value={
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${config.color}`}>{config.label}</span>
          } />
          <MetaRow label="用户可调用" value={skill.userInvocable ? '是' : '否'} />
          {skill.model && <MetaRow label="模型" value={skill.model} />}
          {skill.context && <MetaRow label="执行上下文" value={skill.context} />}
          {skill.version && <MetaRow label="版本" value={skill.version} />}
          {skill.allowedTools.length > 0 && (
            <MetaRow label="允许工具" value={skill.allowedTools.join(', ')} />
          )}
          {skill.argumentHint && <MetaRow label="参数提示" value={skill.argumentHint} />}
          {skill.paths && skill.paths.length > 0 && (
            <MetaRow label="路径过滤" value={skill.paths.join(', ')} />
          )}
        </div>

        {/* 使用场景 */}
        {skill.whenToUse && (
          <div className="mt-2">
            <div className="text-xs font-medium text-muted-foreground mb-1">使用场景</div>
            <p className="text-sm text-foreground/80 bg-muted/50 rounded-lg px-3 py-2">
              {skill.whenToUse}
            </p>
          </div>
        )}

        {/* 文件路径 */}
        <div className="text-xs text-muted-foreground font-mono truncate" title={skill.sourcePath}>
          <FileText className="w-3 h-3 inline mr-1" />
          {skill.sourcePath}
        </div>
      </div>

      {/* 分隔线 */}
      <div className="border-t border-border" />

      {/* Markdown 内容 */}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">Skill 内容 (Prompt)</div>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
            加载中...
          </div>
        ) : detail ? (
          <pre className="text-xs font-mono bg-muted/30 border border-border rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words max-h-[40vh]">
            {detail.markdownContent}
          </pre>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            无法加载 Skill 内容
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 元数据行组件
 *
 * 简单的 label-value 对显示。
 */
function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground shrink-0 w-20 text-right">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
