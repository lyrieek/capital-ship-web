export { WORLD_H as H, WORLD_W as W } from "./world";
import { WORLD_H } from "./world";

export interface GameConfig {
  // 基础航速（像素/秒）
  moveSpeed: number;

  // 正常状态下的速度系数
  normalFactor: number;

  // 规避/回正状态下的速度系数
  dodgeFactor: number;

  // 转弯速度（弧度/秒）
  turnRate: number;

  // 炮管转向目标的速度（弧度/秒），应明显慢于舰体转向
  turretTurnRate: number;

  // 规避阶段持续时间（秒）
  dodgeDuration: number;

  // 回正阶段最短持续时间（秒）
  recoverDuration: number;

  // 规避横向偏移距离（保留参考）
  dodgeSideDist: number;

  // 回正阶段武器射速惩罚系数（规避阶段直接停火）
  firePenalty: number;

  // 舰船最小安全距离
  minSep: number;

  // Y坐标最小值（下边界）
  yMin: number;

  // Y坐标最大值（上边界）
  yMax: number;
}

export const TAU = Math.PI * 2;

// 舰船与边界保持的间距：按地图高度成比例（原 70 / 900 ≈ 7.8%）
const EDGE_MARGIN = Math.round(WORLD_H * 0.06);

// 游戏参数配置
export const P: GameConfig = {
  moveSpeed: 120,
  normalFactor: 0.5,
  dodgeFactor: 1.0,
  turnRate: (80 * Math.PI) / 180,
  // 炮管转动明显慢于舰体，避免瞬间对准
  turretTurnRate: (32 * Math.PI) / 180,
  dodgeDuration: 1.15,
  recoverDuration: 1.3,
  dodgeSideDist: 70,
  firePenalty: 0.5,
  minSep: 80,
  yMin: EDGE_MARGIN,
  yMax: WORLD_H - EDGE_MARGIN,
};

// 生成[a,b)区间内的随机数
export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

// 将值v限制在[a,b]范围内
export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

// 计算两个角度之间的最小差异（-π到π之间）
export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

// 将当前角度cur逐步接近目标角度target，每步最大变化为step
export function approachAngle(cur: number, target: number, step: number): number {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= step) return target;
  return cur + Math.sign(d) * step;
}

// 将数值cur逐步接近目标值target，每步最大变化为step（用于速度平滑）
export function approachValue(cur: number, target: number, step: number): number {
  if (Math.abs(target - cur) <= step) return target;
  return cur + Math.sign(target - cur) * step;
}

/** 点到线段的最近距离 */
export function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq > 0 ? clamp(((px - ax) * abx + (py - ay) * aby) / lengthSq, 0, 1) : 0;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/**
 * 计算点到舰船胶囊轮廓的最近距离（像素）。
 * 胶囊 = 沿航向的线段 + 半舰宽半径；返回负值表示点在舰体内部。
 * 用于规避判定和友军火力检查，比单个包围圆更贴近真实船形：
 * 顺着炮线方向的友舰投影窄，不会因为半舰长而误判成大圆。
 */
export function shipCapsuleClearance(px: number, py: number, ship: { x: number; y: number; len: number; wid: number; angle: number }): number {
  const halfWidth = ship.wid / 2;
  // 线段两端各缩进半舰宽，保证胶囊是「船形」而不是两端带尖的雪茄
  const halfLength = Math.max(0, ship.len / 2 - halfWidth);
  const ux = Math.cos(ship.angle) * halfLength;
  const uy = Math.sin(ship.angle) * halfLength;
  const distance = pointSegmentDistance(px, py, ship.x - ux, ship.y - uy, ship.x + ux, ship.y + uy);
  return distance - halfWidth;
}
