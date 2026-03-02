/**
 * @file NewMessageEditor.tsx - 新消息编辑器组件
 * @description
 * 拖拽添加消息功能的编辑器组件，嵌入消息列表中的对应位置。
 * 分为两个阶段：
 * - Phase A（类型选择）：展示所有可用的 Claude Code 消息类型供用户选择
 * - Phase B（内容编辑）：根据选定类型显示对应的编辑界面
 *
 * 首次编辑完成保存后才通过 Rust 后端持久化到 JSONL 文件。
 *
 * ## 支持的消息类型
 * - user：用户消息
 * - assistant：助手消息
 * - file-history-snapshot：文件历史快照
 * - queue-operation：队列操作
 * - custom-title：自定义标题
 * - tag：标签
 *
 * 使用 motion/react 实现入场动画和阶段切换过渡效果。
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User, Bot, Archive, Terminal, FileText, Lightbulb,
  ArrowLeft, Save, X,
} from 'lucide-react';

/**
 * 消息类型配置项
 * 定义每种消息类型的图标、标签和颜色
 */
interface MessageTypeConfig {
  /** 消息类型标识符 */
  type: string;
  /** lucide-react 图标组件 */
  icon: React.ComponentType<{ className?: string }>;
  /** 中文显示标签 */
  label: string;
  /** Tailwind CSS 颜色类（用于选中后的徽章） */
  color: string;
}

