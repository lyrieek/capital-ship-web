// 武器发射平台/炮塔绘制（游戏与调试页共用）
import type { WeaponId } from "./spec";

const TAU = Math.PI * 2;

// 炮管固定使用炮钢色，不再跟随阵营颜色
const BARREL_EDGE = "#3f464d";
const BARREL_SHADE = "#565e66";
const BARREL_MID = "#7c858d";
const BARREL_LIGHT = "#aeb7bf";
const BARREL_HI = "#c8d0d7";
const BORE = "#1c2126";

// 一门炮管的几何参数（炮塔局部坐标，x 朝炮口方向）
interface BarrelGeometry {
  start: number;
  tip: number;
  breechHalf: number;
  barrelHalf: number;
  muzzleLen: number;
  line: number;
}

// 炮塔底座的投影、炮钢座圈、阵营涂装炮室与铆钉
function paintTurretBase(ctx: CanvasRenderingContext2D, radius: number, light: string, dark: string): void {
  // 投影
  ctx.beginPath();
  ctx.ellipse(radius * 0.12, radius * 0.18, radius, radius * 0.96, 0, 0, TAU);
  ctx.fillStyle = "rgba(0,0,0,.4)";
  ctx.fill();

  // 固定炮钢座圈（不跟随阵营颜色）
  const ringGrad = ctx.createLinearGradient(-radius * 0.4, -radius, radius * 0.5, radius);
  ringGrad.addColorStop(0, BARREL_HI);
  ringGrad.addColorStop(0.35, BARREL_MID);
  ringGrad.addColorStop(1, BARREL_EDGE);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fillStyle = ringGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(10,14,18,.7)";
  ctx.lineWidth = Math.max(1, radius * 0.07);
  ctx.stroke();

  // 炮室：阵营涂装，偏心高光形成穹顶感
  const domeGrad = ctx.createRadialGradient(-radius * 0.34, -radius * 0.44, radius * 0.1, 0, 0, radius * 0.88);
  domeGrad.addColorStop(0, light);
  domeGrad.addColorStop(0.62, light);
  domeGrad.addColorStop(1, dark);
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.84, 0, TAU);
  ctx.fillStyle = domeGrad;
  ctx.fill();

  // 金属灰罩色，压住阵营色避免过艳
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.84, 0, TAU);
  ctx.fillStyle = "rgba(148,160,170,.2)";
  ctx.fill();

  // 顶部边缘高光
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.94, Math.PI * 0.86, Math.PI * 1.34);
  ctx.strokeStyle = "rgba(255,255,255,.2)";
  ctx.lineWidth = Math.max(0.6, radius * 0.05);
  ctx.stroke();

  // 炮塔环缝
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.84, 0, TAU);
  ctx.strokeStyle = "rgba(0,0,0,.32)";
  ctx.lineWidth = Math.max(0.6, radius * 0.035);
  ctx.stroke();

  // 座圈铆钉
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    const rx = Math.cos(a) * radius * 0.92;
    const ry = Math.sin(a) * radius * 0.92;
    ctx.beginPath();
    ctx.arc(rx, ry, Math.max(0.6, radius * 0.04), 0, TAU);
    ctx.fillStyle = "rgba(24,28,33,.55)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rx - radius * 0.012, ry - radius * 0.012, Math.max(0.3, radius * 0.018), 0, TAU);
    ctx.fillStyle = "rgba(232,238,243,.4)";
    ctx.fill();
  }
}

// 锥形炮管轮廓（供填充与裁剪共用）
function traceBarrel(ctx: CanvasRenderingContext2D, geo: BarrelGeometry): void {
  ctx.beginPath();
  ctx.moveTo(geo.start, -geo.breechHalf);
  ctx.lineTo(geo.tip - geo.muzzleLen, -geo.barrelHalf);
  ctx.lineTo(geo.tip - geo.muzzleLen, geo.barrelHalf);
  ctx.lineTo(geo.start, geo.breechHalf);
  ctx.closePath();
}

