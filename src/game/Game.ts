// Game state singleton
import type { GameState, ParticleItem } from "./types";
import { ShipImpl } from "./ship";
import type { Ship } from "./ship.d";
import { renderGame } from "./render";
import { H, W } from "./utils";

const TAU = Math.PI * 2;

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

    reset() {
      this.projectiles.length = 0;
      this.particles.length = 0;
      this.time = 0;
      this.over = false;
      this.winnerTeam = null;

      this.ships = [
        mkShip("red", "红-1", 200, 120, 1, 70, 400, "#ff7b6b", "#b8322a"),
        mkShip("red", "红-2", 280, 240, -1, 70, 400, "#ff9f8a", "#c43a30"),
        mkShip("blue", "蓝-1", 700, 360, -1, W - 330, W, "#7cc4ff", "#1d5c9e"),
        mkShip("blue", "蓝-2", 620, 480, 1, W - 330, W, "#a5d8ff", "#2a6ba8"),
      ];
    },

    fireShell(ship: Ship, target: Ship) {
      const S = 330;
      let t = Math.hypot(target.x - ship.x, target.y - ship.y) / S;
      for (let i = 0; i < 4; i++) {
        const px = target.x + target.vx * t;
        const py = target.y + target.vy * t;
        t = Math.hypot(px - ship.x, py - ship.y) / S;
      }
      const ax = target.x + target.vx * t + Math.random() * 90 - 45;
      const ay = target.y + target.vy * t + Math.random() * 90 - 45;
      const ang = Math.atan2(ay - ship.y, ax - ship.x);
      const mx = ship.x + Math.cos(ang) * 46;
      const my = ship.y + Math.sin(ang) * 46;

      this.projectiles.push({
        type: "shell",
        owner: ship,
        x: mx,
        y: my,
        vx: Math.cos(ang) * S,
        vy: Math.sin(ang) * S,
        r: 26,
        dmg: 10,
        life: 5,
        trail: [],
      });

      createParticles(mx, my, 6, "#ffd166", this.particles);
    },

    fireTorpedo(ship: Ship, target: Ship) {
      const S = 250;
      let t = Math.hypot(target.x - ship.x, target.y - ship.y) / S;
      for (let i = 0; i < 4; i++) {
        const px = target.x + target.vx * t;
        const py = target.y + target.vy * t;
        t = Math.hypot(px - ship.x, py - ship.y) / S;
      }
      const ax = target.x + target.vx * t + Math.random() * 24 - 12;
      const ay = target.y + target.vy * t + Math.random() * 24 - 12;
      const ang = Math.atan2(ay - ship.y, ax - ship.x);
      const mx = ship.x + Math.cos(ang) * 46;
      const my = ship.y + Math.sin(ang) * 46;

      this.projectiles.push({
        type: "torp",
        owner: ship,
        x: mx,
        y: my,
        vx: Math.cos(ang) * S,
        vy: Math.sin(ang) * S,
        r: 34,
        dmg: 30,
        life: 9,
        trail: [],
      });
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
          if (d < 80 && d > 0.001) {
            const push = (80 - d) * 0.5;
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
        s.y = Math.max(70, Math.min(540, s.y));
      }
    },

    updateProjectiles(dt: number) {
      for (const p of this.projectiles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;

        p.trail.push(p.x, p.y);
        if (p.trail.length > 24) p.trail.splice(0, 2);

        if (p.life <= 0 || p.x < -60 || p.x > W || p.y < -60 || p.y > H) {
          p.dead = true;
          continue;
        }

        for (const s of this.ships) {
          if (s === p.owner || s.hp <= 0) continue;

          const dx = p.x - s.x;
          const dy = p.y - s.y;
          const rx = s.len / 2 + p.r;
          const ry = s.wid / 2 + p.r;

          if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
            p.dead = true;
            s.takeDamage(p.dmg);
            createParticles(p.x, p.y, p.type === "torp" ? 30 : 12, p.type === "torp" ? "#ff9f43" : "#ffd166", this.particles);
            break;
          }
        }
      }
      this.projectiles = this.projectiles.filter((p) => !p.dead);
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
