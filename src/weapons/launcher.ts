// 武器发射平台/炮塔绘制（游戏与调试页共用）
import type { WeaponId } from "./spec";

export function paintCannonTurret(
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

  const kick = -recoil * 9;

  // 炮座投影
  ctx.beginPath();
  ctx.arc(2, 2, radius + 1, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.5)";
  ctx.fill();

  // 炮座主体
  const baseGrad = ctx.createRadialGradient(0, 0, radius * 0.25, 0, 0, radius);
  baseGrad.addColorStop(0, light);
  baseGrad.addColorStop(0.7, light);
  baseGrad.addColorStop(1, dark);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = baseGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.6)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // 高光
  ctx.beginPath();
  ctx.arc(-radius * 0.36, -radius * 0.36, radius * 0.26, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,.28)";
  ctx.fill();

  // 炮管
  const barrelGrad = ctx.createLinearGradient(kick, -radius * 0.6, kick, radius * 0.6);
  barrelGrad.addColorStop(0, "#c9d6e3");
  barrelGrad.addColorStop(0.5, dark);
  barrelGrad.addColorStop(1, "#7a8b99");

  ctx.beginPath();
  ctx.moveTo(kick, -radius * 0.42);
  ctx.lineTo(kick + barrelLen * 0.92, -radius * 0.38);
  ctx.lineTo(kick + barrelLen * 0.92, radius * 0.38);
  ctx.lineTo(kick, radius * 0.42);
  ctx.closePath();
  ctx.fillStyle = barrelGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.5)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 炮口环
  ctx.beginPath();
  ctx.arc(kick + barrelLen * 0.92, 0, radius * 0.44, 0, Math.PI * 2);
  ctx.fillStyle = "#d7e1ea";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.55)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 炮口制退器
  ctx.beginPath();
  ctx.moveTo(kick + barrelLen * 0.88, -radius * 0.26);
  ctx.lineTo(kick + barrelLen, -radius * 0.18);
  ctx.lineTo(kick + barrelLen, radius * 0.18);
  ctx.lineTo(kick + barrelLen * 0.88, radius * 0.26);
  ctx.closePath();
  ctx.fillStyle = "#9aa9b8";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.5)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 余焰
  const flashAlpha = 0.25 + recoil * 0.4;
  ctx.beginPath();
  ctx.arc(kick + barrelLen - radius * 0.08, 0, radius * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,226,150,${flashAlpha})`;
  ctx.fill();

  ctx.restore();
}

function drawTorpedoLauncher(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = "#7a8b99";
  ctx.beginPath();
  const roundRect = (ctx as any).roundRect;
  if (typeof roundRect === "function") {
    roundRect.call(ctx, width * 0.46, height * 0.42, width * 0.38, height * 0.16, 6);
  } else {
    ctx.rect(width * 0.46, height * 0.42, width * 0.38, height * 0.16);
  }
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.5)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(width * 0.86, height * 0.5, height * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = "#c9d6e3";
  ctx.fill();
  ctx.stroke();
}

function drawCannonLauncher(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const turretX = width * 0.58;
  const turretY = height * 0.5;
  const r = height * 0.16;
  const baseGrad = ctx.createRadialGradient(turretX, turretY, r * 0.25, turretX, turretY, r);
  baseGrad.addColorStop(0, "#b8c7d6");
  baseGrad.addColorStop(0.7, "#9fb6c9");
  baseGrad.addColorStop(1, "#6f8599");
  ctx.beginPath();
  ctx.arc(turretX, turretY, r, 0, Math.PI * 2);
  ctx.fillStyle = baseGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.55)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(turretX - r * 0.36, turretY - r * 0.36, r * 0.26, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,.28)";
  ctx.fill();
  const barrelGrad = ctx.createLinearGradient(turretX, turretY - r * 0.42, turretX, turretY + r * 0.42);
  barrelGrad.addColorStop(0, "#c9d6e3");
  barrelGrad.addColorStop(0.5, "#7a8b99");
  barrelGrad.addColorStop(1, "#6f8599");
  ctx.beginPath();
  ctx.moveTo(turretX - r * 0.12, turretY - r * 0.38);
  ctx.lineTo(turretX + r * 0.9, turretY - r * 0.32);
  ctx.lineTo(turretX + r * 0.9, turretY + r * 0.32);
  ctx.lineTo(turretX - r * 0.12, turretY + r * 0.38);
  ctx.closePath();
  ctx.fillStyle = barrelGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.5)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(turretX + r * 0.9, turretY, r * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = "#d7e1ea";
  ctx.fill();
  ctx.stroke();
}

export function paintLauncherPlatform(ctx: CanvasRenderingContext2D, width: number, height: number, weapon: WeaponId): void {
  ctx.clearRect(0, 0, width, height);
  // 船体
  ctx.fillStyle = "#3d5a73";
  ctx.beginPath();
  ctx.moveTo(12, height * 0.35);
  ctx.lineTo(width * 0.62, height * 0.22);
  ctx.lineTo(width * 0.78, height * 0.5);
  ctx.lineTo(width * 0.62, height * 0.78);
  ctx.lineTo(12, height * 0.65);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.45)";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,.16)";
  ctx.fillRect(width * 0.12, height * 0.42, width * 0.28, height * 0.16);

  if (weapon === "torp") {
    drawTorpedoLauncher(ctx, width, height);
  } else {
    drawCannonLauncher(ctx, width, height);
  }
}
