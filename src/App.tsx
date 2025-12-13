import { useState, useEffect, useCallback } from 'react';
import { Sidebar, ChatView, SettingsPanel } from './components';
import type { Project, Session, SessionMessage, ClaudeSettings } from './types/claude';
import {
  getClaudeDataPath,
  getProjects,
  readSettings,
  saveSettings,
  readSessionMessages,
  deleteMessage,
  editMessageContent,
} from './utils/claudeData';

function App() {
  const [claudeDataPath, setClaudeDataPath] = useState<string>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [settings, setSettings] = useState<ClaudeSettings>({});
  const [showSettings, setShowSettings] = useState(false);
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

        const [loadedSettings, loadedProjects] = await Promise.all([
          readSettings(path),
          getProjects(path),
        ]);

        setSettings(loadedSettings);
        setProjects(loadedProjects);
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
        onSelectProject={setCurrentProject}
        onSelectSession={handleSelectSession}
        onOpenSettings={() => setShowSettings(true)}
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
          settings={settings}
          claudeDataPath={claudeDataPath}
          theme={theme}
          onSaveSettings={handleSaveSettings}
          onThemeChange={setTheme}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default App;
