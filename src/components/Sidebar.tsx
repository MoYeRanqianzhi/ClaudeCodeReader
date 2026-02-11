/**
 * @file Sidebar.tsx - 侧边栏导航组件
 * @description 应用左侧的主导航面板，负责项目与会话的层级浏览、搜索过滤、
 *              环境配置切换以及设置入口。采用可折叠的树形结构展示项目和会话。
 */

import { useState } from 'react';
import type { Project, Session, EnvProfile, EnvSwitcherConfig } from '../types/claude';
import { formatTimestamp } from '../utils/claudeData';
import { EnvSwitcher } from './EnvSwitcher';

/**
 * Sidebar 组件的属性接口
 */
interface SidebarProps {
  /** 所有已发现的项目列表，每个项目包含路径和关联的会话 */
  projects: Project[];
  /** 当前选中的项目对象，用于高亮显示 */
  currentProject: Project | null;
  /** 当前选中的会话对象，用于高亮显示 */
  currentSession: Session | null;
  /** 环境配置切换器所需的配置数据（包含配置列表和当前激活的配置 ID） */
  envConfig: EnvSwitcherConfig;
  /** 选中项目时触发的回调 */
  onSelectProject: (project: Project) => void;
  /** 选中会话时触发的回调 */
  onSelectSession: (session: Session) => void;
  /** 删除会话时触发的回调，接收会话文件路径 */
  onDeleteSession: (sessionFilePath: string) => void;
  /** 打开设置面板的回调 */
  onOpenSettings: () => void;
  /** 切换环境配置时触发的回调 */
  onSwitchEnvProfile: (profile: EnvProfile) => void;
  /** 将当前环境保存为新配置时触发的回调，接收配置名称 */
  onSaveEnvProfile: (name: string) => void;
  /** 删除环境配置时触发的回调，接收配置 ID */
  onDeleteEnvProfile: (profileId: string) => void;
  /** 编辑环境配置时触发的回调，接收完整的配置对象 */
  onEditEnvProfile: (profile: EnvProfile) => void;
}

/**
 * Sidebar - 侧边栏导航组件
 *
 * 提供项目和会话的层级导航功能，包含以下核心特性：
 * - 项目树形结构：可展开/折叠的项目列表，每个项目下包含其关联的会话
 * - 搜索过滤：支持按项目路径或会话 ID 进行模糊搜索
 * - 环境配置切换：集成 EnvSwitcher 组件，可快速切换不同的环境配置
 * - 底部统计：显示项目总数和会话总数
 *
 * @param props - 组件属性
 * @returns JSX 元素
 */
export function Sidebar({
  projects,
  currentProject,
  currentSession,
  envConfig,
  onSelectProject,
  onSelectSession,
  onDeleteSession,
  onOpenSettings,
  onSwitchEnvProfile,
  onSaveEnvProfile,
  onDeleteEnvProfile,
  onEditEnvProfile,
}: SidebarProps) {
  /** 搜索关键词，用于过滤项目列表（同时匹配项目路径和会话 ID） */
  const [searchTerm, setSearchTerm] = useState('');
  /** 已展开的项目路径集合，用于控制项目节点的展开/折叠状态 */
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  /**
   * 根据搜索关键词过滤项目列表。
   * 匹配规则：项目路径包含关键词，或者项目的任意会话 ID 包含关键词（不区分大小写）。
   */
  const filteredProjects = projects.filter(
    (p) =>
      p.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sessions.some((s) => s.id.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  /**
   * 切换指定项目的展开/折叠状态。
   * 使用 Set 数据结构管理展开状态，通过创建新 Set 触发 React 重新渲染。
   *
   * @param projectPath - 要切换展开状态的项目路径
   */
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
      {/* 头部区域：应用标题和设置按钮 */}
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

        {/* 环境切换器：集成 EnvSwitcher 组件，用于快速切换不同的环境配置 */}
        <div className="mb-3">
          <EnvSwitcher
            config={envConfig}
            onSwitchProfile={onSwitchEnvProfile}
            onSaveCurrentAsProfile={onSaveEnvProfile}
            onDeleteProfile={onDeleteEnvProfile}
            onEditProfile={onEditEnvProfile}
          />
        </div>

        {/* 搜索框：支持按项目路径或会话 ID 模糊搜索 */}
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

      {/* 项目列表：可折叠的树形结构，展示所有匹配搜索条件的项目 */}
      <div className="flex-1 overflow-y-auto">
        {filteredProjects.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            {searchTerm ? '没有找到匹配的项目' : '没有找到任何项目'}
          </div>
        ) : (
          filteredProjects.map((project) => (
            <div key={project.path} className="border-b border-border">
              {/* 项目头：点击后选中项目并展开/折叠其会话列表 */}
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
                    <div
                      key={session.id}
                      className={`group relative w-full p-3 pl-8 text-left hover:bg-accent transition-colors cursor-pointer ${
                        currentSession?.id === session.id ? 'bg-accent' : ''
                      }`}
                      onClick={() => onSelectSession(session)}
                    >
                      <div className="text-sm text-foreground truncate pr-6">
                        {session.name || session.id.substring(0, 8)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatTimestamp(session.timestamp)}
                      </div>
                      {/* 删除按钮：hover 时显示，阻止事件冒泡防止触发会话选择 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session.filePath);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-destructive transition-all"
                        title="删除会话"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
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
