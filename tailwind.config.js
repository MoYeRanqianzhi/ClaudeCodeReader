/**
 * @file Tailwind CSS 主题配置文件
 *
 * 本文件定义了 ClaudeCodeReader 的 Tailwind CSS 主题配置，
 * 基于 shadcn/ui 设计系统扩展了语义化颜色令牌（semantic color tokens）
 * 和统一的圆角变量，确保整个应用的视觉风格一致。
 *
 * 颜色值通过 CSS 自定义属性（CSS Variables）以 HSL 格式定义，
 * 从而支持运行时的深色模式切换，而无需重新编译样式。
 *
 * @type {import('tailwindcss').Config}
 */

/** @type {import('tailwindcss').Config} */
export default {
  // content：指定 Tailwind 的内容扫描范围
  // Tailwind 会扫描这些文件中使用的类名，并在最终 CSS 中仅保留被引用的样式，
  // 从而实现 CSS 的 Tree-Shaking，大幅减小生产构建的文件体积。
  content: [
    "./index.html",                  // 根 HTML 模板
    "./src/**/*.{js,ts,jsx,tsx}",    // 所有前端源码文件
  ],

  // darkMode: 'class'：通过在 <html> 元素上添加/移除 `dark` CSS 类名来切换深色模式。
  // 这种方式允许用户手动控制主题，而非完全依赖操作系统的偏好设置。
  darkMode: 'class',

  theme: {
    extend: {
      // colors：基于 shadcn/ui 设计系统的语义化颜色令牌
      // 所有颜色均通过 HSL CSS 变量引用，支持在全局 CSS 中统一切换亮色/暗色主题。
      // 每个颜色令牌都有明确的语义用途，避免在组件中使用硬编码的颜色值。
      colors: {
        // border：通用边框颜色，用于分隔线、卡片边框等
        border: "hsl(var(--border))",
        // input：输入框的边框颜色
        input: "hsl(var(--input))",
        // ring：焦点环（focus ring）颜色，用于键盘导航时的可访问性提示
        ring: "hsl(var(--ring))",

        // background：页面基础背景色
        background: "hsl(var(--background))",
        // foreground：页面基础前景色（默认文字颜色）
        foreground: "hsl(var(--foreground))",

        // primary：主要操作色，用于主按钮、用户消息标签、重要交互元素等
        primary: {
          DEFAULT: "hsl(var(--primary))",             // 主色背景
          foreground: "hsl(var(--primary-foreground))", // 主色上的文字颜色
        },

        // secondary：次要元素背景色，用于辅助按钮、标签、次级区域等
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },

        // destructive：破坏性操作色，用于删除按钮、错误提示、危险操作等
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },

        // muted：弱化色，用于占位文字、禁用状态、辅助说明文字等
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },

        // accent：强调色，用于悬停高亮、选中状态、侧边栏活动项等
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },

        // card：卡片容器色，用于对话气泡、面板、弹出层等卡片式容器的背景
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },

      // borderRadius：统一圆角配置
      // 通过 CSS 变量 `--radius` 控制基准圆角值，各尺寸在此基础上递减，
      // 确保整个应用中所有组件的圆角风格保持一致。
      borderRadius: {
        lg: "var(--radius)",                  // 大圆角：直接使用基准值
        md: "calc(var(--radius) - 2px)",      // 中圆角：基准值减 2px
        sm: "calc(var(--radius) - 4px)",      // 小圆角：基准值减 4px
      },
    },
  },

  // plugins：Tailwind 插件列表（当前未启用额外插件）
  plugins: [],
}
