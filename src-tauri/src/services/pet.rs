//! # 宠物服务模块
//!
//! 实现 Claude Code 宠物系统（/buddy）的核心业务逻辑：
//! - 读取当前宠物信息（从 `~/.claude.json` 中解析）
//! - 清除宠物记录（删除 `companion` 字段）
//! - 确定性骨架生成（Mulberry32 PRNG + FNV-1a 哈希）
//!
//! ## 技术细节
//! - 全局配置文件路径：`~/.claude.json`（默认）或 `~/.claude/.config.json`（旧版兼容）
//! - 骨架生成使用 `hash(userId + "friend-2026-401")` 作为 PRNG 种子
//! - 所有文件操作均为异步，避免阻塞 Tauri 主线程

use std::collections::HashMap;
use std::path::PathBuf;

use crate::models::pet::{
    Companion, CompanionBones, PetActionResult, StoredCompanion,
    EYES, HATS, RARITY_STARS, RARITY_WEIGHTS, SALT, SPECIES, STAT_NAMES,
};

// ==================== 路径工具 ====================

/// 获取 Claude Code 全局配置文件路径
///
/// Claude Code 配置文件有两个可能的位置（按优先级）：
/// 1. `~/.claude/.config.json`（旧版兼容路径）
/// 2. `~/.claude.json`（默认路径）
///
/// 对应 Claude Code 源码 `src/utils/env.ts` 中的 `getGlobalClaudeFile`。
fn get_global_claude_file() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;

    // 优先检查旧版配置路径
    let legacy_path = home.join(".claude").join(".config.json");
    if legacy_path.exists() {
        return Ok(legacy_path);
    }

    // 默认路径
    Ok(home.join(".claude.json"))
}

// ==================== Mulberry32 PRNG ====================

/// Mulberry32 伪随机数生成器
///
/// 轻量级的种子 PRNG，足以满足宠物抽取的随机需求。
/// 对应 Claude Code 源码 `src/buddy/companion.ts` 中的 `mulberry32` 函数。
///
/// 每次调用 `next()` 返回一个 [0, 1) 范围的 f64 值。
///
/// ## JS/Rust 一致性验证
///
/// JavaScript 版本在运算过程中使用 `|0`（截断为有符号 i32）和 `>>> 0`（转为无符号 u32），
/// 中间状态以 i32 存储。Rust 版本全程使用 u32。两者在位级别完全等价，原因：
///
/// 1. **wrapping 加法/乘法的低 32 位不受符号影响** —— i32 和 u32 的 wrapping_add/wrapping_mul
///    产生相同的位模式（补码运算的数学性质）。
/// 2. **`Math.imul(a, b)` 与 `u32::wrapping_mul`** —— Math.imul 对操作数执行 ToInt32
///    后取乘积的低 32 位，与 u32 wrapping_mul 的位模式一致。
/// 3. **`>>> n`（无符号右移）与 `u32 >> n`** —— JS 的 `>>>` 先将操作数转为 u32 再右移，
///    与 Rust 的 u32 右移完全相同。
/// 4. **最终输出** —— JS 用 `>>> 0` 将结果转为 u32 后除以 2^32，
///    Rust 直接将 u32 转为 f64 后除以 2^32，结果一致。
///
/// 已通过交叉验证确认：给定相同种子，JS 和 Rust 产生相同的随机数序列。
struct Mulberry32 {
    /// 内部状态（32位无符号整数）
    state: u32,
}

