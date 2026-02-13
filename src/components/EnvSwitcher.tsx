import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Terminal, ChevronDown, Check, Edit2, Trash2, Plus, X } from 'lucide-react';
import type { EnvProfile, EnvSwitcherConfig } from '../types/claude';

/**
 * EnvSwitcher 组件的属性接口
 * 定义了环境配置切换器所需的全部回调和数据源
 */
interface EnvSwitcherProps {
  /** 当前环境切换器的完整配置数据，包含所有配置项列表和当前激活项 ID */
  config: EnvSwitcherConfig;
  /** 切换到指定配置项时触发的回调 */
  onSwitchProfile: (profile: EnvProfile) => void;
  /** 将当前环境保存为新配置项时触发的回调，参数为用户输入的配置名称 */
  onSaveCurrentAsProfile: (name: string) => void;
  /** 删除指定配置项时触发的回调，参数为配置项的唯一标识 */
  onDeleteProfile: (profileId: string) => void;
  /** 编辑指定配置项时触发的回调 */
  onEditProfile: (profile: EnvProfile) => void;
}

/**
 * EnvSwitcher - 环境配置切换器组件
 *
 * 提供一个下拉菜单式的 UI，允许用户在多个预设的环境配置之间切换。
 * 支持新建、编辑、删除配置项，以及将当前运行环境保存为新配置。
 *
 * 视觉特性：
 * - 使用 motion/react 实现下拉菜单的进入/退出动画
 * - 按钮支持 hover 和点击的微交互反馈
 * - 下拉箭头随展开/收起状态平滑旋转
 */
export function EnvSwitcher({
  config,
  onSwitchProfile,
  onSaveCurrentAsProfile,
  onDeleteProfile,
  onEditProfile,
}: EnvSwitcherProps) {
  /* ====== 组件内部状态 ====== */
  /** 控制下拉菜单的显示/隐藏 */
  const [showDropdown, setShowDropdown] = useState(false);
  /** 控制"保存当前配置"对话框的显示/隐藏 */
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  /** 新配置项名称的输入值 */
  const [newProfileName, setNewProfileName] = useState('');
  /** 下拉菜单容器引用，用于检测外部点击 */
  const dropdownRef = useRef<HTMLDivElement>(null);

  /** 根据 activeProfileId 查找当前激活的配置项对象 */
  const activeProfile = config.profiles.find(p => p.id === config.activeProfileId);
  /** 所有可用的配置项列表 */
  const profiles = config.profiles;

  /**
   * 点击外部关闭下拉菜单的副作用
   * 通过 mousedown 事件监听器实现，在组件卸载时自动清理
   */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /**
   * 处理保存新配置项的逻辑
   * 仅在名称非空时触发回调，保存后重置输入框和对话框状态
   */
  const handleSaveProfile = () => {
    if (newProfileName.trim()) {
      onSaveCurrentAsProfile(newProfileName.trim());
      setNewProfileName('');
      setShowSaveDialog(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* 当前配置显示 / 下拉触发按钮 */}
      <motion.button
        onClick={() => setShowDropdown(!showDropdown)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border border-border hover:bg-accent transition-colors text-sm"
        title="环境配置切换"
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        {/* 终端图标 —— 表示环境/终端配置 */}
        <Terminal className="w-4 h-4 shrink-0 text-muted-foreground" />
        {/* 当前激活配置的名称，超长时截断 */}
        <span className="flex-1 text-left truncate">
          {activeProfile?.name || '默认配置'}
        </span>
        {/* 下拉箭头，随展开状态旋转 180 度 */}
        <motion.div
          animate={{ rotate: showDropdown ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
        </motion.div>
      </motion.button>

      {/* 下拉菜单 —— 使用 AnimatePresence 管理进入/退出动画 */}
      <AnimatePresence>
        {showDropdown && (
          <motion.div
            className="absolute top-full left-0 mt-1 w-full bg-card rounded-lg shadow-xl border border-border z-50"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
          >
            {/* 下拉菜单标题区域 */}
            <div className="p-2 border-b border-border">
              <div className="text-xs text-muted-foreground font-medium px-2 py-1">环境配置</div>
            </div>

            {/* 配置项列表 —— 可滚动区域 */}
            <div className="max-h-60 overflow-y-auto custom-scrollbar">
              {profiles.length === 0 ? (
                /* 空状态提示 */
                <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                  暂无保存的配置
                </div>
              ) : (
                profiles.map(profile => (
                  <div
                    key={profile.id}
                    className={`flex items-center justify-between px-2 py-1.5 mx-1 my-0.5 rounded-md hover:bg-accent cursor-pointer group ${
                      profile.id === config.activeProfileId ? 'bg-accent' : ''
                    }`}
                    onClick={() => {
                      onSwitchProfile(profile);
                      setShowDropdown(false);
                    }}
                  >
                    {/* 配置项名称和变量数信息 */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {/* 当前激活项的勾选标记 */}
                      {profile.id === config.activeProfileId && (
                        <Check className="w-4 h-4 shrink-0 text-primary" />
                      )}
                      <div className={`flex-1 min-w-0 ${profile.id !== config.activeProfileId ? 'pl-6' : ''}`}>
                        <div className="text-sm font-medium truncate">{profile.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {Object.keys(profile.env).length} 个变量
                        </div>
                      </div>
                    </div>
                    {/* 编辑 / 删除操作按钮组 —— 悬停时显示 */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* 编辑按钮 */}
                      <motion.button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditProfile(profile);
                          setShowDropdown(false);
                        }}
                        className="p-1 rounded hover:bg-secondary"
                        title="编辑"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                      >
                        <Edit2 className="w-3.5 h-3.5 shrink-0" />
                      </motion.button>
                      {/* 删除按钮 */}
                      <motion.button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`确定要删除配置 "${profile.name}" 吗？`)) {
                            onDeleteProfile(profile.id);
                          }
                        }}
                        className="p-1 rounded hover:bg-destructive/10 text-destructive"
                        title="删除"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                      </motion.button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 底部操作区 —— 保存当前配置 */}
            <div className="p-2 border-t border-border">
              {showSaveDialog ? (
                /* 保存对话框：输入框 + 确认/取消按钮 */
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    placeholder="配置名称..."
                    className="flex-1 px-2 py-1.5 text-sm rounded-md bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-ring"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveProfile();
                      if (e.key === 'Escape') setShowSaveDialog(false);
                    }}
                  />
                  {/* 确认保存按钮 */}
                  <motion.button
                    onClick={handleSaveProfile}
                    className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                  </motion.button>
                  {/* 取消按钮 */}
                  <motion.button
                    onClick={() => setShowSaveDialog(false)}
                    className="p-1.5 rounded-md hover:bg-accent"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <X className="w-4 h-4 shrink-0" />
                  </motion.button>
                </div>
              ) : (
                /* "保存当前配置"触发按钮 */
                <motion.button
                  onClick={() => setShowSaveDialog(true)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  保存当前配置
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
