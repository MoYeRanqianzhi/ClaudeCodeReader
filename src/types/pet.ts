/**
 * @file pet.ts - Claude Code 宠物系统类型定义
 * @description
 * 定义了 Claude Code 宠物系统（/buddy 命令）相关的 TypeScript 类型。
 * 这些类型与 Rust 后端 `src-tauri/src/models/pet.rs` 中的数据结构一一对应。
 *
 * ## 宠物系统概述
 * 宠物（Companion/Buddy）是 Claude Code 2026年4月引入的虚拟伙伴功能。
 * 用户通过 `/buddy` 命令首次孵化宠物，宠物会在终端中陪伴用户。
 *
 * ## 数据存储
 * 宠物数据存储在 `~/.claude.json` 全局配置文件中的 `companion` 字段。
 * 骨架（种族、稀有度等）由 userId 确定性生成，不持久化。
 * 灵魂（名字、性格）由模型生成，持久化存储。
 */

// ==================== 常量 ====================

/**
 * 所有可能的宠物种族列表（18种）
 *
 * 对应 Claude Code 源码 `src/buddy/types.ts` 中的 `SPECIES` 常量。
 */
export const SPECIES = [
  'duck', 'goose', 'blob', 'cat', 'dragon', 'octopus', 'owl',
  'penguin', 'turtle', 'snail', 'ghost', 'axolotl', 'capybara',
  'cactus', 'robot', 'rabbit', 'mushroom', 'chonk',
] as const;

/** 宠物种族类型（18种之一） */
export type Species = typeof SPECIES[number];

/**
 * 稀有度等级（从低到高）
 *
 * 对应 Claude Code 源码 `src/buddy/types.ts` 中的 `RARITIES` 常量。
 */
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

/** 稀有度类型 */
export type Rarity = typeof RARITIES[number];

/**
 * 稀有度对应的中文显示名称
 */
export const RARITY_LABELS: Record<Rarity, string> = {
  common: '普通',
  uncommon: '稀有',
  rare: '精良',
  epic: '史诗',
  legendary: '传说',
};

/**
 * 稀有度对应的 CSS 颜色变量
 *
 * 使用项目的语义化 CSS 变量，不硬编码颜色值。
 */
export const RARITY_COLORS: Record<Rarity, string> = {
  common: 'var(--muted-foreground)',
  uncommon: '#22c55e',   // green-500
  rare: '#3b82f6',       // blue-500
  epic: 'var(--primary)', // 紫色，与项目主色调一致
  legendary: '#f59e0b',  // amber-500
};

/**
 * 稀有度对应的星级显示
 */
export const RARITY_STARS: Record<Rarity, string> = {
  common: '\u2605',
  uncommon: '\u2605\u2605',
  rare: '\u2605\u2605\u2605',
  epic: '\u2605\u2605\u2605\u2605',
  legendary: '\u2605\u2605\u2605\u2605\u2605',
};

/**
 * 种族对应的 emoji 图标（用于 UI 展示）
 */
export const SPECIES_EMOJI: Record<Species, string> = {
  duck: '\uD83E\uDD86',       // 🦆
  goose: '\uD83E\uDEB3',      // 🪿
  blob: '\uD83E\uDEAB',       // 🪫 (closest match)
  cat: '\uD83D\uDC31',        // 🐱
  dragon: '\uD83D\uDC32',     // 🐲
  octopus: '\uD83D\uDC19',    // 🐙
  owl: '\uD83E\uDD89',        // 🦉
  penguin: '\uD83D\uDC27',    // 🐧
  turtle: '\uD83D\uDC22',     // 🐢
  snail: '\uD83D\uDC0C',      // 🐌
  ghost: '\uD83D\uDC7B',      // 👻
  axolotl: '\uD83E\uDD8E',    // 🦎 (closest match)
  capybara: '\uD83E\uDDAB',   // 🦫 (closest match)
  cactus: '\uD83C\uDF35',     // 🌵
  robot: '\uD83E\uDD16',      // 🤖
  rabbit: '\uD83D\uDC30',     // 🐰
  mushroom: '\uD83C\uDF44',   // 🍄
  chonk: '\uD83D\uDC3B',      // 🐻 (closest match)
};

/**
 * 种族对应的中文显示名称
 */
export const SPECIES_LABELS: Record<Species, string> = {
  duck: '鸭子',
  goose: '鹅',
  blob: '史莱姆',
  cat: '猫',
  dragon: '龙',
  octopus: '章鱼',
  owl: '猫头鹰',
  penguin: '企鹅',
  turtle: '乌龟',
  snail: '蜗牛',
  ghost: '幽灵',
  axolotl: '六角恐龙',
  capybara: '水豚',
  cactus: '仙人掌',
  robot: '机器人',
  rabbit: '兔子',
  mushroom: '蘑菇',
  chonk: '胖墩',
};

// ==================== 数据接口 ====================

/**
 * 宠物的完整信息（骨架 + 灵魂）
 *
 * 对应 Rust 后端 `models::pet::Companion`。
 * 由后端将确定性生成的骨架和持久化存储的灵魂合并后返回。
 */
export interface Companion {
  // -- 灵魂部分（从配置文件读取） --
  /** 宠物名称（由模型在孵化时生成） */
  name: string;
  /** 宠物性格描述（由模型在孵化时生成） */
  personality: string;
  /** 孵化时间戳（毫秒级 Unix 时间戳） */
  hatchedAt: number;

  // -- 骨架部分（确定性生成） --
  /** 稀有度等级 */
  rarity: Rarity;
  /** 种族 */
  species: Species;
  /** 眼睛样式 */
  eye: string;
  /** 帽子样式 */
  hat: string;
  /** 是否为闪光版本 */
  shiny: boolean;
  /** 属性值字典（5项属性） */
  stats: Record<string, number>;

  // -- 附加展示信息 --
  /** 稀有度星级显示（如 "★★★"） */
  rarityStars: string;
}

/**
 * 宠物骨架结构（确定性生成，不持久化）
 *
 * 对应 Rust 后端 `models::pet::CompanionBones`。
 */
export interface CompanionBones {
  /** 稀有度等级 */
  rarity: string;
  /** 种族 */
  species: string;
  /** 眼睛样式 */
  eye: string;
  /** 帽子样式 */
  hat: string;
  /** 是否闪光 */
  shiny: boolean;
  /** 属性值 */
  stats: Record<string, number>;
}

/**
 * 宠物操作结果
 *
 * 对应 Rust 后端 `models::pet::PetActionResult`。
 */
export interface PetActionResult {
  /** 操作是否成功 */
  success: boolean;
  /** 操作描述消息 */
  message: string;
}
