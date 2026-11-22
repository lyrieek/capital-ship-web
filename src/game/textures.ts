// DynamicTexture 的矢量绘制：沿用原有 Canvas 2D 画法，只是绘制到贴图上下文上
import type { Ship } from "../ship/ship";

// 海水（海浪）的绘制已抽离到 src/expanse/ocean.ts
// 炮弹 / 鱼雷的绘制已抽离到 src/weapons/cannon.ts、src/weapons/torpedo.ts
// 炮塔的绘制已抽离到 src/weapons/launcher.ts，由 ship/render-visual.ts 单独作成子 Mesh

// 舰体船首段的长度（世界单位，shipSize = 1 时）
export const SHIP_BOW = 26;

// 主炮：炮座半径 / 炮管长度（世界单位，shipSize = 1 时）
export const MAIN_TURRET_RADIUS = 9;
export const MAIN_TURRET_BARREL = 21;

// 尾部主炮比舰首炮小一圈：渲染时复用主炮贴图并整体缩放
export const REAR_TURRET_RADIUS = 6.5;
export const REAR_TURRET_SCALE = REAR_TURRET_RADIUS / MAIN_TURRET_RADIUS;

/** 主炮在舰体本地坐标里的 X 偏移（正向为舰首） */
export function mainTurretOffset(shipLength: number): number {
  return shipLength / 2 - SHIP_BOW - MAIN_TURRET_RADIUS * 0.6;
}

/** 尾部主炮在舰体本地坐标里的 X 偏移 */
export function rearTurretOffset(shipLength: number): number {
  return -shipLength / 2 + SHIP_BOW + REAR_TURRET_RADIUS * 0.7;
}

/**
 * 绘制舰体贴图（不含炮塔）。
 * 炮塔是可转动的零件，单独画在自己的贴图上并作为子 Mesh 跟随舰体，
 * 这样炮管转动只需要改 TransformNode 的旋转，不用每帧重绘整张舰体贴图。
 */
export function paintHull(ctx: CanvasRenderingContext2D, ship: Ship, scale: number): void {
  const length = ship.len * scale;
  const width = ship.wid * scale;
  const bow = SHIP_BOW * scale;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.save();
  ctx.translate(length / 2, width / 2);

  const points: [number, number][] = [
    [-length / 2, -width / 2],
    [length / 2 - bow, -width / 2],
    [length / 2, 0],
    [length / 2 - bow, width / 2],
    [-length / 2, width / 2],
  ];
  ctx.beginPath();
  points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, -width / 2, 0, width / 2);
  gradient.addColorStop(0, ship.light);
  gradient.addColorStop(1, ship.dark);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.lineWidth = 2 * scale;
  ctx.strokeStyle = "rgba(0,0,0,.45)";
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,.10)";
  ctx.fillRect(-length / 2 + 8 * scale, -width / 2 + 5 * scale, length - 42 * scale, width - 10 * scale);
  ctx.fillStyle = "rgba(255,255,255,.22)";
  ctx.fillRect(-8 * scale, -width / 2 + 3 * scale, 26 * scale, width - 6 * scale);
  ctx.fillStyle = "rgba(0,0,0,.28)";
  ctx.fillRect(-4 * scale, -width / 2 + 6 * scale, 18 * scale, width - 12 * scale);
  ctx.fillStyle = "#1b2733";
  ctx.fillRect(-24 * scale, -width / 2 + 2 * scale, 6 * scale, width - 4 * scale);

  ctx.restore();
}

export function paintParticle(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.6, "rgba(255,255,255,.85)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}
