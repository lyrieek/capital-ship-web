// Game state singleton
import type { GameState } from "./types";
import { emitBurst, emitSmoke } from "./fx";
import type { Ship } from "../ship/ship";
import { clearParticles, renderGame } from "./render";
import { resolveCollisions as resolveShipCollisions } from "./collision";
import { H, W } from "./utils";
import { RestrictArea, getTeamRestrictBounds } from "./RestrictArea";
// 武器的发射逻辑与弹药更新已抽离到 src/weapons
import { clampToBounds, fireWeapon, getWeaponSpec, predictAim, updateProjectiles as updateWeaponProjectiles } from "../weapons";
// 地物（岛屿 / 礁石 / 建筑）的数据与查询已抽离到 src/terrain
import { createTerrainItems, getTerrainField, setTerrainField, TerrainField } from "../terrain";

const END_DELAY = 3;

// 手动齐射（F 键）的公共冷却，避免连续按键无限输出
const MANUAL_FIRE_COOLDOWN = 2.5;

// 地物表：主场景只建一次，摆船（RestrictArea）、舰船碰撞（resolveCollisions）、渲染层共用。
// 必须在 initializeGame() 之前建好：initializeGame() 会调用 RestrictArea.createShip() 摆船，
// 而摆船要避开岛礁，否则船会出生在岛上（动不了、打不中）。
setTerrainField(new TerrainField(createTerrainItems(W, H)));

// 行动限制区域：按阵营分别定义，供主游戏自动摆船与渲染层画虚线框复用
const redRestrictArea = new RestrictArea(getTeamRestrictBounds("red"), "red", true);
const blueRestrictArea = new RestrictArea(getTeamRestrictBounds("blue"), "blue", true);

export function getRestrictAreas(): RestrictArea[] {
  return [redRestrictArea, blueRestrictArea];
}

let gameInstance: GameState | null = null;

export { gameInstance };

export function getGameInstance(): GameState | null {
  return gameInstance;
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

// oxlint-disable-next-line max-lines-per-function
export function initializeGame(): GameState {
  const game: GameState = {
    ships: [],
    projectiles: [],
    time: 0,
    over: false,
    endTimer: null,
    winnerTeam: null,
    manualFireCD: 0,

    reset() {
      this.projectiles.length = 0;
      this.time = 0;
      this.over = false;
      this.endTimer = null;
      this.winnerTeam = null;
      this.manualFireCD = 0;

      this.ships = [
        redRestrictArea.createShip({ team: "red", name: "红-1", nameKey: "shipHud.names.red1" }),
        redRestrictArea.createShip({ team: "red", name: "红-2", nameKey: "shipHud.names.red2" }),
        blueRestrictArea.createShip({ team: "blue", name: "蓝-1", nameKey: "shipHud.names.blue1" }),
        blueRestrictArea.createShip({ team: "blue", name: "蓝-2", nameKey: "shipHud.names.blue2" }),
      ];
    },

    fireShell(ship: Ship, target: Ship) {
      const spec = getWeaponSpec("shell");
      const from = { x: ship.x, y: ship.y };
      const aim = predictAim(from, target, spec.speed);
      const projectiles = fireWeapon("shell", ship, from, aim, {
        bounds: { width: W, height: H, margin: 20 },
        onMuzzle: (point) => emitBurst(point.x, point.y, spec.muzzleParticles, spec.muzzleColor),
      });
      for (const projectile of projectiles) this.projectiles.push(projectile);
    },

    fireTorpedo(ship: Ship, target: Ship) {
      const spec = getWeaponSpec("torp");
      const from = { x: ship.x, y: ship.y };
      const aim = predictAim(from, target, spec.speed);
      const projectiles = fireWeapon("torp", ship, from, aim, {
        bounds: { width: W, height: H, margin: 20 },
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
    fireShellAt(ship: Ship, x: number, y: number) {
      const spec = getWeaponSpec("shell");
      const from = { x: ship.x, y: ship.y };
      const projectiles = fireWeapon(
        "shell",
        ship,
        from,
        { x, y },
        {
          bounds: { width: W, height: H, margin: 20 },
          onMuzzle: (point) => emitBurst(point.x, point.y, spec.muzzleParticles, spec.muzzleColor),
        },
      );
      for (const projectile of projectiles) this.projectiles.push(projectile);
    },

    // 向世界坐标点开火鱼雷（不预测目标，直取给定点）
    fireTorpedoAt(ship: Ship, x: number, y: number) {
      const from = { x: ship.x, y: ship.y };
      const projectiles = fireWeapon(
        "torp",
        ship,
        from,
        { x, y },
        {
          bounds: { width: W, height: H, margin: 20 },
        },
      );
      for (const projectile of projectiles) this.projectiles.push(projectile);
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
          target.takeDamage(projectile.dmg);
          const spec = getWeaponSpec(projectile.type);
          emitBurst(x, y, spec.impactParticles, spec.impactColor);
        },
        onTerrainHit: (projectile, x, y) => {
          // 鱼雷/炮弹撞上岛礁：爆炸消失，不穿过地形
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
