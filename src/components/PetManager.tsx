/**
 * @file PetManager.tsx - 宠物管理弹窗组件
 * @description
 * 提供 Claude Code 宠物（/buddy）的查看和管理功能。弹窗包含：
 * - 宠物信息卡片：种族、稀有度、名字、性格、属性值
 * - 「清除宠物记录」按钮（带确认对话框）
 * - 重新孵化提示说明
 *
 * 清除宠物后，用户在 Claude Code 中执行 /buddy 可重新孵化。
 * 注意：骨架（种族、稀有度）由 userId 确定性生成，
 * 清除后重新孵化会得到相同骨架但不同灵魂（名字和性格）。
 *
 * UI 风格与 QuickFixModal 保持一致（全屏覆盖模态框）。
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Trash2, Loader2, CheckCircle, XCircle, AlertTriangle, Sparkles, Star } from 'lucide-react';
import type { Companion, Rarity, Species } from '../types/pet';
import { RARITY_LABELS, RARITY_COLORS, SPECIES_EMOJI, SPECIES_LABELS } from '../types/pet';
import { getCompanion, clearCompanion } from '../utils/claudeData';

// ==================== 常量 ====================

/**
 * 帽子样式的中文显示名称
 */
const HAT_LABELS: Record<string, string> = {
  none: '无',
  crown: '皇冠',
  tophat: '礼帽',
  propeller: '螺旋桨帽',
  halo: '光环',
  wizard: '巫师帽',
  beanie: '毛线帽',
  tinyduck: '小鸭帽',
};

/**
 * 属性名称的中文显示名称
 */
const STAT_LABELS: Record<string, string> = {
  DEBUGGING: '调试力',
  PATIENCE: '耐心值',
  CHAOS: '混乱度',
  WISDOM: '智慧值',
  SNARK: '毒舌值',
};

// ==================== 组件属性 ====================

/**
 * PetManager 组件的属性接口
 */
interface PetManagerProps {
  /** 关闭弹窗的回调函数 */
  onClose: () => void;
}

// ==================== 主组件 ====================

/**
 * 宠物管理弹窗组件
 *
 * 从 Rust 后端加载当前宠物信息，展示宠物卡片。
 * 提供清除宠物记录功能（带二次确认）。
 */
