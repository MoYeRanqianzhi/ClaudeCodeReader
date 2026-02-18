/**
 * @file App.tsx - 应用根组件
 * @description
 * ClaudeCodeReader (CCR) 的顶层 React 组件，负责：
 * - 管理全局应用状态（项目、会话、消息、设置、主题等）
 * - 协调子组件之间的数据流和事件通信
 * - 处理应用初始化（加载 Claude Code 数据、设置、环境配置）
 * - 提供加载中和错误边界的全屏 UI 反馈
 *
 * 组件层级结构：
 * App
 *  ├── Sidebar          - 左侧边栏（项目列表、会话列表、环境配置切换器）
 *  ├── ChatView         - 主内容区（消息列表、消息操作）
 *  └── SettingsPanel    - 设置面板（浮层，条件渲染）
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { Sidebar, ChatView, SettingsPanel } from './components';
import type { Project, Session, SessionMessage, ClaudeSettings, EnvSwitcherConfig, EnvProfile } from './types/claude';
import {
  getClaudeDataPath,
  getProjects,
  readSettings,
  saveSettings,
  readSessionMessages,
  deleteMessage,
  deleteMessages,
  editMessageContent,
  deleteSession,
  exportAsMarkdown,
  exportAsJson,
  readEnvSwitcherConfig,
  saveEnvSwitcherConfig,
  applyEnvProfile,
  saveCurrentAsProfile,
} from './utils/claudeData';

/** 侧边栏自动折叠阈值（像素）：拖动宽度低于此值后松开鼠标，侧边栏自动折叠 */
const SIDEBAR_COLLAPSE_THRESHOLD = 160;
/** 侧边栏最小宽度（像素）：宽度回弹下限，避免内容被过度压缩 */
const SIDEBAR_MIN_WIDTH = 220;
/** 侧边栏默认宽度（像素）：初始宽度，折叠后重新展开时恢复到此值 */
const SIDEBAR_DEFAULT_WIDTH = 320;

/**
 * 应用根组件
 *
 * 作为 CCR 应用的唯一入口组件，管理所有全局状态并通过 props 将数据和回调函数
 * 向下传递给子组件。采用"状态提升"模式（Lifting State Up），确保单一数据源。
 *
 * @returns 根据加载状态返回不同的 UI：加载中界面 / 错误界面 / 正常应用界面
 */
