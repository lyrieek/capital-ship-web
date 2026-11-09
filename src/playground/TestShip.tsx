import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { DynamicTexture, type Scene, type Mesh, type StandardMaterial } from "@babylonjs/core";
import { useTranslation } from "react-i18next";
import { createOceanSurface } from "../expanse";
import { ShipImpl } from "../ship/index";
import type { Ship, ShipConfig } from "../ship/ship";
import { paintShip, paintShipHud } from "../game/textures";
import { H, P, W, approachAngle } from "../game/utils";
import { issueSelectionSail, updateSailOrder } from "../game/movement";
import { bindAttackKey, bindOceanSelection, bindShipSelection, createSelectionRing, ShipSelection, type SelectionRing } from "../game/selection";
import { createBabylonScene, createPlane, createSpriteMaterial, toCanvas2D, worldToScene } from "../babylon";
import { usePreventContextMenu } from "../hooks/use-prevent-context-menu";
import "./playground.css";
import "./TestShip.css";

// 渲染分组：海面 / 选中圈在最底层，舰船与 HUD 依次叠加
const RG_OCEAN = 0;
const RG_SHIP = 1;
const RG_HUD = 2;

// 舰船贴图的 Z 偏移：靠近相机一侧，保证点击时优先选中舰船而不是海面
const SHIP_Z = -1;
const HUD_Z = -2;
// 选中圈贴在海面之上、舰船之下
const RING_Z = -0.5;

// 舰船贴图放大倍率（矢量绘制，放大后更清晰）
const SHIP_TEX_SCALE = 2;
// 单艘舰船的 HUD 贴图基础尺寸（世界单位 / 像素），随 shipSize 缩放
const HUD_W = 160;
const HUD_H = 56;

interface ShipVisual {
  mesh: Mesh;
  material: StandardMaterial;
  texture: DynamicTexture;
  hud: Mesh;
  hudTexture: DynamicTexture;
  ring: SelectionRing;
  lastHp: number;
  lastState: Ship["state"];
  lastAlive: boolean;
  shipSize: number;
}
const createShip = (team: "red" | "blue", name: string, x: number, y: number, dir: 1 | -1): Ship => {
  const cfg: ShipConfig = {
    x,
    y,
    baseY: y,
    dir,
    minX: 70,
    maxX: W - 70,
    light: team === "red" ? "#ff7b6b" : "#7cc4ff",
    dark: team === "red" ? "#b8322a" : "#1d5c9e",
    name,
    team,
  };
  return new ShipImpl(cfg);
};

const createShips = (): Ship[] => [
  createShip("red", "红-1", 200, 120, 1),
  createShip("red", "红-2", 280, 240, -1),
  createShip("blue", "蓝-1", 700, 360, -1),
  createShip("blue", "蓝-2", 620, 480, 1),
];

// 舰船本体 + 头顶 HUD，贴图复用游戏内同一套绘制函数；shipSize 缩放舰船与 HUD 尺寸，默认 1
function createShipVisual(ship: Ship, scene: Scene, shipSize = 1): ShipVisual {
  const scale = SHIP_TEX_SCALE * shipSize;
  const texture = new DynamicTexture(`shipTexture_${ship.name}`, { width: ship.len * scale, height: ship.wid * scale }, scene, true);
  paintShip(toCanvas2D(texture), ship, scale);
  texture.update();

  const mesh = createPlane(`ship_${ship.name}`, ship.len * shipSize, ship.wid * shipSize, scene, RG_SHIP);
  mesh.material = createSpriteMaterial(`shipMaterial_${ship.name}`, texture, scene);
  mesh.position.copyFrom(worldToScene(ship.x, ship.y, SHIP_Z));
  mesh.metadata = ship;
  mesh.isPickable = true;

  const hudWidth = HUD_W * shipSize;
  const hudHeight = HUD_H * shipSize;
  const hudTexture = new DynamicTexture(`shipHudTexture_${ship.name}`, { width: hudWidth, height: hudHeight }, scene, true);
  paintShipHud(toCanvas2D(hudTexture), ship, hudWidth, hudHeight);
  hudTexture.update();

  const hud = createPlane(`shipHud_${ship.name}`, hudWidth, hudHeight, scene, RG_HUD);
  hud.material = createSpriteMaterial(`shipHudMaterial_${ship.name}`, hudTexture, scene);

  const ring = createSelectionRing(scene, ship, RG_OCEAN);
  ring.mesh.position.copyFrom(worldToScene(ship.x, ship.y, RING_Z));

  return {
    mesh,
    material: mesh.material as StandardMaterial,
    texture,
    hud,
    hudTexture,
    ring,
    lastHp: -1,
    lastState: "normal",
    lastAlive: true,
    shipSize,
  };
}

