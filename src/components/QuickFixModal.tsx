/**
 * @file QuickFixModal.tsx - 一键修复弹窗组件
 * @description
 * 提供常见会话问题的一键修复功能。弹窗包含两个视图：
 * - 列表视图：顶部搜索框 + 可滚动修复项列表
 * - 详情视图：问题描述 + 修复方式 + 一键修复按钮
 *
 * 修复执行通过 Rust 后端完成，自动使用 file_guard 双重备份。
 * UI 模式复用 SettingsPanel 的模态框样式。
 */

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, ArrowLeft, Wrench, CheckCircle, XCircle, Loader2, ChevronRight, List, FileText, HardDrive, ShieldAlert } from 'lucide-react';
import type { FixDefinition, FixResult, FixLevel } from '../types/claude';
import { listFixers, executeFixer } from '../utils/claudeData';

/**
 * 档位标注配置
 *
 * 每个档位对应不同的颜色、标签文字、描述和图标，
 * 用于在列表视图和详情视图中直观展示修复项的权限级别。
 */
const LEVEL_BADGES: Record<FixLevel, {
  /** 显示标签（如"条目修复"） */
  label: string;
  /** Tailwind 颜色类名（背景 + 文字） */
  color: string;
  /** 档位功能描述 */
  description: string;
  /** 对应的 lucide-react 图标组件 */
  icon: typeof List;
}> = {
  entry: {
    label: '条目修复',
    color: 'bg-green-500/15 text-green-600 dark:text-green-400',
    description: '仅操作解析后的消息条目，不直接访问文件系统',
    icon: List,
  },
  content: {
    label: '内容修复',
    color: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    description: '读取并修改文件内容，修改后自动覆写',
    icon: FileText,
  },
  file: {
    label: '文件修复',
    color: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    description: '拥有对该会话文件的直接操作权限',
    icon: HardDrive,
  },
  full: {
    label: '特殊修复',
    color: 'bg-red-500/15 text-red-600 dark:text-red-400',
    description: '完全权限，不受路径和文件系统限制',
    icon: ShieldAlert,
  },
};

/**
 * QuickFixModal 组件的属性接口
 */
interface QuickFixModalProps {
  /** 当前会话 JSONL 文件的绝对路径 */
  sessionFilePath: string;
  /** 关闭弹窗的回调函数 */
  onClose: () => void;
  /** 修复完成后刷新会话数据的回调（可选） */
  onSessionUpdate?: () => void;
}

/**
 * 一键修复弹窗组件
 *
 * 从 Rust 后端加载修复项注册表，展示为可搜索的列表。
 * 点击修复项进入详情页面，确认后执行修复。
 */
