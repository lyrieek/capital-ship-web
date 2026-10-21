// 弹药更新：沿弹道推进、记录尾迹、判定命中
import { curveTangent, sampleCurve } from "./trajectory";
import type { Projectile, ProjectileTarget } from "./types";

/** 弹药更新参数 */
export interface ProjectileUpdateOptions {
  /** 弹药列表（原地更新，死亡的会被移除） */
  projectiles: Projectile[];
  /** 可命中的目标 */
  targets: ProjectileTarget[];
  /** 战场宽度 */
  worldWidth: number;
  /** 战场高度 */
  worldHeight: number;
  /** 命中回调 */
  onHit?: (projectile: Projectile, target: ProjectileTarget, x: number, y: number) => void;
  /** 落水回调：弹药耗尽射程或飞出战场（没有命中目标） */
  onLanded?: (projectile: Projectile, x: number, y: number) => void;
}

/** 推进弹药位置：曲射弹药沿曲线走，飞出终点后沿切线继续直飞 */
function advance(projectile: Projectile, dt: number): void {
  const arc = projectile.arc;
  if (arc.t < 1) {
    arc.t = Math.min(1, arc.t + dt / arc.duration);
    const point = sampleCurve(arc.curve, arc.t);
    projectile.x = point.x;
    projectile.y = point.y;
    const tangent = curveTangent(arc.curve, arc.t);
    projectile.vx = tangent.x / arc.duration;
    projectile.vy = tangent.y / arc.duration;
  } else {
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
  }
  projectile.life -= dt;
}

/** 判断弹药是否命中目标（椭圆判定） */
function findHit(projectile: Projectile, targets: ProjectileTarget[]): ProjectileTarget | null {
  for (const target of targets) {
    if (target === projectile.owner) continue;
    if (target.hp <= 0) continue;

    const dx = projectile.x - target.x;
    const dy = projectile.y - target.y;
    const rx = target.len / 2 + projectile.r;
    const ry = target.wid / 2 + projectile.r;
    if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) return target;
  }
  return null;
}

/**
 * 更新所有弹药状态
 * @param dt 时间增量（秒）
 */
export function updateProjectiles(dt: number, options: ProjectileUpdateOptions): void {
  const { projectiles, targets, worldWidth, worldHeight } = options;
  const alive: Projectile[] = [];

  for (const projectile of projectiles) {
    advance(projectile, dt);

    projectile.trail.push(projectile.x, projectile.y);
    if (projectile.trail.length > 24) projectile.trail.splice(0, 2);

    // 飞出战场 = 落海；寿命耗尽 = 飞到射程边缘
    const splashed = projectile.x < -60 || projectile.x > worldWidth || projectile.y < -60 || projectile.y > worldHeight;
    if (projectile.life <= 0 || splashed) {
      projectile.dead = true;
      options.onLanded?.(projectile, projectile.x, projectile.y);
      continue;
    }

    const target = findHit(projectile, targets);
    if (target) {
      projectile.dead = true;
      options.onHit?.(projectile, target, projectile.x, projectile.y);
      continue;
    }

    alive.push(projectile);
  }

  projectiles.splice(0, projectiles.length, ...alive);
}