// 把舰船状态同步到 Babylon 可视对象（位置 / 朝向 / 命中闪白 / 血条）
function syncShipVisual(ship: Ship, visual: ShipVisual, selected: boolean): void {
  const alive = ship.alive;
  visual.mesh.setEnabled(alive);
  visual.hud.setEnabled(alive);
  visual.ring.mesh.setEnabled(alive && selected);
  if (!alive) return;

  visual.mesh.position.copyFrom(worldToScene(ship.x, ship.y, SHIP_Z));
  visual.mesh.rotation.z = -ship.angle;
  visual.ring.mesh.position.copyFrom(worldToScene(ship.x, ship.y, RING_Z));

  const flash = 1 + ship.hitFlash * 0.9;
  visual.material.emissiveColor.set(flash, flash, flash);

  visual.hud.position.copyFrom(worldToScene(ship.x, ship.y - (ship.wid / 2 + 20) * visual.shipSize, HUD_Z));

  if (visual.lastHp !== ship.hp || visual.lastState !== ship.state || visual.lastAlive !== alive) {
    const hudWidth = HUD_W * visual.shipSize;
    const hudHeight = HUD_H * visual.shipSize;
    paintShipHud(toCanvas2D(visual.hudTexture), ship, hudWidth, hudHeight);
    visual.hudTexture.update();
    visual.lastHp = ship.hp;
    visual.lastState = ship.state;
    visual.lastAlive = alive;
  }
}

// 调试页只演示巡航与右键航行，不触发武器逻辑
function stepShip(ship: Ship, dt: number): void {
  if (!ship.alive) return;

  ship.hitFlash = Math.max(0, ship.hitFlash - dt * 4);

  // 有航行指令时由公共指令逻辑接管；到达后恢复横向巡航
  if (updateSailOrder(ship, dt)) return;

  const speed = P.moveSpeed * P.normalFactor;
  ship.angle = approachAngle(ship.angle, ship.dir > 0 ? 0 : Math.PI, P.turnRate * dt);
  ship.x += ship.dir * speed * dt;
  if (ship.x < ship.minX) {
    ship.x = ship.minX;
    ship.dir = 1;
  }
  if (ship.x > ship.maxX) {
    ship.x = ship.maxX;
    ship.dir = -1;
  }
}

// F 键：选中的舰船向鼠标所在世界位置开火（仅演示命中与血条变化）
function demoAttack(ships: readonly Ship[], selection: ShipSelection, mouse: { x: number; y: number } | null): void {
  if (!mouse) return;

  for (const ship of selection.list) {
    if (ship.alive) ship.recoil = 1;
  }

  let target: Ship | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const candidate of ships) {
    if (!candidate.alive) continue;
    const distance = (candidate.x - mouse.x) ** 2 + (candidate.y - mouse.y) ** 2;
    if (distance < nearest) {
      nearest = distance;
      target = candidate;
    }
  }

  if (target && nearest < 150 ** 2) {
    target.takeDamage(20);
    target.hitFlash = 1;
  }
}

