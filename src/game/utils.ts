import type { MovingPoint } from "./types";

export interface GameConfig {
  // 基础航速（像素/秒）
  moveSpeed: number;

  // 正常状态下的速度系数
  normalFactor: number;

  // 规避/回正状态下的速度系数
  dodgeFactor: number;

  // 转弯速度（弧度/秒）
  turnRate: number;

  // 规避阶段持续时间（秒）
  dodgeDuration: number;

  // 回正阶段最短持续时间（秒）
  recoverDuration: number;

  // 规避横向偏移距离（保留参考）
  dodgeSideDist: number;

  // 主炮弹速度（像素/秒）
  shellSpeed: number;

  // 主炮弹伤害值
  shellDmg: number;

  // 主炮弹碰撞半径
  shellR: number;

  // 鱼雷速度（像素/秒）
  torpSpeed: number;

  // 鱼雷伤害值
  torpDmg: number;

  // 鱼雷碰撞半径
  torpR: number;

  // 规避/回正时武器射速惩罚系数
  firePenalty: number;

  // 舰船最小安全距离
  minSep: number;

  // Y坐标最小值（下边界）
  yMin: number;

  // Y坐标最大值（上边界）
  yMax: number;
}

// 游戏参数配置
export const P: GameConfig = {
  moveSpeed: 120,
  normalFactor: 0.5,
  dodgeFactor: 1.0,
  turnRate: (85 * Math.PI) / 180,
  dodgeDuration: 1.15,
  recoverDuration: 1.3,
  dodgeSideDist: 70,
  shellSpeed: 330,
  shellDmg: 10,
  shellR: 26,
  torpSpeed: 250,
  torpDmg: 30,
  torpR: 34,
  firePenalty: 0.5,
  minSep: 80,
  yMin: 70,
  yMax: 540,
};

// 画布尺寸
export const W = 1600;
export const H = 900;
export const TAU = Math.PI * 2;

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

/**
 * 预测瞄准点（考虑目标运动）
 * @param sx 射击位置x坐标
 * @param sy 射击位置y坐标
 * @param target 目标舰船对象
 * @param speed 弹速
 * @returns 包含预测坐标和时间的对象
 */
export function predictAim(sx: number, sy: number, target: MovingPoint, speed: number): { x: number; y: number; t: number } {
  let t = Math.hypot(target.x - sx, target.y - sy) / speed;
  for (let i = 0; i < 4; i++) {
    const px = target.x + target.vx * t;
    const py = target.y + target.vy * t;
    t = Math.hypot(px - sx, py - sy) / speed;
  }
  return { x: target.x + target.vx * t, y: target.y + target.vy * t, t };
}