impl Mulberry32 {
    /// 使用指定种子创建新的 Mulberry32 PRNG
    fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    /// 生成下一个 [0, 1) 范围的随机数
    ///
    /// 算法与 JavaScript 版本完全对齐，确保给定相同种子时
    /// 生成的随机序列与 Claude Code 前端一致。
    ///
    /// JS 原版（companion.ts:17-24）:
    /// ```js
    /// a |= 0;                                            // i32 截断（对 u32 位模式无影响）
    /// a = (a + 0x6d2b79f5) | 0;                          // wrapping add, 截断 i32
    /// let t = Math.imul(a ^ (a >>> 15), 1 | a);          // wrapping mul, 结果 i32
    /// t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;   // wrapping add+mul+xor
    /// return ((t ^ (t >>> 14)) >>> 0) / 4294967296;      // >>> 0 转 u32, 除以 2^32
    /// ```
    fn next(&mut self) -> f64 {
        // 对应 JS: a = (a + 0x6d2b79f5) | 0
        self.state = self.state.wrapping_add(0x6D2B79F5);
        let mut t = self.state;
        // 对应 JS: Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t ^ (t >> 15)).wrapping_mul(1 | t);
        // 对应 JS: (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
        // 对应 JS: ((t ^ (t >>> 14)) >>> 0) / 4294967296
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

// ==================== 哈希函数 ====================

/// FNV-1a 字符串哈希
///
/// 将字符串转换为 32 位无符号整数，作为 Mulberry32 的种子。
/// 对应 Claude Code 源码 `src/buddy/companion.ts` 中的 `hashString` 函数。
///
/// ## JS/Rust 一致性验证
///
/// JS 版本（companion.ts:27-37）在非 Bun 环境下：
/// ```js
/// let h = 2166136261;                    // FNV offset basis
/// for (let i = 0; i < s.length; i++) {
///   h ^= s.charCodeAt(i);               // XOR with UTF-16 code unit
///   h = Math.imul(h, 16777619);          // FNV prime, wrapping mul → i32
/// }
/// return h >>> 0;                        // 最终转为 u32
/// ```
///
/// `Math.imul` 返回 i32，但最终 `>>> 0` 转为 u32。
/// Rust 全程使用 u32 的 wrapping_mul，位模式与 JS 一致（原理同 Mulberry32）。
///
/// 注意：JS 版本有 Bun 特殊分支（使用 `Bun.hash`），这里对应的是非 Bun 的 FNV-1a 分支，
/// 因为 CCR 不在 Bun 运行时中运行。Claude Code CLI 在 Node.js/Bun 环境下运行时，
/// 如果使用 Bun 则哈希结果会不同——但实际上 Claude Code 的官方发布版使用 Node.js，
/// 所以 FNV-1a 分支是正确的对齐目标。
///
/// 注意：JavaScript 版本逐字符（charCode）处理，这里也按 UTF-16 代码单元处理
/// 以确保与前端哈希结果一致。
fn hash_string(s: &str) -> u32 {
    let mut h: u32 = 2166136261;
    // 按 UTF-16 编码单元迭代，与 JavaScript 的 charCodeAt 行为一致
    for code_unit in s.encode_utf16() {
        h ^= code_unit as u32;
        h = h.wrapping_mul(16777619);
    }
    h
}

// ==================== 骨架生成 ====================

/// 从 PRNG 中随机选择数组元素
fn pick<'a>(rng: &mut Mulberry32, arr: &[&'a str]) -> &'a str {
    let idx = (rng.next() * arr.len() as f64).floor() as usize;
    arr[idx.min(arr.len() - 1)]
}

/// 从 PRNG 中选择属性名称
fn pick_stat(rng: &mut Mulberry32) -> &'static str {
    let idx = (rng.next() * STAT_NAMES.len() as f64).floor() as usize;
    STAT_NAMES[idx.min(STAT_NAMES.len() - 1)]
}

/// 抽取稀有度等级
///
/// 基于加权概率随机选择稀有度。
/// 对应 Claude Code 源码 `src/buddy/companion.ts` 中的 `rollRarity` 函数。
fn roll_rarity(rng: &mut Mulberry32) -> &'static str {
    let total: u32 = RARITY_WEIGHTS.iter().map(|(_, w)| w).sum();
    let mut roll = rng.next() * total as f64;

    for &(rarity, weight) in RARITY_WEIGHTS {
        roll -= weight as f64;
        if roll < 0.0 {
            return rarity;
        }
    }
    "common"
}

/// 稀有度对应的属性下限值
///
/// 对应 Claude Code 源码 `src/buddy/companion.ts` 中的 `RARITY_FLOOR` 常量。
fn rarity_floor(rarity: &str) -> u32 {
    match rarity {
        "common" => 5,
        "uncommon" => 15,
        "rare" => 25,
        "epic" => 35,
        "legendary" => 50,
        _ => 5,
    }
}

