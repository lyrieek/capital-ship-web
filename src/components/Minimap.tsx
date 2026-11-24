// Bottom-right tactical minimap: full map, terrain, team restrict areas, ships, and camera viewport.
// Press and drag on the minimap to move the viewport; releasing or leaving the canvas stops.
import { useEffect, useRef, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { getGameInstance, getRestrictAreas } from "../game/Game";
import { getShipSelection } from "../game/render";
import { focusCameraAt, getCameraFocus } from "../game/camera-focus";
import { getTeamRestrictColor } from "../game/RestrictArea";
import { WORLD_H, WORLD_W } from "../game/world";
import { getViewHeight, getViewWidth } from "../babylon";
import { getTerrainField, getTerrainSpec, islandRadiusAt, shipyardZoneLocal } from "../terrain";

// Internal resolution is 2x the displayed size for crisp lines.
const MM_W = 440;
const MM_H = 248;
const SCALE_X = MM_W / WORLD_W;
const SCALE_Y = MM_H / WORLD_H;

const OCEAN_CENTER = "#177d96";
const OCEAN_EDGE = "#0b4254";
const GRID = "rgba(190, 235, 255, 0.10)";
const VIEWPORT_COLOR = "rgba(240, 250, 255, 0.9)";
// 岛屿沙滩描边：和 3D 网格里的沙滩顶点色保持一致
const ISLAND_SHORE = "#e7d8ab";
// 船坞检测区描边：和 shipyard.ts 里的框同色
const SHIPYARD_ZONE = "#7fe3ff";

function drawGrid(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 8; i++) {
    const x = (MM_W * i) / 8;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, MM_H);
  }
  for (let i = 1; i < 5; i++) {
    const y = (MM_H * i) / 5;
    ctx.moveTo(0, y);
    ctx.lineTo(MM_W, y);
  }
  ctx.stroke();
}

// 地形：岛屿按真实岸线画，船厂按「码头 + 船坞检测框」画，礁石用简化圆点。
// 岸线直接复用 3D 网格的 islandRadiusAt()，船厂检测框复用 shipyardZoneLocal()，
// 所以小地图上的形状和主场景完全一致，不会出现「小地图一个样、主场景另一个样」。
function drawTerrain(ctx: CanvasRenderingContext2D): void {
  const field = getTerrainField();
  if (!field) return;

  for (const item of field.items) {
    const spec = getTerrainSpec(item.kind);
    const scale = item.scale ?? 1;

    if (item.kind === "island") {
      const seed = item.seed ?? 0;
      const steps = 32;
      ctx.beginPath();
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const r = islandRadiusAt(angle, spec, seed) * scale;
        const x = (item.x + Math.cos(angle) * r) * SCALE_X;
        const y = (item.y + Math.sin(angle) * r) * SCALE_Y;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = spec.color;
      ctx.fill();
      // 沙滩描边：让岛在海图上有海岸线，而不是一块纯色
      ctx.strokeStyle = ISLAND_SHORE;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      continue;
    }

    if (item.kind === "shipyard") {
      // 船厂：跟着 rotation 一起转，码头（靠陆）画实心块，船坞（靠海）画检测框。
      // 这样在海图上一眼能看出「厂子哪边靠陆、哪边靠海」。
      const r = spec.radius * scale;
      const zone = shipyardZoneLocal(spec.radius, scale);
      ctx.save();
      ctx.translate(item.x * SCALE_X, item.y * SCALE_Y);
      ctx.rotate(item.rotation ?? 0);
      ctx.fillStyle = spec.color;
      ctx.fillRect(0, -0.85 * r * SCALE_Y, 0.9 * r * SCALE_X, 1.7 * r * SCALE_Y);
      ctx.strokeStyle = SHIPYARD_ZONE;
      ctx.lineWidth = 1;
      ctx.strokeRect(zone.minX * SCALE_X, zone.minY * SCALE_Y, (zone.maxX - zone.minX) * SCALE_X, (zone.maxY - zone.minY) * SCALE_Y);
      ctx.restore();
      continue;
    }

    // 礁石：小地图上用简化圆点表示，尺寸按 spec.radius 缩放
    const radius = Math.max(1.4, spec.radius * scale * SCALE_X);
    ctx.beginPath();
    ctx.arc(item.x * SCALE_X, item.y * SCALE_Y, radius, 0, Math.PI * 2);
    ctx.fillStyle = spec.color;
    ctx.fill();
  }
}

