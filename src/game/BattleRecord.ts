// 战斗记录：按舰船统计存活时间、死亡原因与杀敌数。
// 只保存引用与最小状态，结算画面在战斗结束后读取快照。
import type { Ship } from "../ship/ship";
import type { ProjectileType } from "../weapons";

/** 死亡原因：主炮 / 鱼雷 / 未知 */
export type DeathReason = ProjectileType | "unknown";

/** 结算画面使用的一行记录 */
export interface ShipBattleRecord {
  /** 对应的舰船对象 */
  readonly ship: Ship;
  readonly name: string;
  readonly nameKey?: string;
  readonly team: "red" | "blue";
  /** 击沉数 */
  readonly kills: number;
  /** 存活时间（秒）；存活到结束的船取战斗结束时间 */
  readonly survivalTime: number;
  /** 死亡原因；存活到结束时为 null */
  readonly deathReason: DeathReason | null;
  /** 战斗结束时是否存活 */
  readonly alive: boolean;
}

interface Entry {
  ship: Ship;
  name: string;
  nameKey?: string;
  team: "red" | "blue";
  spawnTime: number;
  deathTime: number | null;
  deathReason: DeathReason | null;
  kills: number;
}

export class BattleRecord {
  private entries: Entry[] = [];
  private endTime: number | null = null;

  /** 开新一局：按当前舰船重建记录 */
  reset(ships: readonly Ship[], startTime = 0): void {
    this.entries = ships.map((ship) => ({
      ship,
      name: ship.name,
      nameKey: ship.nameKey,
      team: ship.team,
      spawnTime: startTime,
      deathTime: null,
      deathReason: null,
      kills: 0,
    }));
    this.endTime = null;
  }

  /** 记录一次击沉；victim 已经死亡时不会重复计数 */
  recordKill(killer: Ship | null, victim: Ship, reason: DeathReason, time: number): void {
    const victimEntry = this.entries.find((entry) => entry.ship === victim);
    if (!victimEntry || victimEntry.deathTime !== null) return;

    victimEntry.deathTime = Math.max(victimEntry.spawnTime, time);
    victimEntry.deathReason = reason;

    if (!killer || killer === victim) return;
    const killerEntry = this.entries.find((entry) => entry.ship === killer);
    if (killerEntry) killerEntry.kills += 1;
  }

  /** 战斗结束：固定结束时间，存活舰船的存活时间到此为止 */
  finalize(time: number): void {
    if (this.endTime === null) this.endTime = Math.max(0, time);
  }

  /** 生成结算用的只读快照 */
  getResults(): ShipBattleRecord[] {
    return this.entries.map((entry) => {
      const end = entry.deathTime ?? this.endTime ?? entry.spawnTime;
      return {
        ship: entry.ship,
        name: entry.name,
        nameKey: entry.nameKey,
        team: entry.team,
        kills: entry.kills,
        survivalTime: Math.max(0, end - entry.spawnTime),
        deathReason: entry.deathReason,
        alive: entry.deathTime === null,
      };
    });
  }
}