/** 所有可选的消息类型配置 */
const MESSAGE_TYPES: MessageTypeConfig[] = [
  { type: 'user', icon: User, label: '用户消息', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  { type: 'assistant', icon: Bot, label: '助手消息', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
  { type: 'file-history-snapshot', icon: Archive, label: '文件快照', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  { type: 'queue-operation', icon: Terminal, label: '队列操作', color: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  { type: 'custom-title', icon: FileText, label: '自定义标题', color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400' },
  { type: 'tag', icon: Lightbulb, label: '标签', color: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
];

/**
 * file-history-snapshot 类型的 JSON 模板
 * 预填充基本结构，用户可修改具体内容
 */
const FILE_SNAPSHOT_TEMPLATE = JSON.stringify({
  messageId: '',
  snapshot: {
    messageId: '',
    trackedFileBackups: {},
    timestamp: new Date().toISOString(),
  },
  isSnapshotUpdate: false,
}, null, 2);

/**
 * queue-operation 类型的 JSON 模板
 */
const QUEUE_OPERATION_TEMPLATE = JSON.stringify({
  operation: 'enqueue',
  data: {},
}, null, 2);

/**
 * NewMessageEditor 组件的属性接口
 */
interface NewMessageEditorProps {
  /** 当前会话 ID */
  sessionId: string;
  /** 新消息将插入到此 UUID 消息之后（空字符串表示插入到开头） */
  afterUuid: string;
  /** 保存回调：前端构造完整 SessionMessage 后调用 */
  onSave: (afterUuid: string, message: Record<string, unknown>) => Promise<void>;
  /** 取消回调：关闭编辑器 */
  onCancel: () => void;
}

/**
 * NewMessageEditor - 新消息类型选择 + 内容编辑组件
 *
 * 两阶段交互流程：
 * 1. Phase A：选择消息类型（6 种类型按钮网格）
 * 2. Phase B：编辑消息内容（根据类型显示不同编辑界面）
 * 保存时构造完整的 SessionMessage 对象并通过回调持久化
 */
export function NewMessageEditor({ sessionId, afterUuid, onSave, onCancel }: NewMessageEditorProps) {
  console.log('[NewMessageEditor] MOUNT/RENDER, afterUuid:', afterUuid);
  /** 当前阶段：'select' = 类型选择，'edit' = 内容编辑 */
  const [phase, setPhase] = useState<'select' | 'edit'>('select');
  /** 用户选定的消息类型 */
  const [selectedType, setSelectedType] = useState<string | null>(null);
  /** 编辑器中的文本内容 */
  const [content, setContent] = useState('');
  /** 是否正在保存（防止重复提交） */
  const [saving, setSaving] = useState(false);

  /**
   * 处理类型选择
   * 选定类型后进入编辑阶段，并根据类型预填充内容模板
   */
  const handleTypeSelect = useCallback((type: string) => {
    setSelectedType(type);
    // 根据类型预填充编辑内容
    switch (type) {
      case 'file-history-snapshot':
        setContent(FILE_SNAPSHOT_TEMPLATE);
        break;
      case 'queue-operation':
        setContent(QUEUE_OPERATION_TEMPLATE);
        break;
      default:
        setContent('');
    }
    setPhase('edit');
  }, []);

  /**
   * 返回类型选择阶段
   * 重置编辑内容
   */
  const handleBackToSelect = useCallback(() => {
    setPhase('select');
    setContent('');
    setSelectedType(null);
  }, []);

  /**
   * 构造完整的 SessionMessage 并保存
   *
   * 根据选定的消息类型构造不同结构的 SessionMessage：
   * - user/assistant：包含 message.role 和 message.content
   * - custom-title/tag：直接设置 title 和 content 字段
   * - file-history-snapshot/queue-operation：解析 JSON 内容
   */
  const handleSave = useCallback(async () => {
    if (!selectedType || saving) return;
    setSaving(true);

    try {
      const uuid = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      // 构造基础消息结构
      const baseMessage: Record<string, unknown> = {
        type: selectedType,
        uuid,
        parentUuid: afterUuid || null,
        isSidechain: false,
        sessionId,
        timestamp,
      };

      // 根据类型填充特定字段
      switch (selectedType) {
        case 'user':
          baseMessage.message = {
            role: 'user',
            content: content,
          };
          break;

        case 'assistant':
          baseMessage.message = {
            role: 'assistant',
            content: [{ type: 'text', text: content }],
          };
          break;

        case 'custom-title':
          // custom-title 类型的 content 直接是标题文本
          baseMessage.title = content;
          break;

        case 'tag':
          // tag 类型只需要一个简单的值
          baseMessage.value = content;
          break;

        case 'file-history-snapshot':
          // 尝试解析用户输入的 JSON，失败则使用原始文本
          try {
            const parsed = JSON.parse(content);
            Object.assign(baseMessage, parsed);
          } catch {
            // JSON 解析失败时保留原始文本作为 content
            baseMessage.content = content;
          }
          break;

        case 'queue-operation':
          try {
            const parsed = JSON.parse(content);
            Object.assign(baseMessage, parsed);
          } catch {
            baseMessage.content = content;
          }
          break;
      }

      await onSave(afterUuid, baseMessage);
    } catch (err) {
      console.error('插入消息失败:', err);
    } finally {
      setSaving(false);
    }
  }, [selectedType, content, afterUuid, sessionId, saving, onSave]);

  /** 获取当前选定类型的配置信息 */
  const selectedTypeConfig = MESSAGE_TYPES.find(t => t.type === selectedType);

  /**
   * 判断当前类型是否使用多行文本域编辑
   * user/assistant/file-history-snapshot/queue-operation 使用 textarea
   * custom-title/tag 使用单行 input
   */
  const useTextarea = selectedType !== 'custom-title' && selectedType !== 'tag';

  return (
    <div
      className="rounded-xl border-2 border-primary/40 bg-card shadow-lg overflow-hidden"
    >
      <AnimatePresence mode="wait">
        {phase === 'select' ? (
          /* ==================== Phase A: 类型选择 ==================== */
          <div
            key="select"
            className="p-4"
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">选择消息类型</h3>
              <button
                onClick={onCancel}
                className="p-1 rounded-md hover:bg-accent transition-colors text-muted-foreground"
                title="取消"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 类型按钮网格：2 列 3 行 */}
            <div className="grid grid-cols-2 gap-2">
              {MESSAGE_TYPES.map(({ type, icon: Icon, label, color }) => (
                <motion.button
                  key={type}
                  onClick={() => handleTypeSelect(type)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border/50
                    hover:border-primary/30 hover:bg-accent/50 transition-colors text-left ${color}`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium">{label}</span>
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          /* ==================== Phase B: 内容编辑 ==================== */
          <div
            key="edit"
            className="p-4"
          >
            {/* 顶部：已选类型徽章 + 关闭按钮 */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {selectedTypeConfig && (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${selectedTypeConfig.color}`}>
                    <selectedTypeConfig.icon className="w-3.5 h-3.5" />
                    {selectedTypeConfig.label}
                  </span>
                )}
              </div>
              <button
                onClick={onCancel}
                className="p-1 rounded-md hover:bg-accent transition-colors text-muted-foreground"
                title="取消"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 编辑区域：根据类型使用 textarea 或 input */}
            {useTextarea ? (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={
                  selectedType === 'file-history-snapshot' || selectedType === 'queue-operation'
                    ? '编辑 JSON 内容...'
                    : '输入消息内容...'
                }
                className="w-full h-32 px-3 py-2 rounded-lg border border-border bg-secondary/50
                  text-foreground text-sm resize-y focus:outline-none focus:border-ring
                  font-mono placeholder:text-muted-foreground"
                autoFocus
              />
            ) : (
              <input
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={selectedType === 'custom-title' ? '输入自定义标题...' : '输入标签值...'}
                className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50
                  text-foreground text-sm focus:outline-none focus:border-ring
                  placeholder:text-muted-foreground"
                autoFocus
              />
            )}

            {/* 底部操作按钮 */}
            <div className="flex items-center justify-between mt-3">
              {/* 左侧：返回选择类型 */}
              <button
                onClick={handleBackToSelect}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md
                  text-sm text-muted-foreground hover:text-foreground hover:bg-accent
                  transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                返回
              </button>

              {/* 右侧：取消 + 保存 */}
              <div className="flex items-center gap-2">
                <button
                  onClick={onCancel}
                  className="px-3 py-1.5 rounded-md text-sm text-muted-foreground
                    hover:text-foreground hover:bg-accent transition-colors"
                >
                  取消
                </button>
                <motion.button
                  onClick={handleSave}
                  disabled={saving || !content.trim()}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                    transition-colors ${
                      saving || !content.trim()
                        ? 'bg-primary/50 text-primary-foreground/50 cursor-not-allowed'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90'
                    }`}
                  whileHover={!saving && content.trim() ? { scale: 1.02 } : undefined}
                  whileTap={!saving && content.trim() ? { scale: 0.98 } : undefined}
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving ? '保存中...' : '保存'}
                </motion.button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
