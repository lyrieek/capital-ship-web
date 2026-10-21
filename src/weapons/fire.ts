// 武器开火逻辑：预测瞄准、齐射数量、弹道构造
// 主炮走曲射弹道（贝塞尔曲线），鱼雷走直线齐射。
import { getWeaponSpec, type WeaponId, type WeaponSpec } from "./spec";
import { buildCurve, curveLength, curveTangent, type Point } from "./trajectory";
import type { Projectile, ProjectileOwner } from "./types";

/** 世界边界：落点会被限制在这个范围内，避免随机到屏幕外 */
export interface WorldBounds {
  /** 战场宽度 */
  width: number;
  /** 战场高度 */
  height: number;
  /** 边距（像素），落点不会越出边距 */
  margin?: number;
}

/** 开火参数 */
export interface FireParams {
  /** 齐射数量；缺省时按武器预设随机 */
  salvo?: number;
  /** 瞄准散布半径（像素）；缺省时用武器预设 */
  scatter?: number;
  /** 曲射弯曲度；缺省时用武器预设 */
  bend?: number;
  /** 炮口回调（每发一次） */
  onMuzzle?: (point: Point) => void;
  /** 世界边界：给定后目标点与散布落点都会被限制在画面内 */
  bounds?: WorldBounds;
  /** 随机源 */
  random?: () => number;
}

/** 预测目标未来位置（考虑目标速度） */
export function predictAim(from: Point, target: ProjectileOwner, speed: number): Point {
  let t = Math.hypot(target.x - from.x, target.y - from.y) / speed;
  for (let i = 0; i < 4; i++) {
    const px = target.x + target.vx * t;
    const py = target.y + target.vy * t;
    t = Math.hypot(px - from.x, py - from.y) / speed;
  }
  return { x: target.x + target.vx * t, y: target.y + target.vy * t };
}

/** 齐射数量：在预设区间内随机 */
export function rollSalvo(spec: WeaponSpec, random: () => number): number {
  const span = spec.salvoMax - spec.salvoMin;
  return spec.salvoMin + Math.floor(random() * (span + 1));
}

/** 炮口位置：发射平台中心沿发射方向偏移 */
export function muzzlePoint(from: Point, angle: number, offset: number): Point {
  return { x: from.x + Math.cos(angle) * offset, y: from.y + Math.sin(angle) * offset };
}

/** 目标是否在武器射程内 */
export function withinRange(from: Point, target: Point, range: number): boolean {
  return Math.hypot(target.x - from.x, target.y - from.y) <= range;
}

/** 把落点限制在世界边界内 */
export function clampToBounds(point: Point, bounds?: WorldBounds): Point {
  if (!bounds) return point;
  const margin = Math.min(bounds.margin ?? 0, Math.min(bounds.width, bounds.height) / 2);
  return {
    x: Math.max(margin, Math.min(bounds.width - margin, point.x)),
    y: Math.max(margin, Math.min(bounds.height - margin, point.y)),
  };
}

/** 在目标点周围随机散布一个落点（不会散布到世界边界外） */
function scatterPoint(target: Point, radius: number, random: () => number, bounds?: WorldBounds): Point {
  if (radius <= 0) return clampToBounds(target, bounds);
  const angle = random() * Math.PI * 2;
  const distance = Math.sqrt(random()) * radius;
  return clampToBounds({ x: target.x + Math.cos(angle) * distance, y: target.y + Math.sin(angle) * distance }, bounds);
}

/** 构造单发弹药 */
function createProjectile(spec: WeaponSpec, owner: ProjectileOwner, from: Point, aim: Point, bend: number, random: () => number): Projectile {
  const side: 1 | -1 = random() < 0.5 ? 1 : -1;
  const curve = buildCurve(from, aim, bend, side);
  // 用曲线实际长度换算飞行时长，弹速才能大致恒定
  const duration = Math.max(0.05, curveLength(curve) / spec.speed);
  const tangent = curveTangent(curve, 0);
  return {
    type: spec.id,
    owner,
    x: from.x,
    y: from.y,
    vx: tangent.x / duration,
    vy: tangent.y / duration,
    r: spec.radius,
    dmg: spec.damage,
    // 寿命由射程决定：弹药最多飞到射程边缘，不会一路飞到地图边界
    life: spec.range / spec.speed,
    trail: [],
    arc: { curve, t: 0, duration },
  };
}

/**
 * 发射一次齐射
 * @param id 武器类型
 * @param owner 发射平台
 * @param from 发射点（平台中心）
 * @param aim 目标点
 * @param params 开火参数
 * @returns 本次齐射产生的弹药
 */
export function fireWeapon(id: WeaponId, owner: ProjectileOwner, from: Point, aim: Point, params: FireParams = {}): Projectile[] {
  const spec = getWeaponSpec(id);
  const random = params.random ?? Math.random;
  const scatter = params.scatter ?? spec.scatter;
  const bend = params.bend ?? spec.bend;
  const count = Math.max(1, params.salvo ?? rollSalvo(spec, random));
  const projectiles: Projectile[] = [];
  // 目标点先限制在画面内，再叠加每发的随机散布
  const target = clampToBounds(aim, params.bounds);

  for (let i = 0; i < count; i++) {
    // 齐射里的前几发是「精准弹」：直取瞄准点；其余的随机散布开
    const aimPoint = i < spec.accurateCount ? target : scatterPoint(target, scatter, random, params.bounds);
    const angle = Math.atan2(aimPoint.y - from.y, aimPoint.x - from.x);
    const muzzle = muzzlePoint(from, angle, spec.muzzleOffset);
    projectiles.push(createProjectile(spec, owner, muzzle, aimPoint, bend, random));
    params.onMuzzle?.(muzzle);
  }
  return projectiles;
}
