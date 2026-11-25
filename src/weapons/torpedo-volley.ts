// 鱼雷齐射规划：开火前先判断这一轮鱼雷值不值得打。
//
// 规则：
//   1. 目标横船（船体大致垂直于我方视线）时按完整 3~5 枚齐射；
//      目标船头/船尾对着我方时只打最少 3 枚，避免把鱼雷浪费在很窄的投影上。
//   2. 鱼雷航线附近有友舰时不发射，避免误伤（炮弹跨射越过友舰不在此限）。
//   3. 航线被岛屿/礁石挡住时不发射，鱼雷会撞地形，打不中目标。
//
// 这里只做「能不能打 / 打几枚」的纯计算，不创建弹药；
// 真正发射仍由 fireWeapon 统一处理，保证弹道和散布参数只有一份。
import { angleDiff } from "../game/utils";
import type { TerrainField } from "../terrain";
import { muzzlePoint, predictAim, rollSalvo } from "./fire";
import { getWeaponSpec, type WeaponSpec } from "./spec";

/** 目标不是横船时也至少打这么多枚 */
export const TORPEDO_MIN_SALVO = 3;

/** 船体与视线的夹角在 90°±该值内，才算「横船面对我方」 */
const BROADSIDE_TOLERANCE = (35 * Math.PI) / 180;

/** 判断友舰是否会挡在鱼雷航线上时额外留出的安全半径 */
const FRIENDLY_SAFETY_MARGIN = 24;

/** 地形遮挡检测的采样步长 */
const TERRAIN_SAMPLE_STEP = 32;

/** 鱼雷规划需要的舰船信息（Ship 结构天然满足） */
export interface TorpedoVolleyShip {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  len: number;
  wid: number;
  team: "red" | "blue";
  alive: boolean;
}

export interface TorpedoVolleyParams {
  /** 发射舰船 */
  shooter: TorpedoVolleyShip;
  /** 目标舰船 */
  target: TorpedoVolleyShip;
  /** 战场上的全部舰船，用于友舰误伤检查 */
  ships: readonly TorpedoVolleyShip[];
  /** 地形场；null 表示没有地形遮挡 */
  field: TerrainField | null;
  /** 武器参数，缺省用鱼雷预设 */
  spec?: WeaponSpec;
  /** 随机源，缺省 Math.random */
  random?: () => number;
}

export interface TorpedoVolleyPlan {
  /** 本次齐射数量 */
  salvo: number;
  /** 齐射开始时预测的瞄准点；后续每一发都朝这里发射 */
  aim: { x: number; y: number };
}

/** 目标是否把船体横过来面对发射舰（横船投影更大，值得多打几枚） */
function isBroadside(shooter: TorpedoVolleyShip, target: TorpedoVolleyShip): boolean {
  // 从目标看发射舰的方位；目标航向与这条视线的夹角约 90° 时就是横船
  const toShooter = Math.atan2(shooter.y - target.y, shooter.x - target.x);
  const offset = Math.abs(angleDiff(target.angle, toShooter));
  return Math.abs(offset - Math.PI / 2) <= BROADSIDE_TOLERANCE;
}

/** 沿鱼雷直线航向按固定步长采样，判断是否会撞上地形 */
function isPathBlockedByTerrain(
  field: TerrainField,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  distance: number,
  radius: number,
): boolean {
  const steps = Math.max(1, Math.ceil(distance / TERRAIN_SAMPLE_STEP));
  for (let i = 0; i <= steps; i++) {
    const travel = (i / steps) * distance;
    if (field.isBlockedCircle(from.x + dx * travel, from.y + dy * travel, radius)) return true;
  }
  return false;
}

/**
 * 估算友舰与鱼雷航线的最近距离。
 * 鱼雷很慢，友舰在飞行途中也会移动，所以先按「鱼雷到达最近点的时间」
 * 预测友舰位置，再迭代一次，避免只拿当前坐标误判。
 */
function closestApproachToFriend(
  from: { x: number; y: number },
  dx: number,
  dy: number,
  speed: number,
  maxTime: number,
  friend: TorpedoVolleyShip,
): number {
  // 初始估计：友舰当前位置在航线上的投影
  let t = Math.max(0, (friend.x - from.x) * dx + (friend.y - from.y) * dy) / speed;
  for (let i = 0; i < 2; i++) {
    const px = friend.x + friend.vx * t;
    const py = friend.y + friend.vy * t;
    t = Math.max(0, (px - from.x) * dx + (py - from.y) * dy) / speed;
  }
  // 超出鱼雷寿命的友舰不可能被这轮鱼雷打到
  if (t > maxTime) return Infinity;

  const px = friend.x + friend.vx * t;
  const py = friend.y + friend.vy * t;
  const tx = from.x + dx * speed * t;
  const ty = from.y + dy * speed * t;
  return Math.hypot(px - tx, py - ty);
}

/**
 * 规划一轮鱼雷齐射。
 * @returns 可以发射时返回齐射数量；风险太高（友舰 / 地形）时返回 null
 */
export function planTorpedoVolley(params: TorpedoVolleyParams): TorpedoVolleyPlan | null {
  const { shooter, target, ships, field } = params;
  const spec = params.spec ?? getWeaponSpec("torp");
  const random = params.random ?? Math.random;

  // 预测目标位置，和真正发射时使用同一套提前量
  const aim = predictAim(shooter, target, spec.speed);
  const dx = aim.x - shooter.x;
  const dy = aim.y - shooter.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.001) return null;
  const dirX = dx / distance;
  const dirY = dy / distance;

  // 鱼雷从炮口射出，而不是船心；地形与友舰检查都从炮口开始
  const muzzle = muzzlePoint(shooter, Math.atan2(dy, dx), spec.muzzleOffset);

  // 1) 地形遮挡：鱼雷是直线航行，中间隔一座岛就必然打不中
  if (field && isPathBlockedByTerrain(field, muzzle, dirX, dirY, distance + spec.radius, spec.radius)) return null;

  // 2) 友舰误伤：鱼雷会继续飞完整射程，友舰可能在任何一段航线上
  const maxTime = spec.range / spec.speed;
  for (const friend of ships) {
    if (!friend.alive || friend === shooter || friend.team !== shooter.team) continue;
    const clearance = Math.hypot(friend.len, friend.wid) / 2 + spec.radius + FRIENDLY_SAFETY_MARGIN;
    if (closestApproachToFriend(muzzle, dirX, dirY, spec.speed, maxTime, friend) < clearance) return null;
  }

  // 3) 横船才值得打满齐射；否则只打最低数量，节省鱼雷
  const salvo = isBroadside(shooter, target) ? Math.max(TORPEDO_MIN_SALVO, rollSalvo(spec, random)) : TORPEDO_MIN_SALVO;
  return { salvo, aim };
}
