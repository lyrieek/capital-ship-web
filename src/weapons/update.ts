// 弹药更新：沿弹道推进、记录尾迹、判定命中
import { curveTangent, sampleCurve } from "./trajectory";
import type { TerrainField } from "../terrain/field";
import type { Projectile, ProjectileTarget } from "./types";

/** 鱼雷未命中后的淡出时长（秒）：缓慢变暗变透明，而不是直接爆炸消失 */
const TORPEDO_FADE_TIME = 1.4;

/** 弹药更新参数 */
export interface ProjectileUpdateOptions {
  /** 弹药列表（原地更新，死亡的会被移除） */
  projectiles: Projectile[];
  /** 可命中的目标 */
  targets: ProjectileTarget[];
  /** 地形场（只用于鱼雷与岛礁碰撞；炮弹曲射越过地形；缺省则不检查地形） */
  field?: TerrainField | null;
  /** 战场宽度 */
  worldWidth: number;
  /** 战场高度 */
  worldHeight: number;
  /** 命中回调 */
  onHit?: (projectile: Projectile, target: ProjectileTarget, x: number, y: number) => void;
  /**
   * 命中过滤：返回 false 表示这一发不会命中该目标，弹药继续飞行。
   * 用于「曲射炮弹越过近处友舰」这类只影响碰撞、不影响弹道的规则。
   */
  canHit?: (projectile: Projectile, target: ProjectileTarget) => boolean;
  /** 撞上地形回调 */
  onTerrainHit?: (projectile: Projectile, x: number, y: number) => void;
  /** 落水回调：炮弹耗尽射程或飞出战场；鱼雷未命中会淡出，不触发此回调 */
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
function findHit(
  projectile: Projectile,
  targets: ProjectileTarget[],
  canHit?: (projectile: Projectile, target: ProjectileTarget) => boolean,
): ProjectileTarget | null {
  for (const target of targets) {
    if (target === projectile.owner) continue;
    if (target.hp <= 0) continue;
    if (canHit && !canHit(projectile, target)) continue;

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
  const { projectiles, targets, worldWidth, worldHeight, field } = options;
  const alive: Projectile[] = [];

  for (const projectile of projectiles) {
    // 正在淡出的弹药只做视觉收尾：不再判定命中或地形，
    // 推进速度随 fade 线性衰减，让鱼雷在变暗变透明的过程中慢慢停下。
    if (projectile.fade !== undefined) {
      advance(projectile, dt * projectile.fade);
      projectile.trail.push(projectile.x, projectile.y);
      if (projectile.trail.length > 24) projectile.trail.splice(0, 2);
      projectile.fade = Math.max(0, projectile.fade - dt / TORPEDO_FADE_TIME);
      if (projectile.fade <= 0) {
        projectile.dead = true;
        continue;
      }
      alive.push(projectile);
      continue;
    }

    advance(projectile, dt);

    projectile.trail.push(projectile.x, projectile.y);
    if (projectile.trail.length > 24) projectile.trail.splice(0, 2);

    // 飞出战场 = 落海；寿命耗尽 = 飞到射程边缘
    const splashed = projectile.x < -60 || projectile.x > worldWidth || projectile.y < -60 || projectile.y > worldHeight;
    if (projectile.life <= 0 || splashed) {
      // 鱼雷没命中：不爆炸、不溅水花，进入淡出后自然消失；飞出战场的直接移除
      if (projectile.kind === "torpedo") {
        if (splashed) {
          projectile.dead = true;
        } else {
          projectile.fade = 1;
          projectile.life = 0;
          alive.push(projectile);
        }
        continue;
      }
      projectile.dead = true;
      options.onLanded?.(projectile, projectile.x, projectile.y);
      continue;
    }

    // 只有鱼雷类武器会被岛礁挡住：鱼雷在水面航行，撞上陆地就爆炸。
    // 主炮炮弹是曲射火力，从岛屿上方飞过，不应该被地形拦截。
    if (projectile.kind === "torpedo" && field && field.isBlockedCircle(projectile.x, projectile.y, projectile.r)) {
      projectile.dead = true;
      options.onTerrainHit?.(projectile, projectile.x, projectile.y);
      continue;
    }

    const target = findHit(projectile, targets, options.canHit);
    if (target) {
      projectile.dead = true;
      options.onHit?.(projectile, target, projectile.x, projectile.y);
      continue;
    }

    alive.push(projectile);
  }

  projectiles.splice(0, projectiles.length, ...alive);
}
