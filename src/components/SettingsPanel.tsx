import { useState, useEffect } from 'react';
import type { ClaudeSettings, EnvProfile } from '../types/claude';

interface SettingsPanelProps {
  settings: ClaudeSettings;
  claudeDataPath: string;
  theme: 'light' | 'dark' | 'system';
  editingProfile?: EnvProfile | null;
  onSaveSettings: (settings: ClaudeSettings) => void;
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
  onClose: () => void;
}

export function SettingsPanel({
  settings,
  claudeDataPath,
  theme,
  editingProfile,
  onSaveSettings,
  onThemeChange,
  onClose,
}: SettingsPanelProps) {
  const [editedSettings, setEditedSettings] = useState<ClaudeSettings>(settings);
  // 如果正在编辑配置，自动切换到环境变量标签页
  const [activeTab, setActiveTab] = useState<'general' | 'env' | 'permissions' | 'about'>(
    editingProfile ? 'env' : 'general'
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    setEditedSettings(settings);
  }, [settings]);

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

  const handleRemoveEnv = (key: string) => {
    setEditedSettings((prev) => {
      const newEnv = { ...prev.env };
      delete newEnv[key];
      return { ...prev, env: newEnv };
    });
    setHasChanges(true);
  };

  const handleAddEnv = () => {
    const key = prompt('输入环境变量名称:');
    if (key) {
      handleEnvChange(key, '');
    }
  };

  const handleModelChange = (model: string) => {
    setEditedSettings((prev) => ({ ...prev, model }));
    setHasChanges(true);
  };

  const handleSave = () => {
    onSaveSettings(editedSettings);
    setHasChanges(false);
  };

  const tabs = [
    { id: 'general', label: '常规' },
    { id: 'env', label: '环境变量' },
    { id: 'permissions', label: '权限' },
    { id: 'about', label: '关于' },
  ] as const;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl shadow-xl w-[600px] max-h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {editingProfile ? `编辑配置: ${editingProfile.name}` : '设置'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 标签页 */}
        <div className="flex border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'general' && (
            <div className="space-y-6">
              {/* 主题设置 */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">主题</label>
                <select
                  value={theme}
                  onChange={(e) => onThemeChange(e.target.value as 'light' | 'dark' | 'system')}
                  className="w-full px-3 py-2 rounded-lg bg-secondary text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="system">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </div>

              {/* 模型设置 */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">默认模型</label>
                <input
                  type="text"
                  value={editedSettings.model || ''}
                  onChange={(e) => handleModelChange(e.target.value)}
                  placeholder="例如: claude-3-opus, sonnet, haiku"
                  className="w-full px-3 py-2 rounded-lg bg-secondary text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* 数据路径 */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Claude 数据路径</label>
                <div className="px-3 py-2 rounded-lg bg-muted text-muted-foreground text-sm font-mono">
                  {claudeDataPath}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'env' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">管理 Claude Code 的环境变量</p>
                <button
                  onClick={handleAddEnv}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
                >
                  添加变量
                </button>
              </div>

              {Object.entries(editedSettings.env || {}).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  没有设置环境变量
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(editedSettings.env || {}).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="block text-xs text-muted-foreground mb-1">{key}</label>
                        <div className="flex items-center gap-2">
                          <input
                            type={key.toLowerCase().includes('token') || key.toLowerCase().includes('key') ? (showApiKey ? 'text' : 'password') : 'text'}
                            value={value}
                            onChange={(e) => handleEnvChange(key, e.target.value)}
                            className="flex-1 px-3 py-2 rounded-lg bg-secondary text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring text-sm font-mono"
                          />
                          {(key.toLowerCase().includes('token') || key.toLowerCase().includes('key')) && (
                            <button
                              onClick={() => setShowApiKey(!showApiKey)}
                              className="p-2 rounded-lg hover:bg-accent transition-colors"
                              title={showApiKey ? '隐藏' : '显示'}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                {showApiKey ? (
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                ) : (
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                )}
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveEnv(key)}
                        className="p-2 rounded-lg hover:bg-destructive/10 text-destructive transition-colors self-end"
                        title="删除"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'permissions' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                管理 Claude Code 的权限设置（允许/拒绝的操作）
              </p>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">允许的操作</label>
                <div className="px-3 py-2 rounded-lg bg-muted text-sm font-mono min-h-[60px]">
                  {editedSettings.permissions?.allow?.join(', ') || '无'}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">拒绝的操作</label>
                <div className="px-3 py-2 rounded-lg bg-muted text-sm font-mono min-h-[60px]">
                  {editedSettings.permissions?.deny?.join(', ') || '无'}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'about' && (
            <div className="space-y-6">
              {/* 应用信息 */}
              <div className="text-center py-4">
                <h3 className="text-xl font-semibold text-foreground mb-2">Claude Code Reader</h3>
                <p className="text-sm text-muted-foreground">v0.3.0-beta.2</p>
              </div>

              {/* 开发者 */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">开发者</label>
                <div className="px-3 py-2 rounded-lg bg-muted text-foreground text-sm">
                  墨叶染千枝
                </div>
              </div>

              {/* 开源地址 */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">开源地址</label>
                <a
                  href="https://github.com/MoYeRanQianZhi/ClaudeCodeReader"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted text-primary hover:bg-accent transition-colors text-sm"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                  </svg>
                  github.com/MoYeRanQianZhi/ClaudeCodeReader
                </a>
              </div>

              {/* 说明 */}
              <div className="text-center text-xs text-muted-foreground pt-4 border-t border-border">
                <p>用于查看和管理 Claude Code 的会话记录与设置</p>
              </div>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className={`px-4 py-2 rounded-lg transition-colors ${
              hasChanges
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            }`}
          >
            保存更改
          </button>
        </div>
      </div>
    </div>
  );
}
