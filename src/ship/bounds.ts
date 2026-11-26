// 舰船活动边界的唯一来源：限制区边界 ∩ 世界边界。
// 运动（locomotion）、碰撞（collision）、手动航行（movement）统一通过这里读取，
// 不再把边界数值拷贝到 Ship 上，避免过期 / 漏轴（例如只同步 X 漏掉 Y）。
import { P, W } from "../game/utils";
import type { Bounds, Ship } from "./ship";

// 世界边界：整张地图的可航行范围
const WORLD_BOUNDS: Bounds = Object.freeze({ minX: 0, maxX: W, minY: P.yMin, maxY: P.yMax });

/**
 * 取舰船的有效活动边界 = 限制区边界 ∩ 世界边界。
 * - ship.bounds 为 null（不受限）时直接返回世界边界；
 * - 限制区实时值（含扩张）在此读取，不需要外部再回写。
 */
export function shipBounds(ship: Ship): Bounds {
  const area = ship.bounds;
  if (!area) return WORLD_BOUNDS;

  const minX = Math.max(area.minX, WORLD_BOUNDS.minX);
  const maxX = Math.min(area.maxX, WORLD_BOUNDS.maxX);
  const minY = Math.max(area.minY, WORLD_BOUNDS.minY);
  const maxY = Math.min(area.maxY, WORLD_BOUNDS.maxY);
  // 限制区与世界无重叠时退化为世界边界，避免出现非法区间
  if (minX > maxX || minY > maxY) return WORLD_BOUNDS;
  return { minX, maxX, minY, maxY };
}
