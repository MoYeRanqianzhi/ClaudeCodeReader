/**
 * @file PostCSS 配置文件
 *
 * PostCSS 是一个 CSS 后处理工具，通过插件管道对 CSS 进行转换。
 * 在本项目中，PostCSS 在 Vite 构建流程中自动调用，负责：
 * 1. 将 Tailwind CSS 指令（如 @tailwind、@apply）编译为标准 CSS
 * 2. 自动为 CSS 属性添加浏览器厂商前缀以确保兼容性
 */
export default {
  plugins: {
    // @tailwindcss/postcss：Tailwind CSS 的 PostCSS 插件
    // 负责解析源码中的 Tailwind 指令（@tailwind base/components/utilities）
    // 以及工具类（如 `bg-primary`、`text-sm`），并将其编译为实际的 CSS 规则。
    '@tailwindcss/postcss': {},

    // autoprefixer：自动添加浏览器厂商前缀的 PostCSS 插件
    // 根据 browserslist 配置，为需要兼容的 CSS 属性自动补全前缀，
    // 例如将 `display: flex` 补充为 `-webkit-flex` 等，确保跨浏览器兼容性。
    autoprefixer: {},
  },
}
