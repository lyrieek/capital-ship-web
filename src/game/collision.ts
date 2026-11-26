// 纯 2D 碰撞：舰船用胶囊（船头/船尾两个圆）近似，地形用 TerrainField 的圆。
// 不 import Babylon：模拟可以在固定步长 / 回放 / 服务端里独立运行。
import { terrainRadius, type TerrainField } from "../terrain/field";
import type { Ship } from "../ship/ship";
import { shipBounds } from "../ship/bounds";
import { P, clamp } from "./utils";

/**
 * 把舰船推出地形圆。
 * 船体近似为「沿航向的线段 + 半舰宽」，逐岛求线段到圆心的最近点；
 * 重叠时把船整体沿法线推出去，多跑几轮处理两座岛夹角的情况。
 */
export function resolveShipTerrain(ship: Ship, field: TerrainField): void {
  const radius = ship.wid / 2;
  const half = Math.max(0, ship.len / 2 - radius);
  const dx = Math.cos(ship.angle) * half;
  const dy = Math.sin(ship.angle) * half;

  for (let pass = 0; pass < 3; pass++) {
    let moved = false;

    for (const item of field.items) {
      const itemRadius = terrainRadius(item);
      if (itemRadius <= 0) continue;

      const ax = ship.x - dx;
      const ay = ship.y - dy;
      const abx = dx * 2;
      const aby = dy * 2;
      const lengthSq = abx * abx + aby * aby;
      const t = lengthSq > 0 ? clamp(((item.x - ax) * abx + (item.y - ay) * aby) / lengthSq, 0, 1) : 0;

      const cx = ax + abx * t;
      const cy = ay + aby * t;
      let ox = cx - item.x;
      let oy = cy - item.y;
      let distance = Math.hypot(ox, oy);
      const minDistance = itemRadius + radius;
      if (distance >= minDistance) continue;

      // 正好落在圆心：任取一个方向推出去，避免除零
      if (distance < 0.001) {
        ox = 1;
        oy = 0;
        distance = 1;
      }

      const push = minDistance - distance;
      ship.x += (ox / distance) * push;
      ship.y += (oy / distance) * push;
      moved = true;
    }

    if (!moved) break;
  }
}

/** 舰船互推：保持最小中心距，位移平分给两艘船。 */
export function resolveShipPair(a: Ship, b: Ship): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= P.minSep || distance <= 0.001) return;

  const push = (P.minSep - distance) * 0.5;
  const nx = dx / distance;
  const ny = dy / distance;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;
}

/**
 * 一帧的碰撞收敛：舰船互推 → 舰船 vs 地形 → 战场边界。
 * 必须在所有舰船移动之后、武器/索敌之前调用。
 */
export function resolveCollisions(ships: readonly Ship[], field: TerrainField | null): void {
  const alive = ships.filter((ship) => ship.alive);

  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) resolveShipPair(alive[i], alive[j]);
  }

  if (field) {
    for (const ship of alive) resolveShipTerrain(ship, field);
  }

  for (const ship of alive) {
    // 有效边界 = 限制区 ∩ 世界：X/Y 一起夹取，避免只限制横向、纵向可穿出限制区
    const bounds = shipBounds(ship);
    ship.x = clamp(ship.x, bounds.minX, bounds.maxX);
    ship.y = clamp(ship.y, bounds.minY, bounds.maxY);
  }
}
