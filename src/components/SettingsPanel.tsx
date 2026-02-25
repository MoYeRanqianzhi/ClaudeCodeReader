import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Palette, Bot, Shield, Info, Eye, EyeOff, Plus, Trash2, Github, Sun, SunMoon, Moon, Wrench, CheckSquare, Square } from 'lucide-react';
import type { ClaudeSettings, EnvProfile, ResumeConfig } from '../types/claude';
import { readResumeConfig, saveResumeConfig } from '../utils/claudeData';

/**
 * 设置面板组件的属性接口
 * 定义了面板所需的全部外部传入参数，包括当前设置、主题、编辑状态以及各种回调函数
 */
interface SettingsPanelProps {
  settings: ClaudeSettings;
  claudeDataPath: string;
  theme: 'light' | 'dark' | 'system';
  editingProfile?: EnvProfile | null;
  onSaveSettings: (settings: ClaudeSettings) => void;
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
  onClose: () => void;
}

/**
 * 设置面板组件
 *
 * 提供应用程序的全局设置管理界面，包含四个标签页：
 * - 常规：主题、默认模型、数据路径配置
 * - 环境变量：Claude Code 运行时的环境变量管理
 * - 权限：操作权限的查看（允许/拒绝列表）
 * - 关于：应用版本、开发者信息、开源地址
 *
 * 使用 motion/react 实现流畅的过渡动画效果
 */
