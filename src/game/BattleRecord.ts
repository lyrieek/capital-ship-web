// 战斗记录：按舰船统计存活时间、死亡原因与杀敌数。
// 只保存引用与最小状态，结算画面在战斗结束后读取快照。
import type { Ship } from "../ship/ship";
import { getWeaponSpec, type ProjectileType } from "../weapons";

/** 死因的远近感：远距离阴死 / 近距离打死 */
export type DeathTone = "far" | "close";

/** 击杀者与死者的关系 */
export type DeathRelation = "enemy" | "friendly" | "self";

/** 远近判定：开火距离超过武器射程的这个比例算「远」 */
const FAR_RANGE_RATIO = 0.6;

/** 每种关系 / 远近组合可用的句式数量（与 locales 的 deathCause.lines 对齐） */
const DEATH_VARIANT_COUNT = 4;

/** 一条完整的死亡原因，结算时直接用于拼句子 */
export interface DeathInfo {
  readonly weapon: ProjectileType;
  readonly killerName: string;
  readonly killerNameKey?: string;
  readonly killerTeam: "red" | "blue";
  readonly relation: DeathRelation;
  readonly tone: DeathTone;
  /** 当场选中的句式下标；存下来避免结算面板重绘时文案跳动 */
  readonly variant: number;
}

/** 结算画面使用的一行记录 */
export interface ShipBattleRecord {
  /** 对应的舰船对象 */
  readonly ship: Ship;
  readonly name: string;
  readonly nameKey?: string;
  readonly team: "red" | "blue";
  /** 击沉数 */
  readonly kills: number;
  /** 主炮命中数（造成） */
  readonly shellHitsDealt: number;
  /** 鱼雷命中数（造成） */
  readonly torpHitsDealt: number;
  /** 被主炮命中数 */
  readonly shellHitsTaken: number;
  /** 被鱼雷命中数 */
  readonly torpHitsTaken: number;
  /** 造成总伤害 */
  readonly damageDealt: number;
  /** 受总伤害 */
  readonly damageTaken: number;
  /** 友军误击次数 */
  readonly friendlyFireHits: number;
  /** 友军误击造成的总伤害 */
  readonly friendlyFireDamage: number;
  /** 存活时间（秒）；存活到结束的船取战斗结束时间 */
  readonly survivalTime: number;
  /** 死亡原因；存活到结束时为 null */
  readonly death: DeathInfo | null;
  /** 战斗结束时是否存活 */
  readonly alive: boolean;
  /** 死亡瞬间的速度倍率（用于低速死亡扣分）；未死亡时为 null */
  readonly deathSpeedFactor: number | null;
}

interface Entry {
  ship: Ship;
  name: string;
  nameKey?: string;
  team: "red" | "blue";
  spawnTime: number;
  deathTime: number | null;
  death: DeathInfo | null;
  kills: number;
  /** 主炮命中数（造成） */
  shellHitsDealt: number;
  /** 鱼雷命中数（造成） */
  torpHitsDealt: number;
  /** 被主炮命中数 */
  shellHitsTaken: number;
  /** 被鱼雷命中数 */
  torpHitsTaken: number;
  /** 造成总伤害 */
  damageDealt: number;
  /** 受总伤害 */
  damageTaken: number;
  /** 死亡瞬间的速度倍率 */
  deathSpeedFactor: number | null;
  /** 友军误击次数 */
  friendlyFireHits: number;
  /** 友军误击造成的总伤害 */
  friendlyFireDamage: number;
}

export class BattleRecord {
  private entries: Entry[] = [];
  private endTime: number | null = null;

  /** 已登记记录的舰船数量（结算面板诊断用） */
  get size(): number {
    return this.entries.length;
  }

  /** 开新一局：按当前舰船重建记录 */
  reset(ships: readonly Ship[], startTime = 0): void {
    this.entries = ships.map((ship) => ({
      ship,
      name: ship.name,
      nameKey: ship.nameKey,
      team: ship.team,
      spawnTime: startTime,
      deathTime: null,
      death: null,
      kills: 0,
      shellHitsDealt: 0,
      torpHitsDealt: 0,
      shellHitsTaken: 0,
      torpHitsTaken: 0,
      damageDealt: 0,
      damageTaken: 0,
      deathSpeedFactor: null,
      friendlyFireHits: 0,
      friendlyFireDamage: 0,
    }));
    this.endTime = null;
  }

