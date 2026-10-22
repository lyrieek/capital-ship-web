// Game state singleton
import type { GameState, ParticleItem } from "./types";
import { ShipImpl } from "../ship/index";
import type { Ship } from "../ship/ship";
import { renderGame } from "./render";
import { H, W, P, rand } from "./utils";
// 武器的发射逻辑与弹药更新已抽离到 src/weapons
import { clampToBounds, fireWeapon, getWeaponSpec, predictAim, updateProjectiles as updateWeaponProjectiles, withinRange } from "../weapons";

const TAU = Math.PI * 2;

const SHELL = getWeaponSpec("shell");
const TORPEDO = getWeaponSpec("torp");
// 手动齐射（F 键）的公共冷却，避免连续按键无限输出
const MANUAL_FIRE_COOLDOWN = 2.5;

// 创建爆炸粒子的辅助函数
function createParticles(x: number, y: number, n: number, color: string, particles: ParticleItem[]) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const sp = Math.random() * 190 + 30;
    const life = Math.random() * 0.55 + 0.25;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life,
      maxLife: life,
      size: Math.random() * 3 + 1.5,
      color,
    });
  }
}

let gameInstance: GameState | null = null;

export { gameInstance };

export function getGameInstance(): GameState | null {
  return gameInstance;
}

const mkShip = (team: "red" | "blue", name: string, x: number, y: number, dir: 1 | -1, minX: number, maxX: number, light: string, dark: string) =>
  new ShipImpl({ team, name, x, y, baseY: y, dir, minX, maxX, light, dark });

// oxlint-disable-next-line max-lines-per-function
export function initializeGame(): GameState {
  const particles: ParticleItem[] = [];

  const game: GameState = {
    ships: [],
    projectiles: [],
    particles,
    time: 0,
    over: false,
    winnerTeam: null,
    manualFireCD: 0,

    reset() {
      this.projectiles.length = 0;
      this.particles.length = 0;
      this.time = 0;
      this.over = false;
      this.winnerTeam = null;
      this.manualFireCD = 0;

      this.ships = [
        mkShip("red", "红-1", 200, 120, 1, 70, 400, "#ff7b6b", "#b8322a"),
        mkShip("red", "红-2", 280, 240, -1, 70, 400, "#ff9f8a", "#c43a30"),
        mkShip("blue", "蓝-1", 700, 360, -1, W - 330, W, "#7cc4ff", "#1d5c9e"),
        mkShip("blue", "蓝-2", 620, 480, 1, W - 330, W, "#a5d8ff", "#2a6ba8"),
      ];
    },

    fireShell(ship: Ship, target: Ship) {
      const spec = getWeaponSpec("shell");
      const from = { x: ship.x, y: ship.y };
      const aim = predictAim(from, target, spec.speed);
      const projectiles = fireWeapon("shell", ship, from, aim, {
        bounds: { width: W, height: H, margin: 20 },
        onMuzzle: (point) => createParticles(point.x, point.y, spec.muzzleParticles, spec.muzzleColor, this.particles),
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

    focusFire(ships: readonly Ship[]) {
      if (this.over || this.manualFireCD > 0) return;

      let anyFired = false;
      for (const ship of ships) {
        if (!ship.alive) continue;
        const target = ship.findTarget();
        if (!target) continue;

        let fired = false;
        if (withinRange(ship, target, SHELL.range)) {
          this.fireShell(ship, target);
          ship.gunCD = rand(SHELL.cooldownMin, SHELL.cooldownMax);
          fired = true;
        }
        if (withinRange(ship, target, TORPEDO.range)) {
          this.fireTorpedo(ship, target);
          ship.torpCD = rand(TORPEDO.cooldownMin, TORPEDO.cooldownMax);
          fired = true;
        }

        if (fired) {
          ship.recoil = 1;
          anyFired = true;
        }
      }

      if (anyFired) this.manualFireCD = MANUAL_FIRE_COOLDOWN;
    },

    burst(x: number, y: number, n: number, color: string) {
      createParticles(x, y, n, color, this.particles);
    },

    resolveCollisions() {
      const alive = this.ships.filter((s) => s.hp > 0);
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i],
            b = alive[j];
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d < P.minSep && d > 0.001) {
            const push = (P.minSep - d) * 0.5;
            const nx = dx / d,
              ny = dy / d;
            a.x -= nx * push;
            a.y -= ny * push;
            b.x += nx * push;
            b.y += ny * push;
          }
        }
      }
      for (const s of alive) {
        s.x = Math.max(70, Math.min(s.maxX, s.x));
        s.y = Math.max(P.yMin, Math.min(P.yMax, s.y));
      }
    },

    updateProjectiles(dt: number) {
      updateWeaponProjectiles(dt, {
        projectiles: this.projectiles,
        targets: this.ships,
        worldWidth: W,
        worldHeight: H,
        onHit: (projectile, target, x, y) => {
          target.takeDamage(projectile.dmg);
          const spec = getWeaponSpec(projectile.type);
          createParticles(x, y, spec.impactParticles, spec.impactColor, this.particles);
        },
        onLanded: (_projectile, x, y) => {
          // 炮弹落海：溅起一小片水花（位置收进海面范围内）
          const splash = clampToBounds({ x, y }, { width: W, height: H });
          createParticles(splash.x, splash.y, 16, "#bfe9ff", this.particles);
        },
      });
    },

    updateParticles(dt: number) {
      for (const p of this.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - 2.5 * dt;
        p.vy *= 1 - 2.5 * dt;
        p.life -= dt;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
    },

    update(dt: number) {
      this.manualFireCD = Math.max(0, this.manualFireCD - dt);
      if (!this.over) {
        this.time += dt;
        for (const s of this.ships) s.update(dt);
        this.resolveCollisions();
      }

      this.updateProjectiles(dt);
      this.updateParticles(dt);

      if (!this.over) {
        const teams = new Set(this.ships.filter((s) => s.hp > 0).map((s) => s.team));
        if (teams.size <= 1) {
          this.over = true;
          this.winnerTeam = teams.size === 1 ? [...teams][0] : null;
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
}
