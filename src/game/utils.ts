// Game configuration constants
import type { GameConfig } from './types';

export const P: GameConfig = {
  moveSpeed: 120,
  normalFactor: 0.5,
  dodgeFactor: 1.0,
  turnRate: 85 * Math.PI / 180,
  dodgeDuration: 1.15,
  recoverDuration: 1.30,
  dodgeSideDist: 70,
  shellSpeed: 330,
  shellDmg: 10,
  shellR: 26,
  torpSpeed: 250,
  torpDmg: 30,
  torpR: 34,
  firePenalty: 0.5,
  minSep: 80,
  yMin: 70,
  yMax: 730,
};

export const W = 1600;
export const H = 900;
export const TAU = Math.PI * 2;

export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

export function approachAngle(cur: number, target: number, step: number): number {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= step) return target;
  return cur + Math.sign(d) * step;
}

export function predictAim(sx: number, sy: number, target: any, speed: number): any {
  let t = Math.hypot(target.x - sx, target.y - sy) / speed;
  for (let i = 0; i < 4; i++) {
    const px = target.x + target.vx * t;
    const py = target.y + target.vy * t;
    t = Math.hypot(px - sx, py - sy) / speed;
  }
  return { x: target.x + target.vx * t, y: target.y + target.vy * t, t };
}