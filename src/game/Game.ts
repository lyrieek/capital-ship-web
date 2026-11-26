// 主游戏状态：地图、限制区、舰船、弹药与胜负判定。
import type { GameState } from "./types";
import { emitBurst, emitSmoke } from "./fx";
import type { Ship } from "../ship/ship";
import { clearParticles, renderGame } from "./render";
import { resolveCollisions as resolveShipCollisions } from "./collision";
import { H, W } from "./utils";
import { RestrictAreaImpl } from "./RestrictAreaImpl";
import type { GameMap } from "../map";
import type { FleetShips } from "./fleet";
import { BattleRecord } from "./BattleRecord";
// 武器的发射逻辑与弹药更新已抽离到 src/weapons
import { clampToBounds, fireWeapon, fireWeaponShot, getWeaponSpec, predictAim, updateProjectiles as updateWeaponProjectiles } from "../weapons";
// 地物（岛屿 / 礁石 / 建筑）的数据与查询已抽离到 src/terrain
import { createTerrainItems, getTerrainField, setTerrainField, TerrainField } from "../terrain";

const END_DELAY = 3;

// 限制区扩张：开战后 3 秒开始，到第 12 秒完全展开（按对局时间计），之后固定不动。
const EXPAND_START = 3;
const EXPAND_END = 12;

// 手动齐射（F 键）的公共冷却，避免连续按键无限输出
const MANUAL_FIRE_COOLDOWN = 2.5;

let gameInstance: GameState | null = null;
let currentMap: GameMap | null = null;
let restrictAreas: RestrictAreaImpl[] = [];

export { gameInstance };

export function getGameInstance(): GameState | null {
  return gameInstance;
}

/** 当前对局使用的地图 */
export function getCurrentMap(): GameMap | null {
  return currentMap;
}

/** 当前对局的行动限制区（Minimap 与渲染层共用） */
export function getRestrictAreas(): readonly RestrictAreaImpl[] {
  return restrictAreas;
}

// 当前倍速：1 或 2，由 [2x] 按钮切换（默认游戏已开启 2 倍速）
let gameSpeed = 2;

export function getGameSpeed(): number {
  return gameSpeed;
}

export function setGameSpeed(speed: number): void {
  gameSpeed = speed;
}

export function getGameSpeedMultiplier(): number {
  return gameSpeed;
}

export function toggleGameSpeed(): number {
  gameSpeed = gameSpeed === 1 ? 2 : 1;
  return gameSpeed;
}

/** 按地图重建限制区与地物表；返回当前红蓝两方的限制区 */
function prepareMap(map: GameMap): { red: RestrictAreaImpl; blue: RestrictAreaImpl } {
  for (const area of restrictAreas) area.dispose();
  currentMap = map;

  // 摆船（RestrictArea）和碰撞都要查地物表，所以必须在 reset() 之前建好
  setTerrainField(new TerrainField(createTerrainItems(W, H, map.terrain)));
  restrictAreas = map.zones.map((zone) => new RestrictAreaImpl(zone));

  const red = restrictAreas.find((area) => area.team === "red");
  const blue = restrictAreas.find((area) => area.team === "blue");
  if (!red || !blue) {
    throw new Error(`[Game] 地图 "${map.id}" 缺少红方或蓝方限制区`);
  }
  return { red, blue };
}

