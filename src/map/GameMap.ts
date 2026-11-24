// 地图定义：一套限制区 + 一份地形摆位，就是一张可玩的战场。
// 这里只做数据与校验，不创建 Babylon 对象；渲染与舰队初始化由 game 层读取本类。
//
// 地图在构造时立即校验：配置不对就在加载阶段抛 MapConfigError，
// 而不是等进游戏后出现船越界、出生在岛上之类的问题。
import { MIN_ZONE_COUNT, type MapTeam, type MapValidateResult, type MapZone } from "./types";
import { validateMapZone } from "./RestrictArea";
import { MapConfigError } from "./errors";
import { validateTerrainLayout } from "../terrain/shipyard-check";
import { WORLD_H, WORLD_W } from "../game/world";
import type { TerrainPlacement } from "../terrain/layout";

/** 一张地图 */
export class GameMap {
  /** 地图唯一 id，用于注册、选择和重开 */
  readonly id: string;
  /** 地图名的 i18n key */
  readonly nameKey: string;
  /** 地图简介的 i18n key */
  readonly descriptionKey: string;
  /** 限制区（红蓝双方） */
  readonly zones: readonly MapZone[];
  /** 地形摆位：归一化坐标，与世界尺寸解耦 */
  readonly terrain: readonly TerrainPlacement[];

  constructor(id: string, nameKey: string, descriptionKey: string, zones: readonly MapZone[], terrain: readonly TerrainPlacement[]) {
    this.id = id;
    this.nameKey = nameKey;
    this.descriptionKey = descriptionKey;
    this.zones = zones;
    this.terrain = terrain;
    this.assertValid();
  }

  /** 按 id 查找限制区 */
  findZone(zoneId: string): MapZone | undefined {
    return this.zones.find((zone) => zone.id === zoneId);
  }

  /** 按阵营查找限制区；主游戏每方只使用一个限制区 */
  findTeamZone(team: MapTeam): MapZone | undefined {
    return this.zones.find((zone) => zone.team === team);
  }

  /**
   * 校验地图配置：
   *  1. 至少有两个限制区，且红蓝阵营各恰好一个
   *  2. 每个限制区的边界、出生地、船厂位置合法
   *  3. 限制区 id 不重复
   *  4. 船厂陆域在陆、船坞在水、接缝贴岸
   */
  validate(): MapValidateResult {
    const errors: string[] = [];
    const ids = new Set<string>();
    const teams = new Map<MapTeam, number>();

    if (this.zones.length < MIN_ZONE_COUNT) {
      errors.push(`[Map] "${this.id}" 限制区数量 ${this.zones.length} < 最少 ${MIN_ZONE_COUNT} 个`);
    }

    for (const zone of this.zones) {
      if (ids.has(zone.id)) {
        errors.push(`[Map] "${this.id}" 限制区 id "${zone.id}" 重复`);
      }
      ids.add(zone.id);
      teams.set(zone.team, (teams.get(zone.team) ?? 0) + 1);
      for (const error of validateMapZone(zone)) {
        errors.push(`[Map] "${this.id}" ${error}`);
      }
    }

    for (const team of ["red", "blue"] as const) {
      const count = teams.get(team) ?? 0;
      if (count !== 1) errors.push(`[Map] "${this.id}" ${team} 方限制区数量为 ${count}，应为 1`);
    }

    // 船厂必须同时靠陆 + 靠海：在加载地图时检查陆域、船坞与岸线接缝
    const terrainCheck = validateTerrainLayout(this.terrain, WORLD_W, WORLD_H);
    for (const error of terrainCheck.errors) {
      errors.push(`[Map] "${this.id}" ${error}`);
    }

    return { ok: errors.length === 0, errors };
  }

  /** 构造时断言；失败直接阻止地图加载 */
  private assertValid(): void {
    const result = this.validate();
    if (!result.ok) throw new MapConfigError(`地图 "${this.id}"`, result.errors);
  }
}