export function PetManager({ onClose }: PetManagerProps) {
  /** 当前宠物信息（null 表示尚未孵化） */
  const [companion, setCompanion] = useState<Companion | null>(null);
  /** 加载状态 */
  const [loading, setLoading] = useState(true);
  /** 是否显示清除确认对话框 */
  const [showConfirm, setShowConfirm] = useState(false);
  /** 清除操作执行中 */
  const [clearing, setClearing] = useState(false);
  /** 操作结果消息（成功/失败） */
  const [resultMessage, setResultMessage] = useState<{ success: boolean; text: string } | null>(null);

  /** 组件挂载时加载宠物信息 */
  useEffect(() => {
    getCompanion()
      .then((data) => {
        setCompanion(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('加载宠物信息失败:', err);
        setLoading(false);
      });
  }, []);

  /**
   * 执行清除宠物记录
   *
   * 调用 Rust 后端删除 ~/.claude.json 中的 companion 字段。
   */
  const handleClear = async () => {
    setClearing(true);
    setResultMessage(null);
    try {
      const result = await clearCompanion();
      setResultMessage({ success: result.success, text: result.message });
      if (result.success) {
        setCompanion(null);
      }
    } catch (err) {
      setResultMessage({ success: false, text: `清除失败: ${err}` });
    } finally {
      setClearing(false);
      setShowConfirm(false);
    }
  };

  /**
   * 格式化孵化时间
   */
  const formatHatchedAt = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            宠物管理
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent transition-colors"
            title="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            /* 加载状态 */
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">正在加载宠物信息...</span>
            </div>
          ) : companion ? (
            /* 已孵化 - 宠物信息卡片 */
            <div className="space-y-4">
              {/* 宠物头部：种族图标 + 名字 + 稀有度 */}
              <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-accent/30">
                {/* 种族大图标 */}
                <div className="text-5xl shrink-0">
                  {SPECIES_EMOJI[companion.species as Species] || '?'}
                </div>
                <div className="min-w-0">
                  {/* 名字 + 闪光标记 */}
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold text-foreground truncate">
                      {companion.name}
                    </h3>
                    {companion.shiny && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-500">
                        <Star className="w-3 h-3" fill="currentColor" /> 闪光
                      </span>
                    )}
                  </div>
                  {/* 稀有度 + 种族 */}
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{
                        color: RARITY_COLORS[companion.rarity as Rarity],
                        backgroundColor: `color-mix(in srgb, ${RARITY_COLORS[companion.rarity as Rarity]} 15%, transparent)`,
                      }}
                    >
                      {companion.rarityStars} {RARITY_LABELS[companion.rarity as Rarity]}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {SPECIES_LABELS[companion.species as Species] || companion.species}
                    </span>
                  </div>
                  {/* 孵化时间 */}
                  <div className="text-xs text-muted-foreground mt-1">
                    孵化于 {formatHatchedAt(companion.hatchedAt)}
                  </div>
                </div>
              </div>

              {/* 性格描述 */}
              <div className="p-3 rounded-lg border border-border bg-accent/20">
                <div className="text-xs font-medium text-muted-foreground mb-1">性格</div>
                <div className="text-sm text-foreground italic">"{companion.personality}"</div>
              </div>

              {/* 属性值 */}
              <div className="p-3 rounded-lg border border-border bg-accent/20">
                <div className="text-xs font-medium text-muted-foreground mb-2">属性值</div>
                <div className="space-y-2">
                  {Object.entries(companion.stats).map(([name, value]) => (
                    <div key={name} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-16 shrink-0 text-right">
                        {STAT_LABELS[name] || name}
                      </span>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${value}%` }}
                          transition={{ duration: 0.6, delay: 0.1 }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: 'var(--primary)' }}
                        />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground w-8 text-right">
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 外观详情 */}
              <div className="p-3 rounded-lg border border-border bg-accent/20">
                <div className="text-xs font-medium text-muted-foreground mb-2">外观</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">眼睛：</span>
                    <span className="font-mono">{companion.eye}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">帽子：</span>
                    <span>{HAT_LABELS[companion.hat] || companion.hat}</span>
                  </div>
                </div>
              </div>

              {/* 操作结果提示 */}
              <AnimatePresence>
                {resultMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                      resultMessage.success
                        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                        : 'bg-red-500/10 text-red-600 dark:text-red-400'
                    }`}
                  >
                    {resultMessage.success ? (
                      <CheckCircle className="w-4 h-4 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0" />
                    )}
                    {resultMessage.text}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            /* 未孵化 - 空状态提示 */
            <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
              <div className="text-5xl opacity-30">?</div>
              <div>
                <div className="text-lg font-medium text-foreground">尚未孵化宠物</div>
                <div className="text-sm text-muted-foreground mt-1">
                  在 Claude Code 中输入 <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">/buddy</code> 即可孵化你的专属宠物
                </div>
              </div>
              {/* 操作结果提示（清除后显示） */}
              <AnimatePresence>
                {resultMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                      resultMessage.success
                        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                        : 'bg-red-500/10 text-red-600 dark:text-red-400'
                    }`}
                  >
                    {resultMessage.success ? (
                      <CheckCircle className="w-4 h-4 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0" />
                    )}
                    {resultMessage.text}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        {!loading && companion && (
          <div className="p-4 border-t border-border shrink-0 space-y-2">
            {/* 清除确认对话框 */}
            <AnimatePresence>
              {showConfirm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <div className="font-medium text-amber-600 dark:text-amber-400">确认清除宠物记录？</div>
                      <div className="text-muted-foreground mt-1">
                        此操作将删除 <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">~/.claude.json</code> 中的宠物数据。
                        清除后在 Claude Code 中执行 <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">/buddy</code> 可重新孵化。
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        注意：种族和稀有度由账号确定，不会改变。只有名字和性格会重新生成。
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={handleClear}
                          disabled={clearing}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                        >
                          {clearing ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                          {clearing ? '清除中...' : '确认清除'}
                        </button>
                        <button
                          onClick={() => setShowConfirm(false)}
                          disabled={clearing}
                          className="px-3 py-1.5 rounded-lg text-sm hover:bg-accent transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 清除按钮 */}
            {!showConfirm && (
              <button
                onClick={() => setShowConfirm(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                清除宠物记录
              </button>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
