import { useState } from 'react';
import type { Project, Session, EnvProfile, EnvSwitcherConfig } from '../types/claude';
import { formatTimestamp } from '../utils/claudeData';
import { EnvSwitcher } from './EnvSwitcher';

interface SidebarProps {
  projects: Project[];
  currentProject: Project | null;
  currentSession: Session | null;
  envConfig: EnvSwitcherConfig;
  onSelectProject: (project: Project) => void;
  onSelectSession: (session: Session) => void;
  onOpenSettings: () => void;
  onSwitchEnvProfile: (profile: EnvProfile) => void;
  onSaveEnvProfile: (name: string) => void;
  onDeleteEnvProfile: (profileId: string) => void;
  onEditEnvProfile: (profile: EnvProfile) => void;
}

export function Sidebar({
  projects,
  currentProject,
  currentSession,
  envConfig,
  onSelectProject,
  onSelectSession,
  onOpenSettings,
  onSwitchEnvProfile,
  onSaveEnvProfile,
  onDeleteEnvProfile,
  onEditEnvProfile,
}: SidebarProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const filteredProjects = projects.filter(
    (p) =>
      p.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sessions.some((s) => s.id.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const toggleProject = (projectPath: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectPath)) {
      newExpanded.delete(projectPath);
    } else {
      newExpanded.add(projectPath);
    }
    setExpandedProjects(newExpanded);
  };

  return (
    <div className="w-72 h-full flex flex-col bg-card border-r border-border">
      {/* 头部 */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold text-foreground">Claude Code Reader</h1>
          {/* 设置按钮 */}
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title="设置"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        {/* 环境切换器 */}
        <div className="mb-3">
          <EnvSwitcher
            config={envConfig}
            onSwitchProfile={onSwitchEnvProfile}
            onSaveCurrentAsProfile={onSaveEnvProfile}
            onDeleteProfile={onDeleteEnvProfile}
            onEditProfile={onEditEnvProfile}
          />
        </div>

        {/* 搜索框 */}
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="搜索项目或会话..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-secondary text-foreground placeholder-muted-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* 项目列表 */}
      <div className="flex-1 overflow-y-auto">
        {filteredProjects.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            {searchTerm ? '没有找到匹配的项目' : '没有找到任何项目'}
          </div>
        ) : (
          filteredProjects.map((project) => (
            <div key={project.path} className="border-b border-border">
              {/* 项目头 */}
              <button
                onClick={() => {
                  onSelectProject(project);
                  toggleProject(project.path);
                }}
                className={`w-full p-3 text-left hover:bg-accent transition-colors flex items-center gap-2 ${
                  currentProject?.path === project.path ? 'bg-accent' : ''
                }`}
              >
                <svg
                  className={`w-4 h-4 transition-transform ${
                    expandedProjects.has(project.path) ? 'rotate-90' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {project.path.split('\\').pop() || project.path}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{project.path}</div>
                </div>
                <span className="text-xs bg-secondary px-2 py-1 rounded-full text-muted-foreground">
                  {project.sessions.length}
                </span>
              </button>

              {/* 会话列表 */}
              {expandedProjects.has(project.path) && (
                <div className="bg-muted/30">
                  {project.sessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => onSelectSession(session)}
                      className={`w-full p-3 pl-8 text-left hover:bg-accent transition-colors ${
                        currentSession?.id === session.id ? 'bg-accent' : ''
                      }`}
                    >
                      <div className="text-sm text-foreground truncate">
                        {session.name || session.id.substring(0, 8)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatTimestamp(session.timestamp)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 底部信息 */}
      <div className="p-3 border-t border-border text-xs text-muted-foreground">
        共 {projects.length} 个项目，{projects.reduce((acc, p) => acc + p.sessions.length, 0)} 个会话
      </div>
    </div>
  );
}
