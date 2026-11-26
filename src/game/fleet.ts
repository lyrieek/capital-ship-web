// 出战舰队：选图页按阵营各选 N 艘船，开战时再套上阵营生成 ShipConfig。
import type { ShipConfig } from "../ship/ship";
import { type ShipEntry, toShipConfig } from "../ship/ship-manager";

export type FleetTeam = "red" | "blue";

/** 舰队规模档位：速战 / 会战 / 决战 */
export type FleetScale = "skirmish" | "battle" | "decisive";

/** 滑杆顺序（从小到大） */
export const FLEET_SCALE_ORDER: readonly FleetScale[] = ["skirmish", "battle", "decisive"];

/** 每队出战数量 */
export const FLEET_SCALE_SIZES: Record<FleetScale, number> = {
  skirmish: 3,
  battle: 5,
  decisive: 7,
};

export const DEFAULT_FLEET_SCALE: FleetScale = "skirmish";

export function getFleetSize(scale: FleetScale): number {
  return FLEET_SCALE_SIZES[scale];
}

/** 选图页维护的舰队名单（存舰船 id） */
export interface FleetSelection {
  red: string[];
  blue: string[];
}

/** 传给游戏层的建船配置 */
export interface FleetShips {
  red: ShipConfig[];
  blue: ShipConfig[];
}

/**
 * 默认编队：按规模给「约一半护卫 + 一半鱼雷艇」，
 * 速战 1 护 2 艇、会战 2 护 3 艇、决战 3 护 4 艇；不限制玩家在选图页里再改。
 */
function preferredIds(ships: readonly ShipEntry[], team: FleetTeam, size: number): string[] {
  const teamShips = ships.filter((ship) => ship.team === team);
  const torpedoBoats = teamShips.filter((s) => s.shipClass === "torpedoBoat");
  const frigates = teamShips.filter((s) => s.shipClass === "frigate");
  const torpedoCount = Math.ceil(size / 2);
  const frigateCount = size - torpedoCount;
  return [...torpedoBoats.slice(0, torpedoCount), ...frigates.slice(0, frigateCount)].map((ship) => ship.id);
}

/** 补足到目标规模，同一艘船不会出现在两队 */
function fillToSize(ships: readonly ShipEntry[], ids: string[], size: number, used: Set<string>): void {
  for (const ship of ships) {
    if (ids.length >= size) break;
    if (used.has(ship.id)) continue;
    ids.push(ship.id);
    used.add(ship.id);
  }
}

/** 先按默认偏好（护卫 / 鱼雷艇配比）补足 */
function fillPreferred(ships: readonly ShipEntry[], team: FleetTeam, ids: string[], size: number, used: Set<string>): void {
  for (const id of preferredIds(ships, team, size)) {
    if (ids.length >= size) break;
    if (used.has(id)) continue;
    ids.push(id);
    used.add(id);
  }
}

/**
 * 自动编队：先按舰船列表里的阵营偏好取够目标规模，
 * 某方不足时再从剩余舰船里补齐，且同一艘船不会出现在两队。
 */
export function createInitialFleetSelection(ships: readonly ShipEntry[], size: number): FleetSelection {
  const red = preferredIds(ships, "red", size);
  const blue = preferredIds(ships, "blue", size);
  const used = new Set([...red, ...blue]);

  fillToSize(ships, red, size, used);
  fillToSize(ships, blue, size, used);

  return { red, blue };
}

/** 切换规模时调整名单：超出裁剪，不足按默认偏好补齐，保留玩家已选的船 */
export function resizeFleetSelection(ships: readonly ShipEntry[], selection: FleetSelection, size: number): FleetSelection {
  const red = selection.red.slice(0, size);
  const blue = selection.blue.slice(0, size);
  const used = new Set([...red, ...blue]);

  fillPreferred(ships, "red", red, size, used);
  fillToSize(ships, red, size, used);
  fillPreferred(ships, "blue", blue, size, used);
  fillToSize(ships, blue, size, used);

  return { red, blue };
}

/** 把选中的 id 转成带阵营的建船配置；找不到的 id 直接忽略 */
export function createFleetShips(ships: readonly ShipEntry[], selection: FleetSelection): FleetShips {
  const byId = new Map(ships.map((ship) => [ship.id, ship]));

  const toConfigs = (ids: readonly string[], team: FleetTeam): ShipConfig[] =>
    ids
      .map((id) => byId.get(id))
      .filter((entry): entry is ShipEntry => entry !== undefined)
      .map((entry) => {
        const config = toShipConfig(entry);
        config.team = team;
        return config;
      });

  return {
    red: toConfigs(selection.red, "red"),
    blue: toConfigs(selection.blue, "blue"),
  };
}