function App() {
  /** Claude 数据目录的绝对路径（~/.claude/），所有数据读写操作的基础路径 */
  const [claudeDataPath, setClaudeDataPath] = useState<string>('');
  /** 所有项目列表：从 ~/.claude/projects/ 目录扫描获得，按最新会话时间排序 */
  const [projects, setProjects] = useState<Project[]>([]);
  /** 当前选中的项目：用户在侧边栏点击选择的项目，null 表示未选择任何项目 */
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  /** 当前选中的会话：用户在侧边栏点击选择的会话，null 表示未选择任何会话 */
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  /** 当前会话的消息列表：从选中会话的 JSONL 文件中加载的所有消息 */
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  /** Claude Code 设置：从 ~/.claude/settings.json 加载的用户配置 */
  const [settings, setSettings] = useState<ClaudeSettings>({});
  /** 环境切换器配置：包含所有环境配置组和当前激活的配置 ID */
  const [envConfig, setEnvConfig] = useState<EnvSwitcherConfig>({ profiles: [], activeProfileId: null });
  /** 设置面板可见性：控制 SettingsPanel 浮层的显示/隐藏 */
  const [showSettings, setShowSettings] = useState(false);
  /** 正在编辑的环境配置组：非 null 时 SettingsPanel 进入"配置编辑模式"而非普通设置模式 */
  const [editingEnvProfile, setEditingEnvProfile] = useState<EnvProfile | null>(null);
  /** 当前界面主题：'light' 浅色、'dark' 深色、'system' 跟随操作系统设置 */
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  /** 全局加载状态：为 true 时显示全屏加载动画，阻止用户交互 */
  const [loading, setLoading] = useState(true);
  /** 全局错误信息：非 null 时显示全屏错误提示页面 */
  const [error, setError] = useState<string | null>(null);
  /** 已选中的消息 UUID 集合：多选模式下用于追踪用户选择的消息 */
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  /** 选择模式开关：为 true 时显示复选框，允许批量操作 */
  const [selectionMode, setSelectionMode] = useState(false);
  /** 侧边栏折叠状态：为 true 时隐藏侧边栏，释放主内容区空间 */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** 侧边栏宽度（像素），可通过拖动右侧边缘调整 */
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  /** 是否正在拖动调整侧边栏宽度，为 true 时禁用过渡动画确保拖动流畅 */
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  /** 使用 ref 追踪拖动状态，避免全局事件监听器中的闭包陈旧问题 */
  const isResizingRef = useRef(false);

  /**
   * 开始拖动调整侧边栏宽度。
   * 设置拖动标志并修改全局光标样式，同时禁用文字选择防止拖动干扰。
   */
  const handleSidebarResizeStart = useCallback(() => {
    isResizingRef.current = true;
    setIsResizingSidebar(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  /**
   * 侧边栏拖动调整副作用
   *
   * 在全局 document 上监听 mousemove 和 mouseup 事件，实现拖动调整侧边栏宽度。
   * 使用 ref 而非 state 来判断是否处于拖动状态，避免在事件监听器闭包中读到陈旧值。
   * - mousemove：实时更新侧边栏宽度（下限 80px，防止负值）
   * - mouseup：结束拖动。如果最终宽度低于折叠阈值则自动折叠侧边栏并重置宽度，
   *           否则如果低于最小宽度则回弹到最小宽度
   */
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      setSidebarWidth(Math.max(80, e.clientX));
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      setIsResizingSidebar(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const finalWidth = Math.max(80, e.clientX);
      if (finalWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
        // 宽度低于折叠阈值 → 自动折叠，并重置宽度为默认值供下次展开
        setSidebarCollapsed(true);
        setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
      } else if (finalWidth < SIDEBAR_MIN_WIDTH) {
        // 宽度低于最小值但未触发折叠 → 回弹到最小宽度
        setSidebarWidth(SIDEBAR_MIN_WIDTH);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  /**
   * 主题切换副作用
   *
   * 监听 theme 状态变化，动态切换 HTML 根元素的 'dark' CSS 类名。
   * - 'system' 模式下通过 matchMedia API 检测操作系统的深色模式偏好
   * - 'light'/'dark' 模式下直接设置对应的类名
   * Tailwind CSS 的暗色模式依赖根元素的 'dark' 类名来激活暗色样式。
   *
   * 触发条件：theme 状态变化时执行
   */
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      // 系统模式：检测操作系统是否启用了深色主题
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', isDark);
    } else {
      // 手动模式：直接根据 theme 值设置
      root.classList.toggle('dark', theme === 'dark');
    }
  }, [theme]);

  /**
   * 应用初始化副作用
   *
   * 在组件首次挂载时执行，负责加载所有必要的初始数据：
   * 1. 获取 Claude 数据目录路径
   * 2. 并行加载设置、项目列表、环境配置（使用 Promise.all 优化性能）
   * 3. 将加载结果写入各个状态变量
   * 4. 处理加载过程中的错误，设置错误信息供 UI 展示
   *
   * 触发条件：仅在组件首次挂载时执行一次（依赖数组为空）
   */
  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        // 第一步：获取 Claude 数据目录路径
        const path = await getClaudeDataPath();
        setClaudeDataPath(path);

        // 第二步：并行加载设置、项目列表和环境配置，减少总加载时间
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

  /**
   * 处理会话选择事件
   *
   * 当用户在侧边栏点击某个会话时触发，加载该会话的所有消息并更新状态。
   * 如果加载失败，清空消息列表并在控制台输出错误信息。
   *
   * @param session - 用户选择的会话对象
   */
  const handleSelectSession = useCallback(async (session: Session) => {
    setCurrentSession(session);
    // 切换会话时清空选择模式和已选消息，防止残留状态跨会话
    setSelectedMessages(new Set());
    setSelectionMode(false);
    try {
      const msgs = await readSessionMessages(session.filePath);
      setMessages(msgs);
    } catch (err) {
      console.error('加载消息失败:', err);
      setMessages([]);
    }
  }, []);

  /**
   * 刷新当前会话的消息列表
   *
   * 重新从文件系统读取当前会话的 JSONL 文件，更新消息列表。
   * 适用于外部工具（如 Claude Code CLI）修改了会话文件后，用户手动刷新查看最新内容。
   * 仅在有选中会话时生效。
   */
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

  /**
   * 处理消息编辑事件
   *
   * 按内容块索引将编辑后的文本更新到消息中，并保存到文件。
   * 每个内容块的类型（text/thinking/tool_use 等）保持不变，仅更新文本字段。
   *
   * @param uuid - 要编辑的消息的 UUID
   * @param blockEdits - 按块索引的编辑列表
   */
  const handleEditMessage = useCallback(
    async (uuid: string, blockEdits: { index: number; text: string }[]) => {
      if (!currentSession) return;
      try {
        const updatedMessages = await editMessageContent(
          currentSession.filePath,
          uuid,
          blockEdits
        );
        setMessages(updatedMessages);
      } catch (err) {
        console.error('编辑消息失败:', err);
      }
    },
    [currentSession]
  );

  /**
   * 处理消息删除事件
   *
   * 从会话文件中移除指定消息。删除操作不可撤销，会直接修改 JSONL 文件。
   * 不再使用浏览器原生 confirm 对话框（在 Tauri WebView 中行为不一致），
   * 而是直接执行删除操作。
   *
   * @param uuid - 要删除的消息的 UUID
   */
  const handleDeleteMessage = useCallback(
    async (uuid: string) => {
      if (!currentSession) return;
      try {
        const updatedMessages = await deleteMessage(currentSession.filePath, uuid);
        setMessages(updatedMessages);
      } catch (err) {
        console.error('删除消息失败:', err);
      }
    },
    [currentSession]
  );

  /**
   * 切换单条消息的选中状态
   *
   * 在多选模式下，点击复选框或消息卡片时调用，
   * 通过创建新 Set 触发 React 状态更新和重新渲染。
   *
   * @param uuid - 要切换选中状态的消息 UUID
   */
  const handleToggleSelect = useCallback((uuid: string) => {
    setSelectedMessages(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return next;
    });
  }, []);

  /**
   * 全选当前过滤后可见的消息
   *
   * 将传入的所有消息 UUID 添加到已选集合中。
   * 此函数由 ChatView 调用，传入的是经过过滤后的消息列表。
   *
   * @param uuids - 要全选的消息 UUID 数组
   */
  const handleSelectAll = useCallback((uuids: string[]) => {
    setSelectedMessages(new Set(uuids));
  }, []);

  /**
   * 取消所有消息的选中状态
   */
  const handleDeselectAll = useCallback(() => {
    setSelectedMessages(new Set());
  }, []);

  /**
   * 批量删除所有已选中的消息
   *
   * 使用 deleteMessages 函数一次性从会话文件中移除所有选中的消息。
   * 删除完成后自动退出选择模式并清空选中状态。
   */
  const handleDeleteSelected = useCallback(async () => {
    if (!currentSession || selectedMessages.size === 0) return;
    try {
      const updatedMessages = await deleteMessages(currentSession.filePath, selectedMessages);
      setMessages(updatedMessages);
      // 删除完成后退出选择模式
      setSelectedMessages(new Set());
      setSelectionMode(false);
    } catch (err) {
      console.error('批量删除消息失败:', err);
    }
  }, [currentSession, selectedMessages]);

  /**
   * 切换选择模式的开启/关闭
   *
   * 关闭选择模式时自动清空已选择的消息，防止残留状态。
   */
  const handleToggleSelectionMode = useCallback(() => {
    setSelectionMode(prev => {
      if (prev) {
        // 退出选择模式时清空选择状态
        setSelectedMessages(new Set());
      }
      return !prev;
    });
  }, []);

  /**
   * 处理删除会话事件
   *
   * 从文件系统中删除会话的 JSONL 文件，然后刷新项目列表以反映变化。
   * 如果被删除的会话正是当前选中的会话，清除相关状态。
   *
   * @param sessionFilePath - 要删除的会话文件路径
   */
  const handleDeleteSession = useCallback(
    async (sessionFilePath: string) => {
      try {
        await deleteSession(sessionFilePath);
        // 如果删除的是当前正在查看的会话，清除选中状态和消息
        if (currentSession?.filePath === sessionFilePath) {
          setCurrentSession(null);
          setMessages([]);
          setSelectedMessages(new Set());
          setSelectionMode(false);
        }
        // 重新加载项目列表以刷新侧边栏
        const updatedProjects = await getProjects(claudeDataPath);
        setProjects(updatedProjects);
      } catch (err) {
        console.error('删除会话失败:', err);
      }
    },
    [claudeDataPath, currentSession]
  );

  /**
   * 处理会话导出事件
   *
   * 将当前会话的消息导出为指定格式（Markdown 或 JSON），
   * 使用 @tauri-apps/plugin-dialog 的 save() 弹出文件保存对话框让用户选择保存路径，
   * 然后通过 @tauri-apps/plugin-fs 的 writeTextFile() 写入文件。
   *
   * @param format - 导出格式：'markdown' 或 'json'
   */
  const handleExport = useCallback(
    async (format: 'markdown' | 'json') => {
      if (!currentSession || messages.length === 0) return;
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');

        const sessionName = currentSession.name || currentSession.id.substring(0, 8);
        const extension = format === 'markdown' ? 'md' : 'json';
        const content = format === 'markdown'
          ? exportAsMarkdown(messages, sessionName)
          : exportAsJson(messages);

        // 弹出系统文件保存对话框
        const filePath = await save({
          defaultPath: `${sessionName}.${extension}`,
          filters: [
            {
              name: format === 'markdown' ? 'Markdown' : 'JSON',
              extensions: [extension],
            },
          ],
        });

        // 用户取消保存时 filePath 为 null
        if (filePath) {
          await writeTextFile(filePath, content);
        }
      } catch (err) {
        console.error('导出会话失败:', err);
      }
    },
    [currentSession, messages]
  );

  /**
   * 处理设置保存事件
   *
   * 将更新后的设置对象保存到 ~/.claude/settings.json 文件，并更新本地状态。
   * 此回调在 SettingsPanel 处于"普通设置模式"时使用。
   *
   * @param newSettings - 更新后的完整设置对象
   */
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

  /**
   * 处理环境配置切换事件
   *
   * 将选定的环境配置组应用到 Claude Code 的 settings.json 中，
   * 同时更新环境切换器配置中的激活状态。
   * 切换后，Claude Code 的下一次启动将使用新的环境变量。
   *
   * @param profile - 要切换到的目标环境配置组
   */
  const handleSwitchEnvProfile = useCallback(
    async (profile: EnvProfile) => {
      try {
        // 将配置组的环境变量写入 settings.json
        const updatedSettings = await applyEnvProfile(claudeDataPath, profile);
        setSettings(updatedSettings);

        // 更新激活状态并持久化
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

  /**
   * 处理保存当前环境为新配置组事件
   *
   * 将当前 settings.json 中的 env 字段内容保存为一个新的命名配置组，
   * 并将其设置为激活状态。
   *
   * @param name - 新配置组的显示名称
   */
  const handleSaveEnvProfile = useCallback(
    async (name: string) => {
      try {
        const profile = await saveCurrentAsProfile(claudeDataPath, name);
        // 重新加载配置以确保数据一致性
        const updatedConfig = await readEnvSwitcherConfig(claudeDataPath);
        setEnvConfig(updatedConfig);
        console.log('保存配置成功:', profile.name);
      } catch (err) {
        console.error('保存环境配置失败:', err);
      }
    },
    [claudeDataPath]
  );

  /**
   * 处理删除环境配置组事件
   *
   * 从配置列表中移除指定的配置组。如果被删除的配置组是当前激活的，
   * 则将激活状态重置为 null（无激活配置）。
   *
   * @param profileId - 要删除的配置组 ID
   */
  const handleDeleteEnvProfile = useCallback(
    async (profileId: string) => {
      try {
        const updatedConfig = {
          ...envConfig,
          // 过滤掉目标配置组
          profiles: envConfig.profiles.filter(p => p.id !== profileId),
          // 如果删除的是当前激活的配置，重置激活状态为 null
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

  /**
   * 处理编辑环境配置组事件
   *
   * 将目标配置组设置为"正在编辑"状态，并打开设置面板。
   * 这会使 SettingsPanel 进入"配置编辑模式"，显示配置组的环境变量而非全局设置。
   *
   * @param profile - 要编辑的环境配置组
   */
  const handleEditEnvProfile = useCallback((profile: EnvProfile) => {
    setEditingEnvProfile(profile);
    setShowSettings(true);
  }, []);

  /**
   * 处理保存编辑后的环境配置组事件
   *
   * 更新配置组的环境变量内容和更新时间，然后持久化到配置文件。
   * 如果被编辑的配置组当前正在激活使用，还会同步更新 settings.json 中的 env 字段，
   * 确保修改立即生效。
   *
   * @param profile - 包含更新后数据的配置组对象
   */
  const handleSaveEditedProfile = useCallback(
    async (profile: EnvProfile) => {
      try {
        // 更新配置组的最后修改时间
        const updatedProfile = {
          ...profile,
          updatedAt: new Date().toISOString(),
        };
        // 在配置列表中替换目标配置组
        const updatedConfig = {
          ...envConfig,
          profiles: envConfig.profiles.map(p => p.id === profile.id ? updatedProfile : p),
        };
        await saveEnvSwitcherConfig(claudeDataPath, updatedConfig);
        setEnvConfig(updatedConfig);

        // 如果编辑的是当前激活的配置组，需要同步更新 settings.json
        if (profile.id === envConfig.activeProfileId) {
          await applyEnvProfile(claudeDataPath, updatedProfile);
          setSettings(prev => ({ ...prev, env: updatedProfile.env }));
        }

        // 退出编辑模式
        setEditingEnvProfile(null);
      } catch (err) {
        console.error('保存编辑配置失败:', err);
      }
    },
    [claudeDataPath, envConfig]
  );

  // ============ 条件渲染：加载中状态 ============
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 gradient-spinner mx-auto mb-4"></div>
          <p className="text-muted-foreground">正在加载 Claude Code 数据...</p>
        </div>
      </div>
    );
  }

  // ============ 条件渲染：错误状态 ============
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

  // ============ 正常渲染：主应用界面 ============
  return (
    <div className="h-screen w-screen overflow-hidden flex relative">
      {/* 左侧边栏：项目导航、会话列表、环境配置切换（折叠时隐藏）
          使用 AnimatePresence 包裹条件渲染，使侧边栏在显示/隐藏时可以执行进出场动画。
          AnimatePresence 会在子组件从 DOM 移除前等待其退出动画完成。 */}
      <AnimatePresence>
        {!sidebarCollapsed && (
          <Sidebar
            projects={projects}
            currentProject={currentProject}
            currentSession={currentSession}
            envConfig={envConfig}
            width={sidebarWidth}
            isResizing={isResizingSidebar}
            onSelectProject={setCurrentProject}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onOpenSettings={() => setShowSettings(true)}
            onSwitchEnvProfile={handleSwitchEnvProfile}
            onSaveEnvProfile={handleSaveEnvProfile}
            onDeleteEnvProfile={handleDeleteEnvProfile}
            onEditEnvProfile={handleEditEnvProfile}
            onCollapse={() => setSidebarCollapsed(true)}
          />
        )}
      </AnimatePresence>

      {/* 侧边栏拖动调整宽度的手柄：绝对定位覆盖在侧边栏右边缘上方，不占布局空间，避免视觉空隙 */}
      {!sidebarCollapsed && (
        <div
          onMouseDown={handleSidebarResizeStart}
          className="absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-20"
          style={{ left: sidebarWidth - 1 }}
        />
      )}

      {/* 主内容区：聊天消息展示和操作 */}
      <ChatView
        session={currentSession}
        messages={messages}
        onEditMessage={handleEditMessage}
        onDeleteMessage={handleDeleteMessage}
        onRefresh={handleRefresh}
        onExport={handleExport}
        selectionMode={selectionMode}
        selectedMessages={selectedMessages}
        onToggleSelect={handleToggleSelect}
        onSelectAll={handleSelectAll}
        onDeselectAll={handleDeselectAll}
        onDeleteSelected={handleDeleteSelected}
        onToggleSelectionMode={handleToggleSelectionMode}
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={() => setSidebarCollapsed(false)}
      />

      {/*
        设置面板（浮层）：根据 showSettings 条件渲染。
        使用 AnimatePresence 包裹，使面板在打开/关闭时可以执行进出场动画。
        支持两种渲染模式：

        1. 普通设置模式（editingEnvProfile 为 null）：
           - 显示全局 Claude Code 设置
           - onSaveSettings 直接调用 handleSaveSettings 保存到 settings.json

        2. 配置编辑模式（editingEnvProfile 不为 null）：
           - 显示指定环境配置组的环境变量
           - settings 属性被替换为配置组的 env 内容
           - onSaveSettings 被替换为一个包装函数，将编辑结果
             通过 handleSaveEditedProfile 保存到环境配置文件
      */}
      <AnimatePresence>
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
              // 关闭面板时同时退出配置编辑模式
              setEditingEnvProfile(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
