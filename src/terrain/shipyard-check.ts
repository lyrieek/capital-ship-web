// 船厂落位校验：在进入游戏之前检查「陆域在陆、船坞在水、岸线接缝贴合」。
//
// 不依赖 Babylon：岛岸线由 coastline.ts 的参数化函数描述，
// 与 3D 网格、小地图用的是同一条岸线。Babylon 的 scene.pick 只能在场景建立后
// 对网格做射线拾取，不适合做地图加载期的配置校验；这里用解析几何更稳定、更快。
import { islandRadiusAt } from "./coastline";
import { getTerrainSpec } from "./spec";
import { SHIPYARD_LAND_BOXES, shipyardBoxLocal, shipyardZoneLocal, toShipyardWorld, type LocalRect } from "./shipyard-zone";
import { createTerrainItems, type TerrainPlacement } from "./layout";
import type { TerrainItem } from "./types";

/** 校验容差；地图作者可以根据实际海岸线微调 */
export interface ShipyardCheckOptions {
  /** 陆域设施允许越过实际岸线的最大距离；0 = 严格在陆地上 */
  landTolerance?: number;
  /** 船坞采样点离碰撞地形的最小距离 */
  dockClearance?: number;
  /** 船坞采样点允许伸入实际海岸线的最大距离 */
  dockLandTolerance?: number;
  /** 陆域/船坞接缝离实际岸线的最大偏差 */
  seamTolerance?: number;
  /** 每个矩形每轴的采样数；越大越精细，但也越慢 */
  samplesPerAxis?: number;
}

const DEFAULTS: Required<ShipyardCheckOptions> = {
  // 碰撞半径刻意比视觉岸线大一点，因此码头临水边允许极小的视觉压水；
  // 超出这个距离说明船厂整体离岸太远或方向反了。
  landTolerance: 8,
  dockClearance: 2,
  // 船坞必须在水面，允许岸边抖动的极小重叠
  dockLandTolerance: 5,
  // 接缝应贴着岸线；超过这个距离说明陆域与船坞没有跨在岸上
  seamTolerance: 18,
  samplesPerAxis: 3,
};

interface Point {
  x: number;
  y: number;
}

export interface ShipyardCheckResult {
  ok: boolean;
  errors: string[];
  /** 陆域设施采样点到岸线的最大越界距离（正数表示越过岸线进入水面） */
  landOverhang: number;
  /** 船坞采样点到最近碰撞地形的最近距离 */
  dockClearance: number;
  /** 船坞采样点伸入实际海岸线的最大距离（正数表示压到陆地） */
  dockLandOverlap: number;
  /** 陆域/船坞接缝到实际岸线的距离（正数表示接缝伸进水面） */
  seamOffset: number;
}

function sampleRect(rect: LocalRect, samplesPerAxis: number): Point[] {
  const n = Math.max(2, Math.floor(samplesPerAxis));
  const points: Point[] = [];
  for (let iy = 0; iy < n; iy++) {
    const fy = iy / (n - 1);
    for (let ix = 0; ix < n; ix++) {
      const fx = ix / (n - 1);
      points.push({
        x: rect.minX + (rect.maxX - rect.minX) * fx,
        y: rect.minY + (rect.maxY - rect.minY) * fy,
      });
    }
  }
  return points;
}

/** 点相对某座岛屿海岸线的有符号距离：负数在陆地上，正数在水面 */
function islandSignedDistance(island: TerrainItem, x: number, y: number): number {
  const spec = getTerrainSpec("island");
  const rot = island.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const dx = x - island.x;
  const dy = y - island.y;
  const lx = cos * dx + sin * dy;
  const ly = -sin * dx + cos * dy;
  const angle = Math.atan2(ly, lx);
  const radius = islandRadiusAt(angle, spec, island.seed ?? 0) * (island.scale ?? 1);
  return Math.hypot(dx, dy) - radius;
}

/** 到最近岛屿陆地的有符号距离 */
function nearestLandDistance(items: readonly TerrainItem[], x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item.kind !== "island") continue;
    const distance = islandSignedDistance(item, x, y);
    if (distance < best) best = distance;
  }
  return best;
}

/** 到最近碰撞地形（岛 / 礁）的距离；船坞必须保持在水面 */
function nearestSolidDistance(items: readonly TerrainItem[], x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const spec = getTerrainSpec(item.kind);
    if (!spec.solid) continue;
    const radius = spec.collisionRadius * (item.scale ?? 1);
    const distance = Math.hypot(x - item.x, y - item.y) - radius;
    if (distance < best) best = distance;
  }
  return best;
}

function nearestIsland(items: readonly TerrainItem[], shipyard: TerrainItem): TerrainItem | null {
  let best: TerrainItem | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item.kind !== "island") continue;
    const distance = Math.hypot(item.x - shipyard.x, item.y - shipyard.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item;
    }
  }
  return best;
}