// 炮管细纹：纵向锻压痕与炮尾磨损
function paintBarrelStreaks(ctx: CanvasRenderingContext2D, geo: BarrelGeometry, radius: number): void {
  ctx.save();
  traceBarrel(ctx, geo);
  ctx.clip();

  const streakOffset = radius * 0.012;
  const length = geo.tip - geo.start;

  for (const [t, color, widthScale] of [
    [-0.55, "rgba(255,255,255,.13)", 0.7],
    [-0.16, "rgba(255,255,255,.08)", 0.5],
    [0.18, "rgba(0,0,0,.13)", 0.6],
    [0.52, "rgba(0,0,0,.1)", 0.5],
  ] as const) {
    const yy = t * geo.breechHalf;
    ctx.beginPath();
    ctx.moveTo(geo.start, yy - streakOffset);
    ctx.lineTo(geo.tip, yy * 0.8);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.35, geo.line * widthScale);
    ctx.stroke();
  }

  for (const [sx, sy, len] of [
    [0.16, -0.35, 0.18],
    [0.3, 0.28, 0.12],
    [0.12, 0.05, 0.22],
  ] as const) {
    const startX = geo.start + length * sx;
    ctx.beginPath();
    ctx.moveTo(startX, sy * geo.breechHalf);
    ctx.lineTo(startX + length * len, sy * geo.breechHalf + streakOffset);
    ctx.strokeStyle = "rgba(30,36,42,.18)";
    ctx.lineWidth = Math.max(0.3, geo.line * 0.45);
    ctx.stroke();
  }

  ctx.restore();
}

// 炮管本体 + 炮盾 + 两道加强箍
function paintBarrel(ctx: CanvasRenderingContext2D, geo: BarrelGeometry, radius: number): void {
  const length = geo.tip - geo.start;

  // 炮管在甲板上的投影
  ctx.save();
  ctx.translate(0, Math.max(0.6, radius * 0.08));
  traceBarrel(ctx, geo);
  ctx.fillStyle = "rgba(0,0,0,.2)";
  ctx.fill();
  ctx.restore();

  const barrelGrad = ctx.createLinearGradient(0, -geo.breechHalf, 0, geo.breechHalf);
  barrelGrad.addColorStop(0, BARREL_EDGE);
  barrelGrad.addColorStop(0.2, BARREL_LIGHT);
  barrelGrad.addColorStop(0.42, BARREL_HI);
  barrelGrad.addColorStop(0.62, BARREL_MID);
  barrelGrad.addColorStop(0.84, BARREL_SHADE);
  barrelGrad.addColorStop(1, BARREL_EDGE);

  traceBarrel(ctx, geo);
  ctx.fillStyle = barrelGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(12,16,20,.6)";
  ctx.lineWidth = geo.line;
  ctx.stroke();

  paintBarrelStreaks(ctx, geo, radius);

  // 炮盾：炮管根部略外扩的一小段
  const mantletEnd = geo.start + length * 0.16;
  const mantletGrad = ctx.createLinearGradient(0, -geo.breechHalf * 1.2, 0, geo.breechHalf * 1.2);
  mantletGrad.addColorStop(0, BARREL_EDGE);
  mantletGrad.addColorStop(0.3, BARREL_LIGHT);
  mantletGrad.addColorStop(0.62, BARREL_MID);
  mantletGrad.addColorStop(1, BARREL_SHADE);
  ctx.beginPath();
  ctx.moveTo(geo.start, -geo.breechHalf * 1.16);
  ctx.lineTo(mantletEnd, -geo.breechHalf * 1.02);
  ctx.lineTo(mantletEnd, geo.breechHalf * 1.02);
  ctx.lineTo(geo.start, geo.breechHalf * 1.16);
  ctx.closePath();
  ctx.fillStyle = mantletGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(12,16,20,.5)";
  ctx.lineWidth = Math.max(0.5, geo.line * 0.8);
  ctx.stroke();

  for (const t of [0.32, 0.68]) {
    const bx = geo.start + length * t;
    const half = geo.breechHalf + (geo.barrelHalf - geo.breechHalf) * t;
    const bandW = Math.max(1.2, radius * 0.11);
    const bandGrad = ctx.createLinearGradient(0, -half, 0, half);
    bandGrad.addColorStop(0, BARREL_EDGE);
    bandGrad.addColorStop(0.35, BARREL_HI);
    bandGrad.addColorStop(1, BARREL_SHADE);
    ctx.beginPath();
    ctx.rect(bx - bandW * 0.5, -half * 1.06, bandW, half * 2.12);
    ctx.fillStyle = bandGrad;
    ctx.fill();
    ctx.strokeStyle = "rgba(12,16,20,.45)";
    ctx.lineWidth = Math.max(0.5, geo.line * 0.7);
    ctx.stroke();
  }
}

