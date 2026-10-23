// DynamicTexture 的矢量绘制：沿用原有 Canvas 2D 画法，只是绘制到贴图上下文上
import type { Ship } from "../ship/ship";

// 海水（海浪）的绘制已抽离到 src/expanse/ocean.ts
// 炮弹 / 鱼雷的绘制已抽离到 src/weapons/cannon.ts、src/weapons/torpedo.ts

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
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // 后坐力：炮管向后缩
  const kick = -recoil * 9;

  // 炮座投影
  ctx.beginPath();
  ctx.arc(2, 2, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.42)";
  ctx.fill();

  // 炮座主体（金属渐变）
  const grad = ctx.createLinearGradient(-radius, -radius, radius, radius);
  grad.addColorStop(0, light);
  grad.addColorStop(1, dark);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.55)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // 炮座高光
  ctx.beginPath();
  ctx.arc(-radius * 0.32, -radius * 0.32, radius * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,.22)";
  ctx.fill();

  // 炮管
  ctx.beginPath();
  ctx.moveTo(kick, -radius * 0.5);
  ctx.lineTo(kick + barrelLen, -radius * 0.5);
  ctx.lineTo(kick + barrelLen, radius * 0.5);
  ctx.lineTo(kick, radius * 0.5);
  ctx.closePath();
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.45)";
  ctx.stroke();

  // 炮口
  ctx.beginPath();
  ctx.arc(kick + barrelLen, 0, radius * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = "#cfcfcf";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.5)";
  ctx.stroke();

  // 炮口余焰
  const flashAlpha = 0.25 + recoil * 0.35;
  ctx.beginPath();
  ctx.arc(kick + barrelLen - radius * 0.12, 0, radius * 0.36, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,218,130,${flashAlpha})`;
  ctx.fill();

  ctx.restore();
}

export function paintShip(ctx: CanvasRenderingContext2D, ship: Ship, scale: number): void {
  const length = ship.len * scale;
  const width = ship.wid * scale;
  const bow = 26 * scale;
  const recoil = ship.recoil;

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

  // ===== 主炮：舰首 1 门，随 aimAngle 转向目标 =====
  const turretR = 16 * scale;
  const turretBarrel = 36 * scale;
  const turretX = length / 2 - bow - turretR * 0.6;
  paintCannon(ctx, turretX, 0, ship.aimAngle, turretR, turretBarrel, ship.light, ship.dark, recoil);

  // ===== 副炮：舰尾 1 门（固定朝后），舷侧各 1 门小炮（固定朝外） =====
  const rearR = 11 * scale;
  const rearBarrel = 24 * scale;
  const rearX = -length / 2 + bow + rearR * 0.6;
  paintCannon(ctx, rearX, 0, Math.PI, rearR, rearBarrel, ship.light, ship.dark, recoil * 0.5);

  const sideR = 6 * scale;
  const sideBarrel = 14 * scale;
  const sideY = width / 2 - sideR * 2.2;
  const sideX = -length / 2 + 30 * scale;
  paintCannon(ctx, sideX, -sideY, -Math.PI / 2, sideR, sideBarrel, ship.light, ship.dark, recoil * 0.4);
  paintCannon(ctx, sideX, sideY, Math.PI / 2, sideR, sideBarrel, ship.light, ship.dark, recoil * 0.4);

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

// 全屏 HUD 已改为 React + Babylon GUI 组件（src/components/Hud.tsx），本函数不再使用。
