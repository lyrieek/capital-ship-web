// 默认地图「双子岛」：左右各一座船厂岛，中央航道开阔。
// 坐标基于世界尺寸 W=5120, H=2880（src/game/world.ts）。
import { GameMap } from "../GameMap";
import { DEFAULT_TERRAIN_LAYOUT, placementToWorld } from "../../terrain/layout";
import { WORLD_H, WORLD_W } from "../../game/world";
import type { MapZone } from "../types";

// 红方从船厂出港：spawn 设为 (0, 0)，由 shipyard 作为出生地
const RED_SHIPYARD = placementToWorld(
  DEFAULT_TERRAIN_LAYOUT.find((placement) => placement.kind === "shipyard" && placement.u < 0.5)!,
  WORLD_W,
  WORLD_H,
);

// 蓝方在地图右侧的开放水域出生，避免落在岛礁上
const BLUE_SPAWN = { x: 3880, y: 1380 };

export const DEFAULT_MAP_ZONES: MapZone[] = [
  {
    id: "red",
    team: "red",
    // 左半区：边缘留出余量，靠中线一侧留出中央航道
    bounds: { minX: 200, maxX: 2450, minY: 200, maxY: WORLD_H - 280 },
    spawn: { x: 0, y: 0 },
    shipyard: RED_SHIPYARD,
  },
  {
    id: "blue",
    team: "blue",
    bounds: { minX: 2750, maxX: WORLD_W - 120, minY: 200, maxY: WORLD_H - 280 },
    spawn: BLUE_SPAWN,
  },
];

/** 默认地图：标准对决，适合熟悉操作 */
export class DefaultMap extends GameMap {
  constructor() {
    super("default", "mapSelect.maps.default.name", "mapSelect.maps.default.description", DEFAULT_MAP_ZONES, DEFAULT_TERRAIN_LAYOUT);
  }
}
