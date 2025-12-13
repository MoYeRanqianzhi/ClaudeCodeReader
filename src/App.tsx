import { useState, useEffect, useCallback } from 'react';
import { Sidebar, ChatView, SettingsPanel } from './components';
import type { Project, Session, SessionMessage, ClaudeSettings, EnvSwitcherConfig, EnvProfile } from './types/claude';
import {
  getClaudeDataPath,
  getProjects,
  readSettings,
  saveSettings,
  readSessionMessages,
  deleteMessage,
  editMessageContent,
  readEnvSwitcherConfig,
  saveEnvSwitcherConfig,
  applyEnvProfile,
  saveCurrentAsProfile,
  createEnvProfile,
} from './utils/claudeData';

function App() {
  const [claudeDataPath, setClaudeDataPath] = useState<string>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [settings, setSettings] = useState<ClaudeSettings>({});
  const [envConfig, setEnvConfig] = useState<EnvSwitcherConfig>({ profiles: [], activeProfileId: null });
  const [showSettings, setShowSettings] = useState(false);
  const [editingEnvProfile, setEditingEnvProfile] = useState<EnvProfile | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', isDark);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
  }, [theme]);

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        const path = await getClaudeDataPath();
        setClaudeDataPath(path);

        const [loadedSettings, loadedProjects, loadedEnvConfig] = await Promise.all([
          readSettings(path),
          getProjects(path),
          readEnvSwitcherConfig(path),
        ]);

        setSettings(loadedSettings);
        setProjects(loadedProjects);
        setEnvConfig(loadedEnvConfig);
        setError(null);
      } catch (err) {
        console.error('初始化失败:', err);
        setError(err instanceof Error ? err.message : '加载数据失败');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  const handleSelectSession = useCallback(async (session: Session) => {
    setCurrentSession(session);
    try {
      const msgs = await readSessionMessages(session.filePath);
      setMessages(msgs);
    } catch (err) {
      console.error('加载消息失败:', err);
      setMessages([]);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    if (currentSession) {
      try {
        const msgs = await readSessionMessages(currentSession.filePath);
        setMessages(msgs);
      } catch (err) {
        console.error('刷新消息失败:', err);
      }
    }
  }, [currentSession]);

  const handleEditMessage = useCallback(
    async (uuid: string, newContent: string) => {
      if (!currentSession) return;
      try {
        const updatedMessages = await editMessageContent(
          currentSession.filePath,
          uuid,
          newContent
        );
        setMessages(updatedMessages);
      } catch (err) {
        console.error('编辑消息失败:', err);
      }
    },
    [currentSession]
  );

  const handleDeleteMessage = useCallback(
    async (uuid: string) => {
      if (!currentSession) return;
      if (!confirm('确定要删除这条消息吗？')) return;
      try {
        const updatedMessages = await deleteMessage(currentSession.filePath, uuid);
        setMessages(updatedMessages);
      } catch (err) {
        console.error('删除消息失败:', err);
      }
    },
    [currentSession]
  );

  const handleSaveSettings = useCallback(
    async (newSettings: ClaudeSettings) => {
      try {
        await saveSettings(claudeDataPath, newSettings);
        setSettings(newSettings);
      } catch (err) {
        console.error('保存设置失败:', err);
      }
    },
    [claudeDataPath]
  );

  // 环境配置切换
  const handleSwitchEnvProfile = useCallback(
    async (profile: EnvProfile) => {
      try {
        const updatedSettings = await applyEnvProfile(claudeDataPath, profile);
        setSettings(updatedSettings);

        const updatedConfig = {
          ...envConfig,
          activeProfileId: profile.id,
        };
        await saveEnvSwitcherConfig(claudeDataPath, updatedConfig);
        setEnvConfig(updatedConfig);
      } catch (err) {
        console.error('切换环境配置失败:', err);
      }
    },
    [claudeDataPath, envConfig]
  );

  // 保存当前配置
  const handleSaveEnvProfile = useCallback(
    async (name: string) => {
      try {
        const profile = await saveCurrentAsProfile(claudeDataPath, name);
        const updatedConfig = await readEnvSwitcherConfig(claudeDataPath);
        setEnvConfig(updatedConfig);
        console.log('保存配置成功:', profile.name);
      } catch (err) {
        console.error('保存环境配置失败:', err);
      }
    },
    [claudeDataPath]
  );

  // 删除配置
  const handleDeleteEnvProfile = useCallback(
    async (profileId: string) => {
      try {
        const updatedConfig = {
          ...envConfig,
          profiles: envConfig.profiles.filter(p => p.id !== profileId),
          activeProfileId: envConfig.activeProfileId === profileId ? null : envConfig.activeProfileId,
        };
        await saveEnvSwitcherConfig(claudeDataPath, updatedConfig);
        setEnvConfig(updatedConfig);
      } catch (err) {
        console.error('删除环境配置失败:', err);
      }
    },
    [claudeDataPath, envConfig]
  );

  // 编辑配置（打开设置面板并预填充）
  const handleEditEnvProfile = useCallback((profile: EnvProfile) => {
    setEditingEnvProfile(profile);
    setShowSettings(true);
  }, []);

  // 保存编辑后的配置
  const handleSaveEditedProfile = useCallback(
    async (profile: EnvProfile) => {
      try {
        const updatedProfile = {
          ...profile,
          updatedAt: new Date().toISOString(),
        };
        const updatedConfig = {
          ...envConfig,
          profiles: envConfig.profiles.map(p => p.id === profile.id ? updatedProfile : p),
        };
        await saveEnvSwitcherConfig(claudeDataPath, updatedConfig);
        setEnvConfig(updatedConfig);

        // 如果是当前激活的配置，同时更新 settings
        if (profile.id === envConfig.activeProfileId) {
          await applyEnvProfile(claudeDataPath, updatedProfile);
          setSettings(prev => ({ ...prev, env: updatedProfile.env }));
        }

        setEditingEnvProfile(null);
      } catch (err) {
        console.error('保存编辑配置失败:', err);
      }
    },
    [claudeDataPath, envConfig]
  );

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">正在加载 Claude Code 数据...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md p-6">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-destructive"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-foreground mb-2">加载失败</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-background">
      <Sidebar
        projects={projects}
        currentProject={currentProject}
        currentSession={currentSession}
        envConfig={envConfig}
        onSelectProject={setCurrentProject}
        onSelectSession={handleSelectSession}
        onOpenSettings={() => setShowSettings(true)}
        onSwitchEnvProfile={handleSwitchEnvProfile}
        onSaveEnvProfile={handleSaveEnvProfile}
        onDeleteEnvProfile={handleDeleteEnvProfile}
        onEditEnvProfile={handleEditEnvProfile}
      />

      <ChatView
        session={currentSession}
        messages={messages}
        onEditMessage={handleEditMessage}
        onDeleteMessage={handleDeleteMessage}
        onRefresh={handleRefresh}
      />

      {showSettings && (
        <SettingsPanel
          settings={editingEnvProfile ? { ...settings, env: editingEnvProfile.env } : settings}
          claudeDataPath={claudeDataPath}
          theme={theme}
          editingProfile={editingEnvProfile}
          onSaveSettings={editingEnvProfile ?
            (newSettings) => {
              if (editingEnvProfile) {
                handleSaveEditedProfile({ ...editingEnvProfile, env: newSettings.env || {} });
              }
            } :
            handleSaveSettings
          }
          onThemeChange={setTheme}
          onClose={() => {
            setShowSettings(false);
            setEditingEnvProfile(null);
          }}
        />
      )}
    </div>
  );
}

export default App;
