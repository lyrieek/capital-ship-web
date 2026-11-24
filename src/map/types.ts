// 地图数据层：只描述「一张地图由什么组成」，不依赖 Babylon / 渲染层。
// 坐标统一为世界坐标：原点左上、Y 向下，1 世界单位 ≈ 1 屏幕像素。

/** 阵营：与舰船、限制区共用 */
export type MapTeam = "red" | "blue";

/** 阵营代表色：限制区虚线、选图预览、小地图共用 */
export const MAP_TEAM_COLORS: Record<MapTeam, string> = {
  red: "#ff7b6b",
  blue: "#7cc4ff",
};

/** 世界坐标点 */
export interface MapPoint {
  x: number;
  y: number;
}

/** 矩形边界（世界坐标） */
export interface MapZoneBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 限制区：每个限制区都必须有一个明确的出生地 */
export interface MapZone {
  /** 限制区唯一 id */
  id: string;
  /** 所属阵营 */
  team: MapTeam;
  /** 行动边界 */
  bounds: MapZoneBounds;
  /**
   * 出生地（世界坐标）。
   * 当 x === 0 && y === 0 时表示「不指定坐标」，改由本区的船厂作为出生地，
   * 此时必须同时提供 shipyard。
   */
  spawn: MapPoint;
  /** 船厂位置；spawn 为 (0, 0) 时必填 */
  shipyard?: MapPoint;
}

/** 地图校验结果 */
export interface MapValidateResult {
  ok: boolean;
  errors: string[];
}

/** 地图最少限制区数量（红蓝双方各一个） */
export const MIN_ZONE_COUNT = 2;

/** 取出生点：spawn 为 (0, 0) 时返回船厂；没有船厂时返回 undefined */
export function resolveZoneSpawn(zone: MapZone): MapPoint | undefined {
  if (zone.spawn.x === 0 && zone.spawn.y === 0) {
    return zone.shipyard;
  }
  return zone.spawn;
}

/** 取限制区的实际出生点：spawn 为 (0, 0) 时使用船厂 */
export function getZoneSpawn(zone: MapZone): MapPoint {
  const spawn = resolveZoneSpawn(zone);
  if (!spawn) {
    throw new Error(`[Map] 限制区 "${zone.id}" 出生地为 (0, 0)，但没有配置 shipyard`);
  }
  return spawn;
}
