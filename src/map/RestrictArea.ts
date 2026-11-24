// 地图层限制区抽象：只描述「在哪、属于谁、从哪出生」，
// 以及所有限制区共用的默认行为（边界包含、出生点解析等）。
//
// 这里不依赖 Babylon。渲染虚线框、摆船、碰撞 clamp 等游戏行为
// 由 game/RestrictAreaImpl 继承后实现。
import { MapConfigError } from "./errors";
import { MAP_TEAM_COLORS, resolveZoneSpawn, type MapPoint, type MapTeam, type MapZone, type MapZoneBounds } from "./types";

function containsPoint(bounds: MapZoneBounds, point: MapPoint): boolean {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}

/** 校验单个限制区；返回空数组表示合法 */
export function validateMapZone(zone: MapZone): string[] {
  const errors: string[] = [];

  if (!zone.id) errors.push("限制区 id 不能为空");
  if (zone.team !== "red" && zone.team !== "blue") errors.push(`限制区 "${zone.id}" 阵营非法: ${String(zone.team)}`);

  const { bounds } = zone;
  if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) {
    errors.push(`限制区 "${zone.id}" 边界非法: [${bounds.minX},${bounds.maxX}] x [${bounds.minY},${bounds.maxY}]`);
    return errors;
  }

  const spawn = resolveZoneSpawn(zone);
  if (!spawn) {
    errors.push(`限制区 "${zone.id}" 出生地为 (0, 0)，但没有配置 shipyard`);
  } else if (!containsPoint(bounds, spawn)) {
    errors.push(`限制区 "${zone.id}" 出生地 (${spawn.x}, ${spawn.y}) 超出边界`);
  }

  if (zone.shipyard && !containsPoint(bounds, zone.shipyard)) {
    errors.push(`限制区 "${zone.id}" 船厂 (${zone.shipyard.x}, ${zone.shipyard.y}) 超出边界`);
  }

  return errors;
}

/** 校验并立即抛错；供地图构造与限制区实例化共用 */
export function assertMapZone(zone: MapZone, context = "限制区"): void {
  const errors = validateMapZone(zone);
  if (errors.length > 0) throw new MapConfigError(context, errors);
}

/** 获取阵营代表色 */
export function getTeamRestrictColor(team: MapTeam): string {
  return MAP_TEAM_COLORS[team];
}

/**
 * 限制区基类。
 * 构造时立即校验，保证子类拿到的 id / team / bounds / spawn 一定合法。
 */
export abstract class RestrictArea {
  /** 限制区唯一 id */
  readonly id: string;
  /** 所属阵营 */
  readonly team: MapTeam;
  /** 行动边界（构造时复制，外部修改地图数组不会影响实例） */
  readonly bounds: MapZoneBounds;
  /** 出生地：(0, 0) 表示由 shipyard 作为出生地 */
  readonly spawn: MapPoint;
  /** 船厂位置：spawn 为 (0, 0) 时必须提供 */
  readonly shipyard?: MapPoint;

  protected constructor(zone: MapZone) {
    assertMapZone(zone, `限制区 "${zone.id}"`);

    this.id = zone.id;
    this.team = zone.team;
    this.bounds = Object.freeze({ ...zone.bounds });
    this.spawn = Object.freeze({ ...zone.spawn });
    this.shipyard = zone.shipyard ? Object.freeze({ ...zone.shipyard }) : undefined;
  }

  get minX(): number {
    return this.bounds.minX;
  }

  get maxX(): number {
    return this.bounds.maxX;
  }

  get minY(): number {
    return this.bounds.minY;
  }

  get maxY(): number {
    return this.bounds.maxY;
  }

  get width(): number {
    return this.bounds.maxX - this.bounds.minX;
  }

  get height(): number {
    return this.bounds.maxY - this.bounds.minY;
  }

  /** 限制区中心点 */
  get center(): MapPoint {
    return { x: (this.bounds.minX + this.bounds.maxX) / 2, y: (this.bounds.minY + this.bounds.maxY) / 2 };
  }

  /** 点是否在限制区内 */
  contains(x: number, y: number): boolean {
    return containsPoint(this.bounds, { x, y });
  }

  /** 取实际出生点：spawn 为 (0, 0) 时使用船厂 */
  getSpawnPoint(): MapPoint {
    const spawn = this.spawn.x === 0 && this.spawn.y === 0 ? this.shipyard : this.spawn;
    if (!spawn) throw new MapConfigError(`限制区 "${this.id}"`, ["spawn 为 (0, 0) 但没有配置 shipyard"]);
    return spawn;
  }
}