  /**
   * 记录一次击沉；victim 已经死亡时不会重复计数。
   * shotDistance 是弹药发射瞬间发射者到瞄准点的距离，用来决定死因里的形容词。
   */
  recordKill(killer: Ship | null, victim: Ship, weapon: ProjectileType, shotDistance: number, time: number): void {
    const victimEntry = this.entries.find((entry) => entry.ship === victim);
    if (!victimEntry || victimEntry.deathTime !== null) return;

    victimEntry.deathTime = Math.max(victimEntry.spawnTime, time);
    victimEntry.death = BattleRecord.describeDeath(killer, victim, weapon, shotDistance);
    victimEntry.deathSpeedFactor = victim.speedFactor;

    // 自沉或误杀友舰都不算击杀
    if (!killer || killer === victim || killer.team === victim.team) return;
    const killerEntry = this.entries.find((entry) => entry.ship === killer);
    if (killerEntry) killerEntry.kills += 1;
  }

  /** 把击杀者、武器与开火距离整理成可展示的死因 */
  private static describeDeath(killer: Ship | null, victim: Ship, weapon: ProjectileType, shotDistance: number): DeathInfo | null {
    // 击杀者已不在舰船列表里（例如弹药在发射舰沉没后才命中）：没有可靠信息，交给「沉没」兜底
    if (!killer) return null;

    const relation: DeathRelation = killer === victim ? "self" : killer.team === victim.team ? "friendly" : "enemy";
    const range = getWeaponSpec(weapon).range;
    const tone: DeathTone = shotDistance > range * FAR_RANGE_RATIO ? "far" : "close";

    return {
      weapon,
      killerName: killer.name,
      killerNameKey: killer.nameKey,
      killerTeam: killer.team,
      relation,
      tone,
      variant: relation === "self" ? 0 : Math.floor(Math.random() * DEATH_VARIANT_COUNT),
    };
  }

  /**
   * 记录一次弹药命中：受击方累计受伤/被命中，攻击方累计造成伤害/命中；
   * 同阵营命中还会记为友军误击。
   */
  recordHit(attacker: Ship | null, victim: Ship, weapon: ProjectileType, dmg: number): void {
    const victimEntry = this.entries.find((entry) => entry.ship === victim);
    if (!victimEntry) return;
    victimEntry.damageTaken += dmg;
    // 按武器大类统计：以后新增同大类的具体型号也会归到对应的命中数里
    const kind = getWeaponSpec(weapon).kind;
    if (kind === "cannon") victimEntry.shellHitsTaken += 1;
    else if (kind === "torpedo") victimEntry.torpHitsTaken += 1;

    if (!attacker || attacker === victim) return;
    const attackerEntry = this.entries.find((entry) => entry.ship === attacker);
    if (!attackerEntry) return;
    attackerEntry.damageDealt += dmg;
    if (kind === "cannon") attackerEntry.shellHitsDealt += 1;
    else if (kind === "torpedo") attackerEntry.torpHitsDealt += 1;
    if (attackerEntry.team === victimEntry.team) {
      attackerEntry.friendlyFireHits += 1;
      attackerEntry.friendlyFireDamage += dmg;
    }
  }

  /** 记录死亡瞬间的速度倍率（可被 recordKill 覆写，也可单独调用） */
  recordDeathSpeed(ship: Ship, speedFactor: number): void {
    const found = this.entries.find((e) => e.ship === ship);
    if (found) found.deathSpeedFactor = speedFactor;
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
        shellHitsDealt: entry.shellHitsDealt,
        torpHitsDealt: entry.torpHitsDealt,
        shellHitsTaken: entry.shellHitsTaken,
        torpHitsTaken: entry.torpHitsTaken,
        damageDealt: entry.damageDealt,
        damageTaken: entry.damageTaken,
        friendlyFireHits: entry.friendlyFireHits,
        friendlyFireDamage: entry.friendlyFireDamage,
        survivalTime: Math.max(0, end - entry.spawnTime),
        death: entry.death,
        alive: entry.deathTime === null,
        deathSpeedFactor: entry.deathSpeedFactor,
      };
    });
  }
}
