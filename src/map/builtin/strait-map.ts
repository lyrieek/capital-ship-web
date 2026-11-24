// 「中央海峡」：上下岛屿夹出一条主航道，接敌距离比默认图更短。
// 坐标基于世界尺寸 W=5120, H=2880（src/game/world.ts）。
import { GameMap } from "../GameMap";
import { STRAIT_TERRAIN_LAYOUT, placementToWorld } from "../../terrain/layout";
import { WORLD_H, WORLD_W } from "../../game/world";
import type { MapZone } from "../types";

const RED_SHIPYARD = placementToWorld(
  STRAIT_TERRAIN_LAYOUT.find((placement) => placement.kind === "shipyard" && placement.u < 0.5)!,
  WORLD_W,
  WORLD_H,
);
const BLUE_SHIPYARD = placementToWorld(
  STRAIT_TERRAIN_LAYOUT.find((placement) => placement.kind === "shipyard" && placement.u > 0.5)!,
  WORLD_W,
  WORLD_H,
);

// 蓝方出生在海峡中段的开放水域，避开南北岸线与礁石
const BLUE_SPAWN = { x: 3300, y: 1400 };

export const STRAIT_MAP_ZONES: MapZone[] = [
  {
    id: "red",
    team: "red",
    bounds: { minX: 220, maxX: 2380, minY: 200, maxY: WORLD_H - 280 },
    spawn: { x: 0, y: 0 },
    shipyard: RED_SHIPYARD,
  },
  {
    id: "blue",
    team: "blue",
    bounds: { minX: 2820, maxX: WORLD_W - 140, minY: 200, maxY: WORLD_H - 280 },
    spawn: BLUE_SPAWN,
    shipyard: BLUE_SHIPYARD,
  },
];

/** 中央海峡：狭长航道，交火更集中 */
export class StraitMap extends GameMap {
  constructor() {
    super("strait", "mapSelect.maps.strait.name", "mapSelect.maps.strait.description", STRAIT_MAP_ZONES, STRAIT_TERRAIN_LAYOUT);
  }
}
