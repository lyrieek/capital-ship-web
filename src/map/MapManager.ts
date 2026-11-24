// 地图注册表：统一登记、查找和校验所有可用地图。
import type { GameMap } from "./GameMap";
import { MapConfigError } from "./errors";
import type { MapValidateResult } from "./types";

/** 地图管理器：持有已注册地图，供选图界面与游戏初始化使用 */
export class MapManager {
  private maps = new Map<string, GameMap>();

  /** 注册一张地图；同 id 会覆盖旧地图。配置非法时直接抛错，不允许坏地图进入注册表。 */
  register(map: GameMap): void {
    const result = map.validate();
    if (!result.ok) throw new MapConfigError(`地图 "${map.id}"`, result.errors);
    this.maps.set(map.id, map);
  }

  /** 按 id 取地图 */
  get(id: string): GameMap | undefined {
    return this.maps.get(id);
  }

  /** 所有已注册地图，按注册顺序返回 */
  getAll(): GameMap[] {
    return [...this.maps.values()];
  }

  /** 所有已注册地图的 id */
  list(): string[] {
    return [...this.maps.keys()];
  }

  /** 校验所有地图，返回 { id: 校验结果 } */
  validateAll(): Record<string, MapValidateResult> {
    const result: Record<string, MapValidateResult> = {};
    for (const [id, map] of this.maps) {
      result[id] = map.validate();
    }
    return result;
  }

  /** 只返回校验通过、可以开局的地图 */
  getValid(): GameMap[] {
    return this.getAll().filter((map) => map.validate().ok);
  }

  /** 是否所有地图都通过校验 */
  allValid(): boolean {
    return this.maps.size > 0 && this.getValid().length === this.maps.size;
  }

  /** 清空注册表（测试 / 热重载用） */
  clear(): void {
    this.maps.clear();
  }
}