// 场景、ActionManager 与渲染循环
function useShipScene(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  shipsRef: RefObject<Ship[]>,
  visualsRef: RefObject<Map<Ship, ShipVisual>>,
  selection: ShipSelection,
  moveSelected: (x: number, y: number) => void,
  shipSize = 1,
): number {
  const timeRef = useRef(0);
  const [fps, setFps] = useState(0);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const babylon = createBabylonScene({
      canvas,
      clearColor: [0.04, 0.17, 0.27, 1],
      width: W,
      height: H,
    });
    const scene = babylon.scene;

    const oceanSurface = createOceanSurface({
      scene,
      kind: "shallow",
      worldWidth: W,
      worldHeight: H,
      segmentsX: 200,
      segmentsY: 112,
      renderingGroupId: RG_OCEAN,
    });

    selection.clear();

    shipsRef.current = createShips();
    for (const ship of shipsRef.current) {
      const visual = createShipVisual(ship, scene, shipSize);
      visualsRef.current.set(ship, visual);
      bindShipSelection(scene, visual.mesh, ship, selection, { onMove: moveSelected });
    }
    bindOceanSelection(scene, oceanSurface.mesh, selection, { onMove: moveSelected });
    bindAttackKey(scene, () => demoAttack(shipsRef.current, selection, mouseRef.current));

    const toWorld = (event: MouseEvent): { x: number; y: number } | null => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        x: ((event.clientX - rect.left) / rect.width) * W,
        y: ((event.clientY - rect.top) / rect.height) * H,
      };
    };

    const handleMove = (event: MouseEvent) => {
      const point = toWorld(event);
      if (point) mouseRef.current = point;
    };
    canvas.addEventListener("mousemove", handleMove);

    let last = performance.now();
    let frames = 0;
    babylon.engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      timeRef.current += dt;
      oceanSurface.refresh(timeRef.current);

      selection.retain(shipsRef.current);
      for (const ship of shipsRef.current) {
        stepShip(ship, dt);
        const visual = visualsRef.current.get(ship);
        if (visual) syncShipVisual(ship, visual, selection.has(ship));
      }

      scene.render();

      frames += 1;
      // 帧率统计限流，避免每帧触发 React 重渲染
      if (frames % 15 === 0) setFps(Math.round(babylon.engine.getFps()));
    });

    return () => {
      canvas.removeEventListener("mousemove", handleMove);
      babylon.dispose();
      visualsRef.current.clear();
      shipsRef.current = [];
    };
  }, [canvasRef, moveSelected, selection, shipsRef, visualsRef, shipSize]);

  return fps;
}

function useShipDebug(canvasRef: RefObject<HTMLCanvasElement | null>, shipSize = 1) {
  const shipsRef = useRef<Ship[]>([]);
  const visualsRef = useRef<Map<Ship, ShipVisual>>(new Map());
  const [selectedCount, setSelectedCount] = useState(0);
  // 选择状态由共用控制器维护，React 只订阅数量用于面板显示
  const [selection] = useState(() => new ShipSelection((ships) => setSelectedCount(ships.length)));

  // 屏蔽右键菜单，否则右键移动会弹出浏览器菜单
  usePreventContextMenu(canvasRef);

  const moveSelected = useCallback((x: number, y: number) => issueSelectionSail(selection.list, x, y), [selection]);

  const clearSelection = useCallback(() => selection.clear(), [selection]);

  const fps = useShipScene(canvasRef, shipsRef, visualsRef, selection, moveSelected, shipSize);

  return { fps, selectedCount, clearSelection };
}

export default function TestShip() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shipSize, setShipSize] = useState(1);
  const { fps, selectedCount, clearSelection } = useShipDebug(canvasRef, shipSize);

  return (
    <div className="playground">
      <div className="playground-body">
        <section className="playground-controls">
          <h2>{t("ship.title")}</h2>
          <p>{t("ship.hint")}</p>
          <button type="button" onClick={clearSelection}>
            {t("ship.clearSelection")}
          </button>
          <label className="playground-field">
            <span>shipSize</span>
            <input type="number" min="0.1" step="0.1" value={shipSize} onChange={(e) => setShipSize(Math.max(0.1, Number(e.target.value || 1)))} />
          </label>
          <p>
            {t("ship.selected")}: {selectedCount}
          </p>
          <p>
            {t("ship.fps")}: {fps}
          </p>
        </section>
        <section className="playground-preview">
          <canvas ref={canvasRef} className="playground-canvas" width={W} height={H} />
        </section>
      </div>
    </div>
  );
}
