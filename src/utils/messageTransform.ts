/**
 * @file messageTransform.ts - 消息转换工具（精简版）
 * @description
 * 原有的消息分类和转换逻辑已全部迁移到 Rust 后端（classifier.rs + transformer.rs）。
 * 本文件仅保留前端需要的纯 UI 路径工具函数，用于：
 * - 计划消息的会话跳转按钮（parseJsonlPath）
 * - 工具显示的路径简化（toRelativePath）
 */

/**
 * 从 .jsonl 文件路径中解析出编码的项目名和会话 ID。
 * 路径格式：.../projects/<encodedProject>/<sessionId>.jsonl
 *
 * @param jsonlPath - JSONL 文件的完整路径
 * @returns 解析结果对象，包含 encodedProject 和 sessionId；解析失败返回 null
 *
 * @example
 * parseJsonlPath('C:\\Users\\MoYeR\\.claude\\projects\\G--ClaudeProjects-Test\\abc-123.jsonl')
 * // => { encodedProject: 'G--ClaudeProjects-Test', sessionId: 'abc-123' }
 */
export function parseJsonlPath(jsonlPath: string): { encodedProject: string; sessionId: string } | null {
  // 同时支持正斜杠和反斜杠路径分隔符
  const m = jsonlPath.match(/projects[/\\]([^/\\]+)[/\\]([^/\\]+)\.jsonl$/);
  return m ? { encodedProject: m[1], sessionId: m[2] } : null;
}

/**
 * 计算文件的相对路径
 *
 * 如果 filePath 以 projectPath 开头，返回去掉公共前缀后的相对路径。
 * 路径分隔符统一为正斜杠（/）。
 *
 * @param filePath - 文件绝对路径
 * @param projectPath - 项目根目录路径
 * @returns 相对路径（如果在项目内）或原始路径（如果不在项目内）
 *
 * @example
 * toRelativePath('G:\\Projects\\Test\\src\\main.rs', 'G:\\Projects\\Test')
 * // => 'src/main.rs'
 *
 * toRelativePath('/home/user/other/file.ts', '/home/user/project')
 * // => '/home/user/other/file.ts'（不在项目内，返回原始路径）
 */
export function toRelativePath(filePath: string, projectPath: string): string {
  // 统一为正斜杠以便跨平台比较
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedProject = projectPath.replace(/\\/g, '/').replace(/\/$/, '');

  if (normalizedFile.startsWith(normalizedProject + '/')) {
    return normalizedFile.slice(normalizedProject.length + 1);
  }

  return filePath;
}
