/**
 * @file ESLint 扁平配置文件（Flat Config）
 *
 * 本文件使用 ESLint 9+ 的扁平配置格式（Flat Config），
 * 替代了传统的 `.eslintrc` 层级配置方式。
 * 扁平配置通过 JavaScript 数组定义规则集，更加直观和可组合。
 *
 * 配置要点：
 * - 仅对 TypeScript 文件（.ts/.tsx）执行 lint 检查
 * - 集成 React Hooks 和 React Refresh 规则
 * - 排除构建产物目录
 */

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // globalIgnores：全局忽略规则
  // 排除 `dist/` 目录（Vite 构建产物），避免对打包后的代码进行 lint 检查
  globalIgnores(['dist']),
  {
    // files：指定此规则集仅应用于 TypeScript 文件
    // 仅检查 .ts 和 .tsx 文件，JavaScript 文件不在 lint 范围内
    files: ['**/*.{ts,tsx}'],

    // extends：继承的规则集列表，按顺序叠加
    extends: [
      // JavaScript 基础推荐规则：包含 ESLint 官方推荐的 JS 最佳实践规则
      // 例如：禁止未使用变量、禁止隐式全局变量、要求使用 === 等
      js.configs.recommended,

      // TypeScript 推荐规则：在 JS 规则基础上添加 TypeScript 类型检查规则
      // 例如：禁止 any 类型的隐式使用、要求显式返回类型等
      tseslint.configs.recommended,

      // React Hooks 使用规则：确保 Hooks 的调用符合 React 规范
      // 例如：Hooks 只能在组件顶层调用、useEffect 依赖数组必须完整等
      reactHooks.configs.flat.recommended,

      // React Refresh（热更新）兼容规则：确保组件导出方式与 React Fast Refresh 兼容
      // 例如：模块只能默认导出 React 组件，不能混合导出其他值
      reactRefresh.configs.vite,
    ],

    // languageOptions：语言解析选项
    languageOptions: {
      // ecmaVersion：指定 ECMAScript 版本为 2020
      // 支持可选链（?.）、空值合并（??）、动态 import() 等现代语法
      ecmaVersion: 2020,

      // globals：声明全局变量来源为浏览器环境
      // 包含 window、document、fetch、localStorage 等浏览器 API，
      // 使 ESLint 不会将这些全局变量报告为未定义。
      globals: globals.browser,
    },
  },
])
