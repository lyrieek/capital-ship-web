// DynamicTexture 的矢量绘制：沿用原有 Canvas 2D 画法，只是绘制到贴图上下文上
import type { DynamicTexture } from "@babylonjs/core";
import type { Ship } from "./ship.d";
import { TAU } from "./utils";

// Babylon 的 ICanvasRenderingContext 未声明 textAlign/textBaseline，运行时实际就是标准 2D 上下文
export function toCanvas2D(texture: DynamicTexture): CanvasRenderingContext2D {
  return texture.getContext() as unknown as CanvasRenderingContext2D;
}

// 绘制海水贴图（time 用于波浪相位动画）
export function paintWater(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#0a2c44");
  gradient.addColorStop(0.5, "#0d3c5c");
  gradient.addColorStop(1, "#0a2c44");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(120,200,255,.075)";
  ctx.lineWidth = 2;
  const rows = 10;
  for (let i = 0; i < rows; i++) {
    const y = ((i + 1) / (rows + 1)) * height;
    ctx.beginPath();
    for (let x = 0; x <= width; x += width / 40) {
      const yy = y + Math.sin((x / width) * Math.PI * 4 + time * 1.6 + i) * height * 0.012;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
}

// 重绘并上传海水贴图（每帧调用以播放波浪动画）
export function refreshWater(texture: DynamicTexture, width: number, height: number, time: number): void {
  paintWater(toCanvas2D(texture), width, height, time);
  texture.update();
}

/**
 * 绘制舰船贴图
 * TODO: 炮塔/开火朝向、甲板投影等细节（命中闪白已在同步时用自发光增亮实现）
 */
export function paintShip(ctx: CanvasRenderingContext2D, ship: Ship, scale: number): void {
  const length = ship.len * scale;
  const width = ship.wid * scale;
  const bow = 26 * scale;

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

export function paintShell(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, width * 0.25, 0, TAU);
  ctx.fillStyle = "rgba(255,210,100,.22)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, width * 0.12, 0, TAU);
  ctx.fillStyle = "#ffe08a";
  ctx.fill();
}

export function paintTorpedo(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.fillStyle = "#8ee7ff";
  ctx.beginPath();
  ctx.ellipse(0, 0, width * 0.35, height * 0.32, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#e6fbff";
  ctx.beginPath();
  ctx.arc(width * 0.22, 0, height * 0.16, 0, TAU);
  ctx.fill();
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

// 全屏 HUD 已改为 React + Babylon GUI 组件（src/components/Hud.tsx），本函数不再使用。
