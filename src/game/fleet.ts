// 出战舰队：选图页按阵营各选 3 艘船，开战时再套上阵营生成 ShipConfig。
import type { ShipConfig } from "../ship/ship";
import { type ShipEntry, toShipConfig } from "../ship/ship-manager";

export type FleetTeam = "red" | "blue";

/** 每队出战数量 */
export const FLEET_SIZE = 3;

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

function preferredIds(ships: readonly ShipEntry[], team: FleetTeam): string[] {
  const teamShips = ships.filter((ship) => ship.team === team);
  const torpedoBoats = teamShips.filter((s) => s.shipClass === "torpedoBoat");
  const frigates = teamShips.filter((s) => s.shipClass === "frigate");
  // 初始默认编队：2 艘鱼雷艇 + 1 艘护卫舰，不限制玩家在选图页里再改
  return [...torpedoBoats.slice(0, 2), ...frigates.slice(0, 1)].map((ship) => ship.id);
}

/**
 * 自动编队：先按舰船列表里的阵营偏好各取 3 艘，
 * 某方不足时再从剩余舰船里补齐，且同一艘船不会出现在两队。
 */
export function createInitialFleetSelection(ships: readonly ShipEntry[]): FleetSelection {
  const red = preferredIds(ships, "red");
  const blue = preferredIds(ships, "blue");
  const used = new Set([...red, ...blue]);

  const fill = (ids: string[]) => {
    for (const ship of ships) {
      if (ids.length >= FLEET_SIZE) break;
      if (used.has(ship.id)) continue;
      ids.push(ship.id);
      used.add(ship.id);
    }
  };
  fill(red);
  fill(blue);

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
