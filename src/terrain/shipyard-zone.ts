// 船厂检测区（纯数学，不依赖 Babylon）
//
// 船厂分两半：
//   靠陆的一半是码头 / 船台 / 吊车；
//   靠海的一半是船坞（水面）。
// 判定「进厂」必须同时靠海 + 靠陆，缺一个都不算：
//   - 只靠海不靠陆 → 那是开过门口的货轮，不是进厂；
//   - 只靠陆不靠海 → 那是搁在岸上的残骸，更不是进厂。
//
// 这个文件同时被 field.ts（判定）和 shipyard.ts（画检测区）引用，
// 保证「画出来的框」和「判定用的框」永远是同一个，不会出现视觉和逻辑对不上的情况。
import type { TerrainItem } from "./types";

/** 检测区在本地坐标里的范围（单位：spec.radius 的倍数）。+X 指向水面，-X 指向陆地。 */
export const SHIPYARD_ZONE = { minX: 0.9, maxX: 2.4, minY: -0.45, maxY: 0.45 };

/** 船厂陆域设施的本地占地（单位：spec.radius 的倍数） */
export interface ShipyardBox {
  /** 设施 id：quay 码头 / shedTop & shedBottom 船台仓库 / crane 吊车基座 */
  id: "quay" | "shedTop" | "shedBottom" | "crane";
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * 陆域设施占地表。
 * 与 shipyard.ts 的几何共用同一份数据；jib（吊臂）伸向水面，不算陆域设施。
 */
export const SHIPYARD_LAND_BOXES: readonly ShipyardBox[] = [
  { id: "quay", minX: 0, maxX: 0.9, minY: -0.6, maxY: 0.6 },
  { id: "shedTop", minX: 0.1, maxX: 0.62, minY: -0.5, maxY: -0.14 },
  { id: "shedBottom", minX: 0.1, maxX: 0.62, minY: 0.14, maxY: 0.5 },
  { id: "crane", minX: 0.72, maxX: 0.84, minY: -0.06, maxY: 0.06 },
];

/** 矩形（本地坐标，世界单位） */
export interface LocalRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 检测区的本地矩形（世界单位，已乘 scale） */
export function shipyardZoneLocal(radius: number, scale = 1): LocalRect {
  return {
    minX: radius * SHIPYARD_ZONE.minX * scale,
    maxX: radius * SHIPYARD_ZONE.maxX * scale,
    minY: radius * SHIPYARD_ZONE.minY * scale,
    maxY: radius * SHIPYARD_ZONE.maxY * scale,
  };
}

/** 陆域设施占地的本地矩形（世界单位，已乘 scale） */
export function shipyardBoxLocal(box: ShipyardBox, radius: number, scale = 1): LocalRect {
  return {
    minX: radius * box.minX * scale,
    maxX: radius * box.maxX * scale,
    minY: radius * box.minY * scale,
    maxY: radius * box.maxY * scale,
  };
}

/** 世界坐标 → 船厂本地坐标（跟着 rotation 一起转） */
export function toShipyardLocal(item: TerrainItem, x: number, y: number): { x: number; y: number } {
  const rot = item.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const dx = x - item.x;
  const dy = y - item.y;
  return { x: cos * dx + sin * dy, y: -sin * dx + cos * dy };
}

/** 船厂本地坐标 → 世界坐标 */
export function toShipyardWorld(item: TerrainItem, x: number, y: number): { x: number; y: number } {
  const rot = item.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return {
    x: item.x + cos * x - sin * y,
    y: item.y + sin * x + cos * y,
  };
}

/** 点是否在船厂的检测区（船坞）内 */
export function isInShipyardZone(item: TerrainItem, radius: number, x: number, y: number): boolean {
  const local = toShipyardLocal(item, x, y);
  const rect = shipyardZoneLocal(radius, item.scale ?? 1);
  return local.x >= rect.minX && local.x <= rect.maxX && local.y >= rect.minY && local.y <= rect.maxY;
}