// 没有传入出战舰队时的兜底：保持旧的 2v2 鱼雷艇对局。
function defaultFleet(): FleetShips {
  return {
    red: [
      { team: "red", name: "红-1", nameKey: "shipHud.names.red1" },
      { team: "red", name: "红-2", nameKey: "shipHud.names.red2" },
    ],
    blue: [
      { team: "blue", name: "蓝-1", nameKey: "shipHud.names.blue1" },
      { team: "blue", name: "蓝-2", nameKey: "shipHud.names.blue2" },
    ],
  };
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

// 扩张进度 0..1。smoothstep 让开始和结束都更柔和，中段保持均匀推进。
function expandProgress(time: number): number {
  if (time <= EXPAND_START) return 0;
  if (time >= EXPAND_END) return 1;
  const t = (time - EXPAND_START) / (EXPAND_END - EXPAND_START);
  return t * t * (3 - 2 * t);
}

// oxlint-disable-next-line max-lines-per-function
export function initializeGame(map: GameMap, fleets?: FleetShips): GameState {
  const { red, blue } = prepareMap(map);
  const fleet = fleets ?? defaultFleet();
  const record = new BattleRecord();

  // 扩张终点取双方限制区的并集：展开后两区完全重合，面积一致。
  const unionMinX = Math.min(red.bounds.minX, blue.bounds.minX);
  const unionMaxX = Math.max(red.bounds.maxX, blue.bounds.maxX);
  let expandDone = false;

  const game: GameState = {
    ships: [],
    projectiles: [],
    time: 0,
    over: false,
    endTimer: null,
    winnerTeam: null,
    manualFireCD: 0,
    record,

    reset() {
      this.projectiles.length = 0;
      this.time = 0;
      this.over = false;
      this.endTimer = null;
      this.winnerTeam = null;
      this.manualFireCD = 0;

      // 重开对局：限制区回到地图初始边界，扩张重新计时
      red.resetBounds();
      blue.resetBounds();
      expandDone = false;

      this.ships = [...fleet.red.map((config) => red.createShip(config)), ...fleet.blue.map((config) => blue.createShip(config))];
      this.record.reset(this.ships, this.time);
    },

    fireShell(ship: Ship, target: Ship, from?: { x: number; y: number }) {
      const spec = getWeaponSpec("shell");
      const origin = from ?? { x: ship.x, y: ship.y };
      const aim = predictAim(origin, target, spec.speed);
      const projectiles = fireWeapon("shell", ship, origin, aim, {
        bounds: { width: W, height: H, margin: 20 },
        onMuzzle: (point) => emitBurst(point.x, point.y, spec.muzzleParticles, spec.muzzleColor),
      });
      for (const projectile of projectiles) this.projectiles.push(projectile);
    },

    focusFireAt(ships: readonly Ship[], x: number, y: number): void {
      if (this.over || this.manualFireCD > 0) return;

      const point = { x, y };
      let anyOrdered = false;
      for (const ship of ships) {
        if (!ship.alive) continue;
        // 只下达瞄准指令：炮管会先慢慢转向该点，对准后才真正开火
        ship.aimOrder = point;
        anyOrdered = true;
      }

      if (anyOrdered) this.manualFireCD = MANUAL_FIRE_COOLDOWN;
    },

    // 向世界坐标点开火主炮（不预测目标，直取给定点）
    fireShellAt(ship: Ship, x: number, y: number, from?: { x: number; y: number }) {
      const spec = getWeaponSpec("shell");
      const origin = from ?? { x: ship.x, y: ship.y };
      const projectiles = fireWeapon(
        "shell",
        ship,
        origin,
        { x, y },
        {
          bounds: { width: W, height: H, margin: 20 },
          onMuzzle: (point) => emitBurst(point.x, point.y, spec.muzzleParticles, spec.muzzleColor),
        },
      );
      for (const projectile of projectiles) this.projectiles.push(projectile);
    },

    // 向世界坐标点发射一发鱼雷（不预测目标，直取给定点）；
    // 分时齐射由舰船的发射队列逐发调用本方法。
    fireTorpedoAt(ship: Ship, x: number, y: number, shotIndex = 0) {
      const from = { x: ship.x, y: ship.y };
      const projectile = fireWeaponShot("torp", ship, from, { x, y }, { shotIndex, bounds: { width: W, height: H, margin: 20 } });
      this.projectiles.push(projectile);
    },

    burst(x: number, y: number, n: number, color: string) {
      emitBurst(x, y, n, color);
    },

    smoke(x: number, y: number) {
      emitSmoke(x, y);
    },

    resolveCollisions() {
      resolveShipCollisions(this.ships, getTerrainField());
    },

    updateProjectiles(dt: number) {
      const field = getTerrainField();
      updateWeaponProjectiles(dt, {
        projectiles: this.projectiles,
        targets: this.ships,
        field,
        worldWidth: W,
        worldHeight: H,
        onHit: (projectile, target, x, y) => {
          // 弹药的 owner 就是发射舰船，用对象身份反查，避免再给弹药加一层索引
          const killer = this.ships.find((ship) => ship === projectile.owner) ?? null;
          // 只在目标尚存活时记录命中与伤害，避免沉船后的残余弹药重复计分
          if (target.hp > 0) {
            this.record.recordHit(killer, target as Ship, projectile.type, projectile.dmg);
          }
          target.takeDamage(projectile.dmg);
          if (target.hp <= 0) {
            // target 一定来自 this.ships；ProjectileTarget 只是更新器需要的最小接口
            this.record.recordKill(killer, target as Ship, projectile.type, projectile.shotDistance, this.time);
          }
          const spec = getWeaponSpec(projectile.type);
          emitBurst(x, y, spec.impactParticles, spec.impactColor);
        },
        onTerrainHit: (projectile, x, y) => {
          // 鱼雷撞上岛礁：爆炸消失，不穿过地形（炮弹不触发，曲射越过岛屿）
          const spec = getWeaponSpec(projectile.type);
          emitBurst(x, y, spec.impactParticles, spec.impactColor);
        },
        onLanded: (_projectile, x, y) => {
          // 炮弹落海：溅起一小片水花（位置收进海面范围内）
          const splash = clampToBounds({ x, y }, { width: W, height: H });
          emitBurst(splash.x, splash.y, 16, "#bfe9ff");
        },
      });
    },

    update(dt: number) {
      this.manualFireCD = Math.max(0, this.manualFireCD - dt);
      if (!this.over) {
        this.time += dt;
        for (const s of this.ships) s.update(dt);
        this.resolveCollisions();

        // 限制区扩张：按绝对进度从初始边界插值，避免逐帧在已扩张的边界上叠加。
        // 第 12 秒到达双方并集后固定，只负责 clamp 舰船位置。
        if (!expandDone) {
          const progress = expandProgress(this.time);
          if (progress > 0) {
            red.setBoundsX(lerp(red.bounds.minX, unionMinX, progress), lerp(red.bounds.maxX, unionMaxX, progress));
            blue.setBoundsX(lerp(blue.bounds.minX, unionMinX, progress), lerp(blue.bounds.maxX, unionMaxX, progress));
            // 边界在扩大，必须同步给舰船，否则 clamp 仍停在旧边界
            for (const ship of this.ships) {
              (ship.team === "red" ? red : blue).applyTo(ship);
            }
            if (progress >= 1) expandDone = true;
          }
        }
      }

      this.updateProjectiles(dt);

      if (!this.over) {
        const teams = new Set(this.ships.filter((s) => s.hp > 0).map((s) => s.team));
        if (teams.size > 1) {
          this.endTimer = null;
        } else if (this.endTimer === null) {
          this.endTimer = END_DELAY;
        } else {
          this.endTimer = Math.max(0, this.endTimer - dt);
          if (this.endTimer === 0) {
            this.over = true;
            this.winnerTeam = teams.size === 1 ? [...teams][0] : null;
            this.record.finalize(this.time);
          }
        }
      }
    },

    draw() {
      renderGame(this);
    },
  };

  game.reset();
  gameInstance = game;
  return game;
}

export function resetGame() {
  if (gameInstance) {
    gameInstance.reset();
  }
  clearParticles();
}

/** 离开战斗界面时清空当前对局，避免 playground 等页面误用上一局的目标/弹药 */
export function clearGameInstance(): void {
  gameInstance = null;
}