function drawRestrictAreas(ctx: CanvasRenderingContext2D): void {
  const areas = getRestrictAreas();
  for (const area of areas) {
    if (!area.enabled) continue;
    const x = area.minX * SCALE_X;
    const y = area.minY * SCALE_Y;
    const w = (area.maxX - area.minX) * SCALE_X;
    const h = (area.maxY - area.minY) * SCALE_Y;
    const color = getTeamRestrictColor(area.team);

    ctx.globalAlpha = 0.1;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);

    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

function drawShips(ctx: CanvasRenderingContext2D): void {
  const game = getGameInstance();
  if (!game) return;
  const selection = getShipSelection();

  for (const ship of game.ships) {
    if (!ship.alive) continue;
    const x = ship.x * SCALE_X;
    const y = ship.y * SCALE_Y;
    const color = ship.team === "red" ? "#ff7b6b" : "#7cc4ff";
    const selected = selection?.has(ship) ?? false;

    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // Heading triangle: angle 0 points right (world +X).
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ship.angle);
    ctx.beginPath();
    ctx.moveTo(9.5, 0);
    ctx.lineTo(-6.5, 6.5);
    ctx.lineTo(-6.5, -6.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(3, 12, 20, 0.7)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
}

function drawViewport(ctx: CanvasRenderingContext2D): void {
  const focus = getCameraFocus();
  const halfW = (getViewWidth() / 2) * SCALE_X;
  const halfH = (getViewHeight() / 2) * SCALE_Y;
  const x = Math.max(0, focus.x * SCALE_X - halfW);
  const y = Math.max(0, focus.y * SCALE_Y - halfH);
  const right = Math.min(MM_W, focus.x * SCALE_X + halfW);
  const bottom = Math.min(MM_H, focus.y * SCALE_Y + halfH);

  ctx.strokeStyle = VIEWPORT_COLOR;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, right - x - 1), Math.max(1, bottom - y - 1));
}

function paintMinimap(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, MM_H);
  gradient.addColorStop(0, OCEAN_EDGE);
  gradient.addColorStop(0.5, OCEAN_CENTER);
  gradient.addColorStop(1, OCEAN_EDGE);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, MM_W, MM_H);

  // 顺序：海面 → 地形 → 网格 → 限制区 → 舰船 → 视口。
  // 地形压在网格下面，网格线才不会画在陆地上看起来像道路。
  drawTerrain(ctx);
  drawGrid(ctx);
  drawRestrictAreas(ctx);
  drawShips(ctx);
  drawViewport(ctx);
}

// Module-level drag flag: pointerdown starts dragging, leave/release stops it.
let dragging = false;

function focusFromPointer(event: PointerEvent<HTMLCanvasElement>): void {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const worldX = ((event.clientX - rect.left) / rect.width) * WORLD_W;
  const worldY = ((event.clientY - rect.top) / rect.height) * WORLD_H;
  focusCameraAt(worldX, worldY);
}

function handlePointerDown(event: PointerEvent<HTMLCanvasElement>): void {
  if (event.button !== 0) return;
  event.preventDefault();
  dragging = true;
  focusFromPointer(event);
}

function handlePointerMove(event: PointerEvent<HTMLCanvasElement>): void {
  if (!dragging) return;
  focusFromPointer(event);
}

function stopDragging(): void {
  dragging = false;
}

export default function Minimap() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let raf = 0;
    const frame = () => {
      paintMinimap(ctx);
      raf = requestAnimationFrame(frame);
    };
    frame();

    return () => cancelAnimationFrame(raf);
  }, []);

  // Releasing the mouse outside the canvas must stop dragging too.
  useEffect(() => {
    globalThis.addEventListener("pointerup", stopDragging);
    globalThis.addEventListener("blur", stopDragging);
    return () => {
      dragging = false;
      globalThis.removeEventListener("pointerup", stopDragging);
      globalThis.removeEventListener("blur", stopDragging);
    };
  }, []);

  return (
    <div className="minimap">
      <div className="minimap-title">{t("minimap.title")}</div>
      <canvas
        ref={canvasRef}
        width={MM_W}
        height={MM_H}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerLeave={stopDragging}
        onPointerCancel={stopDragging}
        onContextMenu={(event) => event.preventDefault()}
      />
    </div>
  );
}