export function QuickFixModal({
  sessionFilePath,
  onClose,
  onSessionUpdate,
}: QuickFixModalProps) {
  /** 所有可用的修复项列表 */
  const [fixers, setFixers] = useState<FixDefinition[]>([]);
  /** 加载修复项列表时的加载状态 */
  const [loading, setLoading] = useState(true);
  /** 搜索关键词 */
  const [searchQuery, setSearchQuery] = useState('');
  /** 当前选中查看详情的修复项（null 表示列表视图） */
  const [selectedFixer, setSelectedFixer] = useState<FixDefinition | null>(null);
  /** 修复执行中的加载状态 */
  const [executing, setExecuting] = useState(false);
  /** 修复执行结果（null 表示尚未执行） */
  const [result, setResult] = useState<FixResult | null>(null);

  /** 组件挂载时从 Rust 后端加载修复项列表 */
  useEffect(() => {
    listFixers()
      .then((data) => {
        setFixers(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('加载修复项列表失败:', err);
        setLoading(false);
      });
  }, []);

  /**
   * 根据搜索关键词过滤修复项列表
   *
   * 搜索范围包括：name、description、fixMethod、tags
   * 使用大小写不敏感匹配
   */
  const filteredFixers = useMemo(() => {
    if (!searchQuery.trim()) return fixers;

    const query = searchQuery.toLowerCase();
    return fixers.filter((fixer) => {
      return (
        fixer.name.toLowerCase().includes(query) ||
        fixer.description.toLowerCase().includes(query) ||
        fixer.fixMethod.toLowerCase().includes(query) ||
        fixer.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [fixers, searchQuery]);

  /**
   * 执行选中的修复项
   *
   * 调用 Rust 后端的 execute_fixer 命令，执行前后更新加载状态。
   * 成功后通过 onSessionUpdate 回调通知父组件刷新会话数据。
   */
  const handleExecute = async () => {
    if (!selectedFixer || executing) return;

    setExecuting(true);
    setResult(null);

    try {
      const fixResult = await executeFixer(selectedFixer.id, sessionFilePath);
      setResult(fixResult);

      // 修复成功且有实际修改时，通知父组件刷新会话数据
      if (fixResult.success && fixResult.affectedLines > 0) {
        onSessionUpdate?.();
      }
    } catch (err) {
      setResult({
        success: false,
        message: `执行修复失败: ${err}`,
        affectedLines: 0,
      });
    } finally {
      setExecuting(false);
    }
  };

  /**
   * 从详情视图返回列表视图
   *
   * 清除选中状态和执行结果
   */
  const handleBack = () => {
    setSelectedFixer(null);
    setResult(null);
  };

  return (
    /* 模态遮罩层：点击遮罩关闭弹窗 */
    <motion.div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      {/* 弹窗主体：阻止点击冒泡 */}
      <motion.div
        className="bg-card rounded-xl shadow-xl w-[550px] h-[70vh] flex flex-col border border-border overflow-hidden"
        initial={{ scale: 0.95, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 20, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：标题 + 关闭按钮 */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-card shrink-0">
          <div className="flex items-center gap-2">
            {/* 详情视图时显示返回按钮 */}
            {selectedFixer && (
              <motion.button
                onClick={handleBack}
                className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <ArrowLeft className="w-4 h-4" />
              </motion.button>
            )}
            <Wrench className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">
              {selectedFixer ? selectedFixer.name : '一键修复常见问题'}
            </h2>
          </div>
          {/* 关闭按钮 */}
          <motion.button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <AnimatePresence mode="wait">
            {!selectedFixer ? (
              /* 列表视图 */
              <motion.div
                key="list"
                className="flex-1 flex flex-col overflow-hidden"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                {/* 搜索框 */}
                <div className="p-3 border-b border-border shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="搜索问题（名称、描述、标签）..."
                      className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                      autoFocus
                    />
                  </div>
                </div>

                {/* 修复项列表 */}
                <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                  {loading ? (
                    /* 加载中 */
                    <div className="flex items-center justify-center py-12 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      <span className="text-sm">加载修复项...</span>
                    </div>
                  ) : filteredFixers.length === 0 ? (
                    /* 无结果 */
                    <div className="text-center py-12 text-muted-foreground">
                      <Wrench className="w-8 h-8 mx-auto mb-3 opacity-50" />
                      <p className="text-sm">
                        {searchQuery ? '未找到匹配的修复项' : '暂无可用的修复项'}
                      </p>
                    </div>
                  ) : (
                    /* 修复项列表 */
                    <div className="space-y-2">
                      {filteredFixers.map((fixer) => (
                        <motion.button
                          key={fixer.id}
                          onClick={() => setSelectedFixer(fixer)}
                          className="w-full flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-accent/50 transition-colors text-left group"
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                        >
                          <Wrench className="w-4 h-4 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {fixer.name}
                            </p>
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {fixer.fixMethod}
                            </p>
                          </div>
                          {/* 档位徽章：显示该修复项的权限级别 */}
                          {(() => {
                            const badge = LEVEL_BADGES[fixer.level];
                            return (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${badge.color}`}>
                                {badge.label}
                              </span>
                            );
                          })()}
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </motion.button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              /* 详情视图 */
              <motion.div
                key="detail"
                className="flex-1 flex flex-col overflow-hidden"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                {/* 详情内容（可滚动） */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                  {/* 档位说明：在问题描述上方展示该修复项的权限级别和说明 */}
                  {(() => {
                    const badge = LEVEL_BADGES[selectedFixer.level];
                    const IconComp = badge.icon;
                    return (
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs ${badge.color}`}>
                        <IconComp className="w-3.5 h-3.5 shrink-0" />
                        <span className="font-medium">{badge.label}</span>
                        <span className="opacity-75">—</span>
                        <span className="opacity-75">{badge.description}</span>
                      </div>
                    );
                  })()}

                  {/* 问题描述 */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      问题描述
                    </label>
                    <div className="px-3 py-2 rounded-lg bg-muted text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                      {selectedFixer.description}
                    </div>
                  </div>

                  {/* 修复方式 */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      修复方式
                    </label>
                    <div className="px-3 py-2 rounded-lg bg-muted text-sm text-foreground">
                      {selectedFixer.fixMethod}
                    </div>
                  </div>

                  {/* 标签 */}
                  {selectedFixer.tags.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        相关标签
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedFixer.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-mono"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 执行结果 */}
                  {result && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`p-3 rounded-lg border ${
                        result.success
                          ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400'
                          : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {result.success ? (
                          <CheckCircle className="w-4 h-4 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 shrink-0" />
                        )}
                        <span className="text-sm font-medium">
                          {result.success ? '修复完成' : '修复失败'}
                        </span>
                      </div>
                      <p className="text-sm ml-6">{result.message}</p>
                      {result.success && result.affectedLines > 0 && (
                        <p className="text-xs ml-6 mt-1 opacity-75">
                          受影响的消息行数: {result.affectedLines}
                        </p>
                      )}
                    </motion.div>
                  )}
                </div>

                {/* 底部操作栏 */}
                <div className="p-4 border-t border-border shrink-0">
                  <motion.button
                    onClick={handleExecute}
                    disabled={executing || (result?.success && result.affectedLines > 0)}
                    className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                      executing || (result?.success && result.affectedLines > 0)
                        ? 'bg-muted text-muted-foreground cursor-not-allowed'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90'
                    }`}
                    whileHover={
                      executing || (result?.success && result.affectedLines > 0) ? {} : { scale: 1.02 }
                    }
                    whileTap={
                      executing || (result?.success && result.affectedLines > 0) ? {} : { scale: 0.98 }
                    }
                  >
                    {executing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        修复中...
                      </>
                    ) : result?.success && result.affectedLines > 0 ? (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        已修复
                      </>
                    ) : (
                      <>
                        <Wrench className="w-4 h-4" />
                        一键修复
                      </>
                    )}
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
