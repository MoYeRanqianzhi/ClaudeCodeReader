//! # 宠物（Companion/Buddy）数据模型
//!
//! 定义了 Claude Code 宠物系统（/buddy 命令）的 Rust 数据结构。
//! 宠物是 Claude Code 2026 年 4 月引入的虚拟伙伴功能，用户通过 `/buddy` 命令首次孵化。
//!
//! ## 存储结构
//! 宠物数据存储在全局配置文件 `~/.claude.json` 中：
//! ```json
//! {
//!   "companion": {
//!     "name": "Quackers",
//!     "personality": "A cheerful duck who loves debugging",
//!     "hatchedAt": 1711929600000
//!   },
//!   "companionMuted": false,
//!   "oauthAccount": {
//!     "accountUuid": "xxx-xxx-xxx"
//!   },
//!   "userID": "user_xxx"
//! }
//! ```
//!
//! ## 核心机制
//! - **骨架（Bones）**：由 `hash(userId + SALT)` 确定性生成，包括种族、稀有度、眼睛、帽子、属性等
//! - **灵魂（Soul）**：由模型生成的名字和性格描述，持久化存储在配置文件中
//! - 清除宠物 = 删除 `companion` 字段，下次执行 `/buddy` 即可重新孵化
//!
//! ## 与 Claude Code 源码的对应关系
//! - `StoredCompanion` 对应 `src/buddy/types.ts` 中的 `StoredCompanion`
//! - `CompanionBones` 对应 `src/buddy/types.ts` 中的 `CompanionBones`
//! - `Companion` 对应 `src/buddy/types.ts` 中的 `Companion`
//! - 随机生成逻辑对应 `src/buddy/companion.ts` 中的 `roll()` 和 `rollFrom()`

use serde::{Deserialize, Serialize};

// ==================== 常量定义 ====================

/// 宠物种族列表（18 种）
///
/// 对应 Claude Code 源码 `src/buddy/types.ts` 中的 `SPECIES` 常量。
/// 原始源码中使用 `String.fromCharCode()` 编码以规避构建检查，
/// 这里直接使用字符串字面量。
pub const SPECIES: &[&str] = &[
    "duck", "goose", "blob", "cat", "dragon", "octopus", "owl",
    "penguin", "turtle", "snail", "ghost", "axolotl", "capybara",
    "cactus", "robot", "rabbit", "mushroom", "chonk",
];

/// 稀有度等级列表（按从低到高排列）
///
/// 对应 Claude Code 源码 `src/buddy/types.ts` 中的 `RARITIES` 常量。
pub const RARITIES: &[&str] = &["common", "uncommon", "rare", "epic", "legendary"];

/// 稀有度权重表（用于抽取概率计算）
///
/// 总权重 = 60 + 25 + 10 + 4 + 1 = 100
/// - common: 60% 概率
/// - uncommon: 25% 概率
/// - rare: 10% 概率
/// - epic: 4% 概率
/// - legendary: 1% 概率
pub const RARITY_WEIGHTS: &[(& str, u32)] = &[
    ("common", 60),
    ("uncommon", 25),
    ("rare", 10),
    ("epic", 4),
    ("legendary", 1),
];

/// 稀有度对应的星级显示
///
/// 对应 Claude Code 源码 `src/buddy/types.ts` 中的 `RARITY_STARS` 常量。
pub const RARITY_STARS: &[(&str, &str)] = &[
    ("common", "\u{2605}"),           // ★
    ("uncommon", "\u{2605}\u{2605}"), // ★★
    ("rare", "\u{2605}\u{2605}\u{2605}"), // ★★★
    ("epic", "\u{2605}\u{2605}\u{2605}\u{2605}"), // ★★★★
    ("legendary", "\u{2605}\u{2605}\u{2605}\u{2605}\u{2605}"), // ★★★★★
];

/// 眼睛样式列表
///
/// 对应 Claude Code 源码 `src/buddy/types.ts` 中的 `EYES` 常量。
pub const EYES: &[&str] = &["·", "✦", "×", "◉", "@", "°"];

/// 帽子样式列表
///
/// 对应 Claude Code 源码 `src/buddy/types.ts` 中的 `HATS` 常量。
/// `none` 表示无帽子（common 稀有度固定为 none）。
pub const HATS: &[&str] = &[
    "none", "crown", "tophat", "propeller", "halo", "wizard", "beanie", "tinyduck",
];

/// 属性名称列表
///
/// 对应 Claude Code 源码 `src/buddy/types.ts` 中的 `STAT_NAMES` 常量。
pub const STAT_NAMES: &[&str] = &["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"];

/// 随机种子盐值
///
/// 对应 Claude Code 源码 `src/buddy/companion.ts` 中的 `SALT` 常量。
/// 用于与 userId 拼接后作为 PRNG 的种子。
pub const SALT: &str = "friend-2026-401";

// ==================== 数据结构 ====================

/// 宠物的持久化存储结构
///
/// 这是实际写入 `~/.claude.json` 中 `companion` 字段的数据。
/// 仅包含模型生成的「灵魂」部分，「骨架」部分由 userId 确定性计算。
///
/// 对应 Claude Code 源码 `src/buddy/types.ts` 中的 `StoredCompanion`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCompanion {
    /// 宠物名称（由模型在孵化时生成）
    pub name: String,

    /// 宠物性格描述（由模型在孵化时生成）
    pub personality: String,

    /// 孵化时间戳（毫秒级 Unix 时间戳）
    pub hatched_at: i64,
}

/// 宠物的骨架结构（确定性生成，不持久化）
///
/// 由 `hash(userId + SALT)` 通过 Mulberry32 PRNG 确定性生成。
/// 每次读取时实时计算，不存储在配置文件中。
/// 这意味着即使用户手动编辑配置文件中的 companion 字段，
/// 也无法伪造稀有度或种族。
///
/// 对应 Claude Code 源码 `src/buddy/types.ts` 中的 `CompanionBones`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionBones {
    /// 稀有度等级
    pub rarity: String,

    /// 种族（18 种之一）
    pub species: String,

    /// 眼睛样式
    pub eye: String,

    /// 帽子样式（common 固定为 "none"）
    pub hat: String,

    /// 是否为闪光版本（1% 概率）
    pub shiny: bool,

    /// 属性值字典（5 项属性，数值范围约 1-100）
    pub stats: std::collections::HashMap<String, u32>,
}

/// 宠物的完整信息（骨架 + 灵魂 + 孵化时间）
///
/// 合并了确定性生成的骨架和持久化存储的灵魂，
/// 是前端展示所需的完整数据结构。
///
/// 对应 Claude Code 源码 `src/buddy/types.ts` 中的 `Companion`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Companion {
    // -- 灵魂部分（从配置文件读取） --
    /// 宠物名称
    pub name: String,

    /// 宠物性格描述
    pub personality: String,

    /// 孵化时间戳（毫秒）
    pub hatched_at: i64,

    // -- 骨架部分（确定性生成） --
    /// 稀有度等级
    pub rarity: String,

    /// 种族
    pub species: String,

    /// 眼睛样式
    pub eye: String,

    /// 帽子样式
    pub hat: String,

    /// 是否闪光
    pub shiny: bool,

    /// 属性值
    pub stats: std::collections::HashMap<String, u32>,

    // -- 附加展示信息 --
    /// 稀有度星级显示（如 "★★★"）
    pub rarity_stars: String,
}

/// 宠物操作结果（用于前端反馈）
///
/// 清除或重新抽取操作后返回给前端的结果信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetActionResult {
    /// 操作是否成功
    pub success: bool,

    /// 操作描述消息
    pub message: String,
}