export function SettingsPanel({
  settings,
  claudeDataPath,
  theme,
  editingProfile,
  onSaveSettings,
  onThemeChange,
  onClose,
}: SettingsPanelProps) {
  /** 编辑中的设置副本，避免直接修改外部传入的 settings */
  const [editedSettings, setEditedSettings] = useState<ClaudeSettings>(settings);
  // 如果正在编辑配置，自动切换到环境变量标签页
  const [activeTab, setActiveTab] = useState<'general' | 'env' | 'tools' | 'permissions' | 'about'>(
    editingProfile ? 'env' : 'general'
  );
  /** 标记用户是否修改了设置，用于控制保存按钮的可用状态 */
  const [hasChanges, setHasChanges] = useState(false);
  /** 控制 API 密钥等敏感环境变量值的可见性 */
  const [showApiKey, setShowApiKey] = useState(false);
  /** 一键 Resume 配置（独立于 Claude Code settings，存储在 CCR 配置目录） */
  const [resumeConfig, setResumeConfig] = useState<ResumeConfig>({ flags: [], customArgs: '' });

  /**
   * 可勾选的常用 Claude CLI flag 列表
   * 每项包含 flag 字符串和中文说明
   */
  const RESUME_FLAGS = [
    { flag: '--dangerously-skip-permissions', label: '跳过所有权限检查（仅限沙箱环境）' },
    { flag: '--verbose', label: '启用详细输出模式' },
    { flag: '--debug', label: '启用调试模式' },
    { flag: '--no-chrome', label: '禁用 Chrome 集成' },
  ];

  /**
   * 主题三模式选项配置
   * 每项包含值、显示标签和对应的 lucide 图标
   */
  const themeOptions = [
    { value: 'light' as const, label: '浅色', icon: Sun },
    { value: 'system' as const, label: '自动', icon: SunMoon },
    { value: 'dark' as const, label: '深色', icon: Moon },
  ];

  /** 当外部 settings 变化时，同步更新编辑副本 */
  useEffect(() => {
    setEditedSettings(settings);
  }, [settings]);

  /** 组件挂载时加载 Resume 配置 */
  useEffect(() => {
    readResumeConfig()
      .then(setResumeConfig)
      .catch((err) => console.error('加载 Resume 配置失败:', err));
  }, []);

  /**
   * 更新指定环境变量的值
   * @param key - 环境变量名称
   * @param value - 环境变量新值
   */
  const handleEnvChange = (key: string, value: string) => {
    setEditedSettings((prev) => ({
      ...prev,
      env: {
        ...prev.env,
        [key]: value,
      },
    }));
    setHasChanges(true);
  };

  /**
   * 移除指定的环境变量
   * @param key - 要移除的环境变量名称
   */
  const handleRemoveEnv = (key: string) => {
    setEditedSettings((prev) => {
      const newEnv = { ...prev.env };
      delete newEnv[key];
      return { ...prev, env: newEnv };
    });
    setHasChanges(true);
  };

  /** 通过浏览器 prompt 对话框添加新的环境变量 */
  const handleAddEnv = () => {
    const key = prompt('输入环境变量名称:');
    if (key) {
      handleEnvChange(key, '');
    }
  };

  /**
   * 更新默认模型设置
   * @param model - 新的模型名称
   */
  const handleModelChange = (model: string) => {
    setEditedSettings((prev) => ({ ...prev, model }));
    setHasChanges(true);
  };

  /** 保存当前编辑的设置并重置变更标记 */
  const handleSave = () => {
    onSaveSettings(editedSettings);
    setHasChanges(false);
  };

  /**
   * 标签页配置数组
   * 每个标签页包含唯一 id、显示标签文字和对应的 lucide 图标组件
   */
  const tabs = [
    { id: 'general', label: '常规', icon: Palette },
    { id: 'env', label: '环境变量', icon: Bot },
    { id: 'tools', label: '工具', icon: Wrench },
    { id: 'permissions', label: '权限', icon: Shield },
    { id: 'about', label: '关于', icon: Info },
  ] as const;

  return (
    /* 模态遮罩层：点击遮罩关闭面板，带有背景模糊和淡入淡出动画 */
    <motion.div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      {/* 面板主体：阻止点击冒泡以防误关闭，带有缩放和位移入场动画 */}
      <motion.div
        className="bg-card rounded-xl shadow-xl w-[600px] h-[80vh] flex flex-col border border-border overflow-hidden"
        initial={{ scale: 0.95, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 20, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：显示面板标题和关闭按钮 */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-card shrink-0">
          <h2 className="text-lg font-semibold text-foreground">
            {editingProfile ? `编辑配置: ${editingProfile.name}` : '设置'}
          </h2>
          {/* 关闭按钮：使用 lucide X 图标，带有悬停和点击缩放动画 */}
          <motion.button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>

        {/* 标签页导航栏：水平排列的标签按钮，活动标签下方有动画指示条 */}
        <div className="flex border-b border-border relative">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <motion.button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {/* 活动标签指示条：使用 layoutId 实现跨标签的滑动动画 */}
                {activeTab === tab.id && (
                  <motion.div
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                    layoutId="activeTab"
                  />
                )}
              </motion.button>
            );
          })}
        </div>

        {/* 内容区域：根据活动标签显示对应的设置内容，使用 AnimatePresence 实现切换动画 */}
        <div className="flex-1 overflow-x-hidden overflow-y-auto p-4 custom-scrollbar">
          <AnimatePresence mode="wait">
            {/* 常规设置标签页：主题选择、模型配置、数据路径 */}
            {activeTab === 'general' && (
              <motion.div
                key="general"
                className="space-y-6"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                {/* 主题设置：三模式分段切换按钮（浅色 / 自动 / 深色） */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-3">主题</label>
                  <div className="inline-flex items-center gap-1 p-1 bg-muted rounded-xl border border-border">
                    {themeOptions.map((option) => {
                      const Icon = option.icon;
                      const isActive = theme === option.value;
                      return (
                        <motion.button
                          key={option.value}
                          onClick={() => onThemeChange(option.value)}
                          className="relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
                          whileHover="hover"
                          whileTap={{ scale: 0.95 }}
                        >
                          {/* 活动指示器：使用 layoutId 实现跨按钮的滑动动画 */}
                          {isActive && (
                            <motion.div
                              className="absolute inset-0 bg-card rounded-lg shadow-sm border border-border"
                              layoutId="themeSwitch"
                              transition={{ type: "spring", stiffness: 400, damping: 30 }}
                            />
                          )}
                          {/* 图标容器：悬停时通过 variants 接收父级 "hover" 状态触发旋转动画 */}
                          <motion.div
                            className="relative z-10"
                            variants={{ hover: { rotate: 180 } }}
                            transition={{ type: "spring", stiffness: 300, damping: 15 }}
                          >
                            <Icon
                              className={`w-4 h-4 transition-colors ${
                                isActive ? 'text-primary' : 'text-muted-foreground'
                              }`}
                              strokeWidth={2}
                            />
                          </motion.div>
                          <span
                            className={`relative z-10 transition-colors ${
                              isActive ? 'text-foreground' : 'text-muted-foreground'
                            }`}
                          >
                            {option.label}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {/* 模型设置：文本输入框设置默认使用的 Claude 模型 */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">默认模型</label>
                  <input
                    type="text"
                    value={editedSettings.model || ''}
                    onChange={(e) => handleModelChange(e.target.value)}
                    placeholder="例如: claude-3-opus, sonnet, haiku"
                    className="w-full px-3 py-2 rounded-lg bg-muted text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {/* 数据路径：只读显示当前 Claude 数据存储路径 */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Claude 数据路径</label>
                  <div className="px-3 py-2 rounded-lg bg-muted text-muted-foreground text-sm font-mono">
                    {claudeDataPath}
                  </div>
                </div>
              </motion.div>
            )}

            {/* 环境变量标签页：环境变量的增删改操作 */}
            {activeTab === 'env' && (
              <motion.div
                key="env"
                className="space-y-4"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                {/* 环境变量操作栏：说明文字和添加按钮 */}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">管理 Claude Code 的环境变量</p>
                  {/* 添加环境变量按钮：使用 Plus 图标 */}
                  <motion.button
                    onClick={handleAddEnv}
                    className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors flex items-center gap-1.5"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Plus className="w-4 h-4" />
                    添加变量
                  </motion.button>
                </div>

                {/* 环境变量列表：为空时显示占位提示，否则渲染变量编辑项 */}
                {Object.entries(editedSettings.env || {}).length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    没有设置环境变量
                  </div>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(editedSettings.env || {}).map(([key, value]) => (
                      /* 单个环境变量项：带有背景色和悬停效果的卡片式布局 */
                      <div key={key} className="bg-muted p-3 rounded-lg hover:bg-accent transition-colors">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <label className="block text-xs text-muted-foreground mb-1">{key}</label>
                            <div className="flex items-center gap-2">
                              {/* 环境变量值输入框：敏感字段（含 token/key）默认以密码形式显示 */}
                              <input
                                type={key.toLowerCase().includes('token') || key.toLowerCase().includes('key') ? (showApiKey ? 'text' : 'password') : 'text'}
                                value={value}
                                onChange={(e) => handleEnvChange(key, e.target.value)}
                                className="flex-1 px-3 py-2 rounded-lg bg-muted text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring text-sm font-mono"
                              />
                              {/* 敏感值可见性切换按钮：使用 Eye/EyeOff 图标 */}
                              {(key.toLowerCase().includes('token') || key.toLowerCase().includes('key')) && (
                                <motion.button
                                  onClick={() => setShowApiKey(!showApiKey)}
                                  className="p-2 rounded-lg hover:bg-accent transition-colors"
                                  title={showApiKey ? '隐藏' : '显示'}
                                  whileHover={{ scale: 1.1 }}
                                  whileTap={{ scale: 0.9 }}
                                >
                                  {showApiKey ? (
                                    <EyeOff className="w-4 h-4" />
                                  ) : (
                                    <Eye className="w-4 h-4" />
                                  )}
                                </motion.button>
                              )}
                            </div>
                          </div>
                          {/* 删除环境变量按钮：使用 Trash2 图标 */}
                          <motion.button
                            onClick={() => handleRemoveEnv(key)}
                            className="p-2 rounded-lg hover:bg-destructive/10 text-destructive transition-colors self-end"
                            title="删除"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </motion.button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* 工具标签页：一键 Resume 参数配置 */}
            {activeTab === 'tools' && (
              <motion.div
                key="tools"
                className="space-y-6"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                {/* 一键 Resume 配置区域 */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">一键 Resume 参数</label>
                  <p className="text-xs text-muted-foreground mb-3">
                    配置通过"实用工具 → 一键 Resume"唤起 Claude CLI 时附加的参数
                  </p>

                  {/* 常用 Flag 勾选列表 */}
                  <div className="space-y-2 mb-4">
                    {RESUME_FLAGS.map(({ flag, label }) => {
                      const isChecked = resumeConfig.flags.includes(flag);
                      return (
                        <button
                          key={flag}
                          onClick={() => {
                            const newFlags = isChecked
                              ? resumeConfig.flags.filter(f => f !== flag)
                              : [...resumeConfig.flags, flag];
                            const newConfig = { ...resumeConfig, flags: newFlags };
                            setResumeConfig(newConfig);
                            saveResumeConfig(newConfig).catch(err =>
                              console.error('保存 Resume 配置失败:', err)
                            );
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent/50 transition-colors text-left"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="text-sm font-mono text-foreground">{flag}</span>
                            <p className="text-xs text-muted-foreground">{label}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* 自定义参数输入框 */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">自定义参数</label>
                    <input
                      type="text"
                      value={resumeConfig.customArgs}
                      onChange={(e) => {
                        const newConfig = { ...resumeConfig, customArgs: e.target.value };
                        setResumeConfig(newConfig);
                      }}
                      onBlur={() => {
                        saveResumeConfig(resumeConfig).catch(err =>
                          console.error('保存 Resume 配置失败:', err)
                        );
                      }}
                      placeholder="额外参数（追加在命令末尾），如 --model opus"
                      className="w-full px-3 py-2 rounded-lg bg-muted text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring text-sm font-mono"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      最终命令：claude --resume &lt;会话ID&gt; {resumeConfig.flags.join(' ')} {resumeConfig.customArgs}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* 权限标签页：展示当前的允许/拒绝操作列表（只读） */}
            {activeTab === 'permissions' && (
              <motion.div
                key="permissions"
                className="space-y-4"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                <p className="text-sm text-muted-foreground">
                  管理 Claude Code 的权限设置（允许/拒绝的操作）
                </p>

                {/* 允许的操作列表 */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">允许的操作</label>
                  <div className="px-3 py-2 rounded-lg bg-muted text-sm font-mono min-h-[60px]">
                    {editedSettings.permissions?.allow?.join(', ') || '无'}
                  </div>
                </div>

                {/* 拒绝的操作列表 */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">拒绝的操作</label>
                  <div className="px-3 py-2 rounded-lg bg-muted text-sm font-mono min-h-[60px]">
                    {editedSettings.permissions?.deny?.join(', ') || '无'}
                  </div>
                </div>
              </motion.div>
            )}

            {/* 关于标签页：应用版本信息、开发者信息和开源仓库链接 */}
            {activeTab === 'about' && (
              <motion.div
                key="about"
                className="space-y-6"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                {/* 应用信息：名称和版本号 */}
                <div className="text-center py-4">
                  <h3 className="text-xl font-semibold text-foreground mb-2">Claude Code Reader</h3>
                  <p className="text-sm text-muted-foreground">v2.0.0-beta.1</p>
                </div>

                {/* 开发者信息 */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">开发者</label>
                  <div className="px-3 py-2 rounded-lg bg-muted text-foreground text-sm">
                    墨叶染千枝
                  </div>
                </div>

                {/* 开源仓库地址：使用 Github 图标，带有悬停缩放动画 */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">开源地址</label>
                  <motion.a
                    href="https://github.com/MoYeRanQianZhi/ClaudeCodeReader"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted text-primary hover:bg-accent transition-colors text-sm"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Github className="w-5 h-5" />
                    github.com/MoYeRanQianZhi/ClaudeCodeReader
                  </motion.a>
                </div>

                {/* 应用简介说明 */}
                <div className="text-center text-xs text-muted-foreground pt-4 border-t border-border">
                  <p>用于查看和管理 Claude Code 的会话记录与设置</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 底部操作栏：取消和保存按钮 */}
        <div className="p-4 border-t border-border flex justify-end gap-2 bg-card shrink-0">
          {/* 取消按钮：关闭面板不保存 */}
          <motion.button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            取消
          </motion.button>
          {/* 保存按钮：仅在有变更时可用，否则禁用并显示为灰色 */}
          <motion.button
            onClick={handleSave}
            disabled={!hasChanges}
            className={`px-4 py-2 rounded-lg transition-colors ${
              hasChanges
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            }`}
            whileHover={hasChanges ? { scale: 1.05 } : {}}
            whileTap={hasChanges ? { scale: 0.95 } : {}}
          >
            保存更改
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
