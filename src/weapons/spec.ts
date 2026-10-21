// 武器参数表：主炮（炮弹）与鱼雷
// 数值集中在这里，游戏主场景和 playground 调试页共用同一份配置。
import type { ProjectileType } from "./types";

/** 武器类型 */
export type WeaponId = ProjectileType;

/** 单个武器的完整参数 */
export interface WeaponSpec {
  /** 武器类型 */
  id: WeaponId;
  /** 弹速（像素/秒） */
  speed: number;
  /** 伤害值 */
  damage: number;
  /** 碰撞半径 */
  radius: number;
  /** 单次齐射数量下限 */
  salvoMin: number;
  /** 单次齐射数量上限 */
  salvoMax: number;
  /** 单次齐射中「精准弹」的数量：这些弹直取瞄准点，不做散布 */
  accurateCount: number;
  /** 最大射程（像素），超出射程不发射；弹药最多也只飞到这么远 */
  range: number;
  /** 两次齐射之间的冷却下限（秒） */
  cooldownMin: number;
  /** 两次齐射之间的冷却上限（秒） */
  cooldownMax: number;
  /** 开局初始冷却下限（秒） */
  initialCooldownMin: number;
  /** 开局初始冷却上限（秒） */
  initialCooldownMax: number;
  /** 瞄准散布半径（像素） */
  scatter: number;
  /** 曲射弯曲度（相对弦长），0 = 直线 */
  bend: number;
  /** 炮口离发射平台的距离 */
  muzzleOffset: number;
  /** 炮口粒子数量 */
  muzzleParticles: number;
  /** 炮口粒子颜色 */
  muzzleColor: string;
  /** 命中时的粒子数量 */
  impactParticles: number;
  /** 命中时的粒子颜色 */
  impactColor: string;
  /** 对舰船的威胁半径（规避判定） */
  dangerRadius: number;
  /** 贴图宽度 */
  textureWidth: number;
  /** 贴图高度 */
  textureHeight: number;
  /** 场景中的显示宽度 */
  spriteWidth: number;
  /** 场景中的显示高度 */
  spriteHeight: number;
}

/** 武器参数表 */
export const WEAPON_SPECS: Record<WeaponId, WeaponSpec> = {
  // 主炮：单发曲射，弹道略微弯曲；射程有限，弹着点不会拖到地图边缘
  shell: {
    id: "shell",
    speed: 528,
    damage: 10,
    radius: 26,
    salvoMin: 1,
    salvoMax: 1,
    accurateCount: 0,
    range: 1100,
    cooldownMin: 1.6,
    cooldownMax: 2.4,
    initialCooldownMin: 0.8,
    initialCooldownMax: 2.0,
    scatter: 60,
    bend: 0.12,
    muzzleOffset: 46,
    muzzleParticles: 6,
    muzzleColor: "#ffd166",
    impactParticles: 12,
    impactColor: "#ffd166",
    dangerRadius: 40,
    textureWidth: 32,
    textureHeight: 32,
    spriteWidth: 18,
    spriteHeight: 18,
  },
  // 鱼雷：低频齐射，一次随机 3~5 发；其中一颗直取瞄准点，其余散开
  torp: {
    id: "torp",
    speed: 150,
    damage: 30,
    radius: 34,
    salvoMin: 3,
    salvoMax: 5,
    accurateCount: 1,
    range: 1600,
    cooldownMin: 11,
    cooldownMax: 15,
    initialCooldownMin: 6,
    initialCooldownMax: 9,
    scatter: 60,
    bend: 0,
    muzzleOffset: 46,
    muzzleParticles: 0,
    muzzleColor: "#8ee7ff",
    impactParticles: 30,
    impactColor: "#ff9f43",
    dangerRadius: 48,
    textureWidth: 48,
    textureHeight: 20,
    spriteWidth: 22,
    spriteHeight: 9,
  },
};

/** 全部武器类型（按展示顺序） */
export const WEAPON_IDS: WeaponId[] = ["shell", "torp"];

/** 取武器参数 */
export function getWeaponSpec(id: WeaponId): WeaponSpec {
  return WEAPON_SPECS[id];
}
