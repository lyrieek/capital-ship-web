// 地图模块入口：注册所有内置地图，并提供统一的查询出口。
import { MapManager } from "./MapManager";
import { DefaultMap, StraitMap, ArchipelagoMap } from "./builtin";
import type { GameMap } from "./GameMap";

export * from "./types";
export { GameMap } from "./GameMap";
export { MapManager } from "./MapManager";
export { MapConfigError } from "./errors";
export { RestrictArea, assertMapZone, getTeamRestrictColor, validateMapZone } from "./RestrictArea";
export { DefaultMap, DEFAULT_MAP_ZONES, StraitMap, STRAIT_MAP_ZONES, ArchipelagoMap, ARCHIPELAGO_MAP_ZONES } from "./builtin";

export const defaultMap = new DefaultMap();
export const straitMap = new StraitMap();
export const archipelagoMap = new ArchipelagoMap();

/** 内置地图顺序 = 选图界面的展示顺序 */
const BUILT_IN_MAPS: readonly GameMap[] = [defaultMap, straitMap, archipelagoMap];

/** 全局地图注册表 */
export const mapManager = new MapManager();

for (const map of BUILT_IN_MAPS) {
  mapManager.register(map);
}

/** 取所有可玩地图；没有通过校验的图在注册时就已经抛错 */
export function getMaps(): GameMap[] {
  return mapManager.getAll();
}
