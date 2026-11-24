// 「群岛浅滩」：多座中小岛与礁石错落，航路更碎，需要频繁绕行。
// 坐标基于世界尺寸 W=5120, H=2880（src/game/world.ts）。
import { GameMap } from "../GameMap";
import { ARCHIPELAGO_TERRAIN_LAYOUT, placementToWorld } from "../../terrain/layout";
import { WORLD_H, WORLD_W } from "../../game/world";
import type { MapZone } from "../types";

const RED_SHIPYARD = placementToWorld(
  ARCHIPELAGO_TERRAIN_LAYOUT.find((placement) => placement.kind === "shipyard" && placement.u < 0.5)!,
  WORLD_W,
  WORLD_H,
);
const BLUE_SHIPYARD = placementToWorld(
  ARCHIPELAGO_TERRAIN_LAYOUT.find((placement) => placement.kind === "shipyard" && placement.u > 0.5)!,
  WORLD_W,
  WORLD_H,
);

// 蓝方出生在中右部水道，避开岛屿与礁石
const BLUE_SPAWN = { x: 4200, y: 1400 };

export const ARCHIPELAGO_MAP_ZONES: MapZone[] = [
  {
    id: "red",
    team: "red",
    bounds: { minX: 240, maxX: 2320, minY: 200, maxY: WORLD_H - 280 },
    spawn: { x: 0, y: 0 },
    shipyard: RED_SHIPYARD,
  },
  {
    id: "blue",
    team: "blue",
    bounds: { minX: 2880, maxX: WORLD_W - 180, minY: 200, maxY: WORLD_H - 280 },
    spawn: BLUE_SPAWN,
    shipyard: BLUE_SHIPYARD,
  },
];

/** 群岛浅滩：曲折水道，强调绕行与地形利用 */
export class ArchipelagoMap extends GameMap {
  constructor() {
    super(
      "archipelago",
      "mapSelect.maps.archipelago.name",
      "mapSelect.maps.archipelago.description",
      ARCHIPELAGO_MAP_ZONES,
      ARCHIPELAGO_TERRAIN_LAYOUT,
    );
  }
}
