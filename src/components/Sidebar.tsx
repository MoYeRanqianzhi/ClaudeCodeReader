/**
 * @file Sidebar.tsx - 侧边栏导航组件
 * @description 应用左侧的主导航面板，负责项目与会话的层级浏览、搜索过滤、
 *              环境配置切换以及设置入口。采用可折叠的树形结构展示项目和会话。
 *              使用 lucide-react 图标库替代内联 SVG，使用 motion/react 提供流畅的动画过渡效果。
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, ChevronLeft, Search, ChevronRight, Trash2 } from 'lucide-react';
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
  /** 折叠侧边栏的回调 */
  onCollapse: () => void;
}

/**
 * Sidebar - 侧边栏导航组件
 *
 * 提供项目和会话的层级导航功能，包含以下核心特性：
 * - 项目树形结构：可展开/折叠的项目列表，每个项目下包含其关联的会话
 * - 搜索过滤：支持按项目路径或会话 ID 进行模糊搜索
 * - 环境配置切换：集成 EnvSwitcher 组件，可快速切换不同的环境配置
 * - 底部统计：显示项目总数和会话总数
 * - 动画过渡：使用 motion/react 实现平滑的展开/折叠、悬停和点击动画
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
  onCollapse,
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
    /* 根容器：使用 motion.div 实现侧边栏展开/收起的宽度动画 */
    <motion.div
      className="w-72 h-full flex flex-col bg-sidebar border-r border-border custom-scrollbar overflow-hidden"
      initial={false}
      animate={{ width: 288 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* 头部区域：应用标题和设置按钮，设置 shrink-0 防止在空间不足时被压缩 */}
      <div className="p-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold text-foreground">Claude Code Reader</h1>
          <div className="flex items-center gap-1">
            {/* 设置按钮：使用 motion.button 添加悬停缩放和点击回弹效果 */}
            <motion.button
              onClick={onOpenSettings}
              className="p-2 rounded-lg hover:bg-accent transition-colors"
              title="设置"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Settings className="w-5 h-5" />
            </motion.button>
            {/* 折叠侧边栏按钮：使用 motion.button 添加悬停缩放和点击回弹效果 */}
            <motion.button
              onClick={onCollapse}
              className="p-2 rounded-lg hover:bg-accent transition-colors"
              title="折叠侧边栏"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <ChevronLeft className="w-5 h-5" />
            </motion.button>
          </div>
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

        {/* 搜索框：使用 lucide-react 的 Search 图标替代内联 SVG */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索项目或会话..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-muted text-sm text-foreground placeholder-muted-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring"
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
              {/* 项目头：使用 motion.button 添加悬停和点击动画，点击后选中项目并展开/折叠其会话列表 */}
              <motion.button
                onClick={() => {
                  onSelectProject(project);
                  toggleProject(project.path);
                }}
                className={`w-full p-3 text-left hover:bg-accent transition-colors flex items-center gap-2 ${
                  currentProject?.path === project.path ? 'bg-accent' : ''
                }`}
                whileHover={{ backgroundColor: 'var(--accent)' }}
                whileTap={{ scale: 0.98 }}
              >
                {/* 展开/折叠指示箭头：使用 motion.div 实现平滑的旋转动画 */}
                <motion.div
                  animate={{ rotate: expandedProjects.has(project.path) ? 90 : 0 }}
                  transition={{ duration: 0.15, ease: 'easeInOut' }}
                >
                  <ChevronRight className="w-4 h-4" />
                </motion.div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {project.path.split('\\').pop() || project.path}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{project.path}</div>
                </div>
                {/* 会话计数徽章：使用 bg-muted 替代 bg-secondary 保持与整体风格一致 */}
                <span className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground">
                  {project.sessions.length}
                </span>
              </motion.button>

              {/* 会话列表：使用 AnimatePresence 包裹，实现展开/折叠的高度动画过渡 */}
              <AnimatePresence initial={false}>
                {expandedProjects.has(project.path) && (
                  <motion.div
                    className="bg-muted/30"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    {project.sessions.map((session) => (
                      <div
                        key={session.id}
                        className={`group relative w-full p-3 pl-10 text-left hover:bg-accent transition-colors cursor-pointer ${
                          currentSession?.id === session.id ? 'bg-accent border-l-2 border-primary' : ''
                        }`}
                        onClick={() => onSelectSession(session)}
                      >
                        <div className="text-sm text-foreground truncate pr-6">
                          {session.name || session.id.substring(0, 8)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatTimestamp(session.timestamp)}
                        </div>
                        {/* 删除按钮：使用 motion.button 添加悬停/点击效果，hover 时显示，阻止事件冒泡防止触发会话选择 */}
                        <motion.button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSession(session.filePath);
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-destructive transition-all"
                          title="删除会话"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </motion.button>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>

      {/* 底部信息：设置 shrink-0 防止在空间不足时被压缩 */}
      <div className="p-3 border-t border-border text-xs text-muted-foreground shrink-0">
        共 {projects.length} 个项目，{projects.reduce((acc, p) => acc + p.sessions.length, 0)} 个会话
      </div>
    </motion.div>
  );
}