// 炮口制退器 + 深色膛口
function paintMuzzle(ctx: CanvasRenderingContext2D, geo: BarrelGeometry): void {
  const { tip, muzzleLen, barrelHalf, line } = geo;

  const muzzleGrad = ctx.createLinearGradient(0, -barrelHalf * 1.35, 0, barrelHalf * 1.35);
  muzzleGrad.addColorStop(0, BARREL_SHADE);
  muzzleGrad.addColorStop(0.32, BARREL_HI);
  muzzleGrad.addColorStop(1, BARREL_EDGE);
  ctx.beginPath();
  ctx.moveTo(tip - muzzleLen, -barrelHalf * 1.32);
  ctx.lineTo(tip, -barrelHalf * 1.06);
  ctx.lineTo(tip, barrelHalf * 1.06);
  ctx.lineTo(tip - muzzleLen, barrelHalf * 1.32);
  ctx.closePath();
  ctx.fillStyle = muzzleGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(12,16,20,.55)";
  ctx.lineWidth = line;
  ctx.stroke();

  // 膛口：俯视角度只看到炮口端面的一道暗槽
  ctx.beginPath();
  ctx.ellipse(tip - muzzleLen * 0.35, 0, Math.max(0.5, barrelHalf * 0.16), barrelHalf * 0.6, 0, 0, TAU);
  ctx.fillStyle = BORE;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.55)";
  ctx.lineWidth = Math.max(0.35, line * 0.5);
  ctx.stroke();
}

// 开火余焰：只在后坐力存在时出现
function paintMuzzleFlash(ctx: CanvasRenderingContext2D, geo: BarrelGeometry, radius: number, recoil: number): void {
  if (recoil <= 0.02) return;
  const flashR = radius * 1.25;
  const flash = ctx.createRadialGradient(geo.tip, 0, 0, geo.tip, 0, flashR);
  flash.addColorStop(0, `rgba(255,226,150,${0.42 * recoil})`);
  flash.addColorStop(0.45, `rgba(255,190,90,${0.16 * recoil})`);
  flash.addColorStop(1, "rgba(255,190,90,0)");
  ctx.beginPath();
  ctx.arc(geo.tip, 0, flashR, 0, TAU);
  ctx.fillStyle = flash;
  ctx.fill();
}

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

  const kick = -recoil * Math.max(2, radius * 0.35);
  const geo: BarrelGeometry = {
    start: kick - radius * 0.12,
    tip: kick + barrelLen,
    breechHalf: Math.max(2.2, radius * 0.34),
    barrelHalf: Math.max(1.8, radius * 0.24),
    muzzleLen: Math.max(2.5, Math.min(barrelLen * 0.17, radius * 0.72)),
    line: Math.max(0.6, radius * 0.06),
  };

  paintTurretBase(ctx, radius, light, dark);
  paintBarrel(ctx, geo, radius);
  paintMuzzle(ctx, geo);
  paintMuzzleFlash(ctx, geo, radius, recoil);

  ctx.restore();
}

function drawTorpedoLauncher(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = "#7a8b99";
  ctx.beginPath();
  const roundRect = (ctx as CanvasRenderingContext2D & { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect;
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
