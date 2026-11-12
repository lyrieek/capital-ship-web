// DynamicTexture 的矢量绘制：沿用原有 Canvas 2D 画法，只是绘制到贴图上下文上
import { paintCannonTurret } from "../weapons";
import type { Ship } from "../ship/ship";

// 海水（海浪）的绘制已抽离到 src/expanse/ocean.ts
// 炮弹 / 鱼雷的绘制已抽离到 src/weapons/cannon.ts、src/weapons/torpedo.ts

// 舰船贴图上下额外的透明留白（世界单位，单侧）。
// 炮塔绘制在贴图内部，炮管转到接近垂直时需要这段空间，否则会被纹理边界裁掉。
export const SHIP_TEX_PAD = 9;

/**
 * 绘制舰船贴图
 * TODO: 炮塔/开火朝向、甲板投影等细节（命中闪白已在同步时用自发光增亮实现）
 */
// 绘制一门舰炮：圆形炮座 + 炮管 + 炮口，recoil 控制炮管后坐偏移
function paintCannon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  radius: number,
  barrelLen: number,
  light: string,
  dark: string,
  recoil: number,
): void {
  paintCannonTurret(ctx, x, y, angle, radius, barrelLen, light, dark, recoil);
}

export function paintShip(ctx: CanvasRenderingContext2D, ship: Ship, scale: number): void {
  const length = ship.len * scale;
  const width = ship.wid * scale;
  // 贴图上下留白：炮管转到垂直方向时不会被纹理边界截断
  const height = width + 2 * SHIP_TEX_PAD * scale;
  const bow = 26 * scale;
  const recoil = ship.recoil;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.save();
  ctx.translate(length / 2, height / 2);

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

  // ===== 主炮：舰首 1 门，随 aimAngle 转向目标 =====
  // aimAngle 是世界角度；贴图随舰体一起旋转，因此要减去舰体朝向换算成局部角度
  const turretR = 9 * scale;
  const turretBarrel = 21 * scale;
  const turretX = length / 2 - bow - turretR * 0.6;
  const turretAngle = ship.aimAngle - ship.angle;
  paintCannon(ctx, turretX, 0, turretAngle, turretR, turretBarrel, ship.light, ship.dark, recoil);

  // ===== 尾部主炮：固定朝后，只保留 1 门 =====
  const rearR = 6.5 * scale;
  const rearBarrel = 15 * scale;
  const rearX = -length / 2 + bow + rearR * 0.7;
  paintCannon(ctx, rearX, 0, Math.PI, rearR, rearBarrel, ship.light, ship.dark, recoil * 0.5);

  ctx.restore();
}

export function paintShipHud(ctx: CanvasRenderingContext2D, ship: Ship, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font = "600 12px system-ui, sans-serif";
  ctx.fillStyle = ship.light;
  ctx.fillText(ship.name, width / 2, 10);

  const barWidth = 76;
  const barHeight = 7;
  const barX = (width - barWidth) / 2;
  const barY = 20;

  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillRect(barX - 2, barY - 2, barWidth + 4, barHeight + 4);
  ctx.fillStyle = "#22303d";
  ctx.fillRect(barX, barY, barWidth, barHeight);

  const ratio = ship.hp / ship.maxHp;
  ctx.fillStyle = ratio > 0.55 ? "#4ade80" : ratio > 0.25 ? "#fbbf24" : "#ef4444";
  ctx.fillRect(barX, barY, barWidth * ratio, barHeight);

  ctx.strokeStyle = "rgba(255,255,255,.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, barHeight - 1);

  if (ship.state !== "normal") {
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = ship.state === "dodge" ? "#fbbf24" : "#7dd3fc";
    ctx.fillText(ship.state === "dodge" ? "⚡ 规避转体 · 全速 · 射速减半" : "↩ 回正中 · 全速 · 射速减半", width / 2, 44);
  }
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