/**
 * 校验单座船厂：
 *  1. 陆域设施（码头 / 船台 / 吊车基座）必须落在岛上；
 *  2. 船坞检测区必须完全在水面，且与岛礁碰撞区保持距离；
 *  3. 陆域与船坞的接缝要贴近实际岸线，不能浮在海里或深埋陆地。
 */
export function checkShipyardPlacement(
  shipyard: TerrainItem,
  items: readonly TerrainItem[],
  options: ShipyardCheckOptions = {},
): ShipyardCheckResult {
  const config = { ...DEFAULTS, ...options };
  const errors: string[] = [];
  const spec = getTerrainSpec("shipyard");
  const scale = shipyard.scale ?? 1;
  const host = nearestIsland(items, shipyard);

  if (!host) {
    return {
      ok: false,
      errors: [`船厂 ${shipyard.id} 附近没有任何岛屿，无法判断陆域与船坞`],
      landOverhang: Number.POSITIVE_INFINITY,
      dockClearance: Number.NEGATIVE_INFINITY,
      dockLandOverlap: Number.POSITIVE_INFINITY,
      seamOffset: Number.POSITIVE_INFINITY,
    };
  }

  let landOverhang = 0;
  for (const box of SHIPYARD_LAND_BOXES) {
    const rect = shipyardBoxLocal(box, spec.radius, scale);
    for (const local of sampleRect(rect, config.samplesPerAxis)) {
      const point = toShipyardWorld(shipyard, local.x, local.y);
      const distance = nearestLandDistance(items, point.x, point.y);
      // distance > 0 表示在水面；超过容差就是陆域设施压水
      if (distance > config.landTolerance) {
        landOverhang = Math.max(landOverhang, distance);
        errors.push(
          `船厂 ${shipyard.id} 陆域设施 ${box.id} 在 (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) 离岸 ${distance.toFixed(1)}，超出容差 ${config.landTolerance}`,
        );
      }
    }
  }

  // 陆域与船坞必须共用同一条边：既不能留缝，也不能互相叠进去
  const dockRect = shipyardZoneLocal(spec.radius, scale);
  const landMaxX = Math.max(...SHIPYARD_LAND_BOXES.map((box) => shipyardBoxLocal(box, spec.radius, scale).maxX));
  if (Math.abs(landMaxX - dockRect.minX) > 1e-6) {
    errors.push(`船厂 ${shipyard.id} 陆域与船坞没有紧贴：陆域最外 ${landMaxX.toFixed(1)}，船坞内缘 ${dockRect.minX.toFixed(1)}`);
  }

  let dockClearance = Number.POSITIVE_INFINITY;
  let dockLandOverlap = 0;
  for (const local of sampleRect(dockRect, config.samplesPerAxis)) {
    const point = toShipyardWorld(shipyard, local.x, local.y);
    const distance = nearestSolidDistance(items, point.x, point.y);
    if (distance < dockClearance) dockClearance = distance;
    if (distance <= config.dockClearance) {
      errors.push(
        `船厂 ${shipyard.id} 船坞在 (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) 距碰撞地形 ${distance.toFixed(1)}，需要大于 ${config.dockClearance}`,
      );
    }

    // 船坞还必须在水面：实际岸线是有抖动的，允许极小的岸边重叠
    const landDistance = nearestLandDistance(items, point.x, point.y);
    if (landDistance < -config.dockLandTolerance) {
      dockLandOverlap = Math.max(dockLandOverlap, -landDistance);
      errors.push(
        `船厂 ${shipyard.id} 船坞在 (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) 伸入陆地 ${(-landDistance).toFixed(1)}，超出容差 ${config.dockLandTolerance}`,
      );
    }
  }

  // 陆域与船坞共用 x=0.9r 这一条边，检查这条边是否贴着真实岸线
  const seamLocalX = dockRect.minX;
  const seam = toShipyardWorld(shipyard, seamLocalX, 0);
  const seamOffset = islandSignedDistance(host, seam.x, seam.y);
  if (Math.abs(seamOffset) > config.seamTolerance) {
    errors.push(`船厂 ${shipyard.id} 陆域/船坞接缝离岸线 ${seamOffset.toFixed(1)}，超出容差 ${config.seamTolerance}`);
  }

  return { ok: errors.length === 0, errors, landOverhang, dockClearance, dockLandOverlap, seamOffset };
}

/** 校验整张地形布局里的所有船厂 */
export function validateTerrainLayout(
  layout: readonly TerrainPlacement[],
  worldWidth: number,
  worldHeight: number,
  options: ShipyardCheckOptions = {},
): { ok: boolean; errors: string[] } {
  const items = createTerrainItems(worldWidth, worldHeight, layout);
  const errors: string[] = [];
  for (const item of items) {
    if (item.kind !== "shipyard") continue;
    const result = checkShipyardPlacement(item, items, options);
    errors.push(...result.errors);
  }
  return { ok: errors.length === 0, errors };
}
