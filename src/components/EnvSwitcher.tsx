import { useState, useRef, useEffect } from 'react';
import type { EnvProfile, EnvSwitcherConfig } from '../types/claude';

interface EnvSwitcherProps {
  config: EnvSwitcherConfig;
  onSwitchProfile: (profile: EnvProfile) => void;
  onSaveCurrentAsProfile: (name: string) => void;
  onDeleteProfile: (profileId: string) => void;
  onEditProfile: (profile: EnvProfile) => void;
}

export function EnvSwitcher({
  config,
  onSwitchProfile,
  onSaveCurrentAsProfile,
  onDeleteProfile,
  onEditProfile,
}: EnvSwitcherProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeProfile = config.profiles.find(p => p.id === config.activeProfileId);
  const profiles = config.profiles;

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSaveProfile = () => {
    if (newProfileName.trim()) {
      onSaveCurrentAsProfile(newProfileName.trim());
      setNewProfileName('');
      setShowSaveDialog(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* 当前配置显示/下拉触发器 */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent transition-colors text-sm"
        title="环境配置切换"
      >
        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="flex-1 text-left truncate">
          {activeProfile?.name || '默认配置'}
        </span>
        <svg className={`w-4 h-4 text-muted-foreground transition-transform ${showDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 下拉菜单 */}
      {showDropdown && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-card rounded-lg shadow-xl border border-border z-50">
          <div className="p-2 border-b border-border">
            <div className="text-xs text-muted-foreground font-medium px-2 py-1">环境配置</div>
          </div>

          {/* 配置列表 */}
          <div className="max-h-60 overflow-y-auto">
            {profiles.length === 0 ? (
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
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {profile.id === config.activeProfileId && (
                      <svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                      </svg>
                    )}
                    <div className={`flex-1 min-w-0 ${profile.id !== config.activeProfileId ? 'pl-6' : ''}`}>
                      <div className="text-sm font-medium truncate">{profile.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {Object.keys(profile.env).length} 个变量
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditProfile(profile);
                        setShowDropdown(false);
                      }}
                      className="p-1 rounded hover:bg-secondary"
                      title="编辑"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`确定要删除配置 "${profile.name}" 吗？`)) {
                          onDeleteProfile(profile.id);
                        }
                      }}
                      className="p-1 rounded hover:bg-destructive/10 text-destructive"
                      title="删除"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 保存当前配置 */}
          <div className="p-2 border-t border-border">
            {showSaveDialog ? (
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
                <button
                  onClick={handleSaveProfile}
                  className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowSaveDialog(false)}
                  className="p-1.5 rounded-md hover:bg-accent"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSaveDialog(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                保存当前配置
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