/// 抽取宠物属性值
///
/// 生成规则：
/// - 一个峰值属性（floor + 50 + random(0..30)），上限 100
/// - 一个低谷属性（floor - 10 + random(0..15)），下限 1
/// - 其余属性在 floor 到 floor+40 之间均匀分布
///
/// 对应 Claude Code 源码 `src/buddy/companion.ts` 中的 `rollStats` 函数。
fn roll_stats(rng: &mut Mulberry32, rarity: &str) -> HashMap<String, u32> {
    let floor = rarity_floor(rarity);
    let peak = pick_stat(rng).to_string();
    let mut dump = pick_stat(rng).to_string();
    // 确保 dump 与 peak 不同
    while dump == peak {
        dump = pick_stat(rng).to_string();
    }

    let mut stats = HashMap::new();
    for &name in STAT_NAMES {
        let value = if name == peak {
            // 峰值属性：高数值
            (floor + 50 + (rng.next() * 30.0).floor() as u32).min(100)
        } else if name == dump {
            // 低谷属性：低数值
            (floor as i32 - 10 + (rng.next() * 15.0).floor() as i32).max(1) as u32
        } else {
            // 普通属性
            floor + (rng.next() * 40.0).floor() as u32
        };
        stats.insert(name.to_string(), value);
    }
    stats
}

/// 生成宠物骨架
///
/// 从 userId 确定性地生成宠物的全部骨架属性。
/// 对应 Claude Code 源码 `src/buddy/companion.ts` 中的 `roll` + `rollFrom` 函数。
fn generate_bones(user_id: &str) -> CompanionBones {
    // 使用 userId + SALT 作为种子
    let key = format!("{}{}", user_id, SALT);
    let seed = hash_string(&key);
    let mut rng = Mulberry32::new(seed);

    let rarity = roll_rarity(&mut rng).to_string();
    let species = pick(&mut rng, SPECIES).to_string();
    let eye = pick(&mut rng, EYES).to_string();
    // common 稀有度固定无帽子
    let hat = if rarity == "common" {
        "none".to_string()
    } else {
        pick(&mut rng, HATS).to_string()
    };
    let shiny = rng.next() < 0.01;
    let stats = roll_stats(&mut rng, &rarity);

    CompanionBones {
        rarity,
        species,
        eye,
        hat,
        shiny,
        stats,
    }
}

/// 获取稀有度对应的星级字符串
fn get_rarity_stars(rarity: &str) -> String {
    RARITY_STARS
        .iter()
        .find(|(r, _)| *r == rarity)
        .map(|(_, s)| s.to_string())
        .unwrap_or_else(|| "\u{2605}".to_string())
}

// ==================== 公开服务接口 ====================

/// 从全局配置文件中提取 userId
///
/// 优先使用 `oauthAccount.accountUuid`，其次使用 `userID`，
/// 最后回退到 `"anon"`。
///
/// 对应 Claude Code 源码 `src/buddy/companion.ts` 中的 `companionUserId` 函数。
fn extract_user_id(config: &serde_json::Value) -> String {
    // 优先：oauthAccount.accountUuid
    if let Some(uuid) = config
        .get("oauthAccount")
        .and_then(|o| o.get("accountUuid"))
        .and_then(|v| v.as_str())
    {
        return uuid.to_string();
    }

    // 其次：userID
    if let Some(user_id) = config.get("userID").and_then(|v| v.as_str()) {
        return user_id.to_string();
    }

    // 兜底
    "anon".to_string()
}

/// 读取当前宠物的完整信息
///
/// 从 `~/.claude.json` 读取配置，提取 `companion` 字段（灵魂），
/// 然后根据 userId 确定性生成骨架，合并为完整的 `Companion`。
///
/// # 返回值
/// - `Ok(Some(companion))` - 用户已孵化宠物
/// - `Ok(None)` - 用户尚未孵化宠物（companion 字段不存在）
/// - `Err(msg)` - 配置文件读取或解析失败
pub async fn get_current_companion() -> Result<Option<Companion>, String> {
    let config_path = get_global_claude_file()?;

    // 配置文件不存在 → 尚未使用过 Claude Code
    if !config_path.exists() {
        return Ok(None);
    }

    let content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("读取 Claude 配置文件失败: {}", e))?;

    let config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 Claude 配置文件失败: {}", e))?;

    // 提取 companion 字段
    let stored: StoredCompanion = match config.get("companion") {
        Some(v) => {
            serde_json::from_value(v.clone()).map_err(|e| format!("解析 companion 数据失败: {}", e))?
        }
        None => return Ok(None), // 尚未孵化
    };

    // 提取 userId 并生成骨架
    let user_id = extract_user_id(&config);
    let bones = generate_bones(&user_id);
    let rarity_stars = get_rarity_stars(&bones.rarity);

    // 合并骨架和灵魂
    Ok(Some(Companion {
        name: stored.name,
        personality: stored.personality,
        hatched_at: stored.hatched_at,
        rarity: bones.rarity,
        species: bones.species,
        eye: bones.eye,
        hat: bones.hat,
        shiny: bones.shiny,
        stats: bones.stats,
        rarity_stars,
    }))
}

/// 清除宠物记录
///
/// 从 `~/.claude.json` 中删除 `companion` 字段。
/// 下次用户在 Claude Code 中执行 `/buddy` 即可重新孵化。
///
/// 使用 JSON 级别的精确编辑，不影响配置文件中的其他字段。
pub async fn clear_companion() -> Result<PetActionResult, String> {
    let config_path = get_global_claude_file()?;

    if !config_path.exists() {
        return Ok(PetActionResult {
            success: false,
            message: "Claude 配置文件不存在，无需清除".to_string(),
        });
    }

    let content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("读取 Claude 配置文件失败: {}", e))?;

    let mut config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 Claude 配置文件失败: {}", e))?;

    // 检查 companion 字段是否存在
    if config.get("companion").is_none() {
        return Ok(PetActionResult {
            success: false,
            message: "当前没有宠物记录需要清除".to_string(),
        });
    }

    // 删除 companion 字段
    if let Some(obj) = config.as_object_mut() {
        obj.remove("companion");
    }

    // 写回配置文件
    //
    // ## 格式选择说明
    //
    // Claude Code 源码（src/utils/config.ts:1134-1136）使用：
    //   `jsonStringify(filteredConfig, null, 2)` — 即 2 空格缩进的 pretty print。
    // `serde_json::to_string_pretty` 默认也是 2 空格缩进，格式与 Claude Code 一致。
    //
    // ## 已知限制：key 顺序
    //
    // serde_json::Value 内部使用 BTreeMap（字母序排列），而 JavaScript 的
    // JSON.stringify 保持对象的插入顺序。因此写回后 key 的排列顺序可能与原文件不同。
    // 这不影响功能正确性（JSON 规范不依赖 key 顺序），但用户手动查看文件时可能注意到
    // key 顺序变化。此行为与 Claude Code 自身的写入行为也存在类似的顺序不稳定性
    // （config.ts 中的 `filterBy` 会过滤掉默认值字段，也会改变 key 集合）。
    //
    // 如果未来需要严格保持 key 顺序，可以切换为 `serde_json::Map`（基于 BTreeMap）
    // 配合 `preserve_order` feature（基于 IndexMap）来保持解析时的插入顺序。
    let updated = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;

    tokio::fs::write(&config_path, updated)
        .await
        .map_err(|e| format!("写入 Claude 配置文件失败: {}", e))?;

    Ok(PetActionResult {
        success: true,
        message: "宠物记录已清除，下次使用 /buddy 可重新孵化".to_string(),
    })
}

/// 获取宠物的骨架预览（不需要已孵化）
///
/// 仅根据当前 userId 计算骨架属性，用于预览重新抽取后可能得到的宠物。
/// 注意：由于骨架是确定性的（基于 userId），同一用户永远会得到相同的骨架。
/// 要获得不同的宠物，需要使用不同的账号。
pub async fn preview_bones() -> Result<CompanionBones, String> {
    let config_path = get_global_claude_file()?;

    if !config_path.exists() {
        // 配置文件不存在时使用 "anon" 作为 userId
        return Ok(generate_bones("anon"));
    }

    let content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("读取 Claude 配置文件失败: {}", e))?;

    let config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 Claude 配置文件失败: {}", e))?;

    let user_id = extract_user_id(&config);
    Ok(generate_bones(&user_id))
}
