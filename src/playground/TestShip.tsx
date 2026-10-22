import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Camera, Color4, DynamicTexture, Engine, FreeCamera, MeshBuilder, Scene, Vector3, type StandardMaterial } from "@babylonjs/core";
import { useTranslation } from "react-i18next";
import { createOceanSurface } from "../expanse";
import { ShipImpl } from "../ship/index";
import type { Ship, ShipConfig } from "../ship/ship";
import { paintShip, paintShipHud } from "../game/textures";
import { H, P, W, approachAngle } from "../game/utils";
import { issueSelectionSail, updateSailOrder } from "../game/movement";
import {
  bindAttackKey,
  bindOceanSelection,
  bindShipSelection,
  createSelectionRing,
  nearestEnemyOrders,
  ShipSelection,
  type SelectionRing,
} from "../game/selection";
import { createSpriteMaterial, toCanvas2D } from "../weapons";
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
// 单艘舰船的 HUD 贴图尺寸（世界单位 / 像素）
const HUD_W = 160;
const HUD_H = 56;
// 演示用：按一次 F 键造成的伤害
const DEMO_DAMAGE = 20;

type PlaneMesh = ReturnType<typeof MeshBuilder.CreatePlane>;

interface ShipVisual {
  mesh: PlaneMesh;
  material: StandardMaterial;
  texture: DynamicTexture;
  hud: PlaneMesh;
  hudTexture: DynamicTexture;
  ring: SelectionRing;
  lastHp: number;
  lastState: Ship["state"];
  lastAlive: boolean;
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

// 游戏像素坐标 -> 场景坐标（游戏原点在左上、y 向下；场景居中、y 向上）
const worldToScene = (x: number, y: number, z = 0): Vector3 => new Vector3(x - W / 2, H / 2 - y, z);

// 正交俯视相机
function createCamera(scene: Scene): FreeCamera {
  const camera = new FreeCamera("camera", new Vector3(0, 0, -100), scene);
  camera.setTarget(Vector3.Zero());
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -W / 2;
  camera.orthoRight = W / 2;
  camera.orthoTop = H / 2;
  camera.orthoBottom = -H / 2;
  camera.minZ = 0.1;
  camera.maxZ = 1000;
  return camera;
}

function createPlane(name: string, width: number, height: number, scene: Scene, group: number): PlaneMesh {
  const mesh = MeshBuilder.CreatePlane(name, { width, height }, scene);
  mesh.renderingGroupId = group;
  mesh.isPickable = false;
  return mesh;
}

// 舰船本体 + 头顶 HUD，贴图复用游戏内同一套绘制函数
function createShipVisual(ship: Ship, scene: Scene): ShipVisual {
  const texture = new DynamicTexture(
    `shipTexture_${ship.name}`,
    { width: ship.len * SHIP_TEX_SCALE, height: ship.wid * SHIP_TEX_SCALE },
    scene,
    true,
  );
  paintShip(toCanvas2D(texture), ship, SHIP_TEX_SCALE);
  texture.update();

  const mesh = createPlane(`ship_${ship.name}`, ship.len, ship.wid, scene, RG_SHIP);
  mesh.material = createSpriteMaterial(`shipMaterial_${ship.name}`, texture, scene);
  mesh.position.copyFrom(worldToScene(ship.x, ship.y, SHIP_Z));
  mesh.metadata = ship;
  mesh.isPickable = true;

  const hudTexture = new DynamicTexture(`shipHudTexture_${ship.name}`, { width: HUD_W, height: HUD_H }, scene, true);
  paintShipHud(toCanvas2D(hudTexture), ship, HUD_W, HUD_H);
  hudTexture.update();

  const hud = createPlane(`shipHud_${ship.name}`, HUD_W, HUD_H, scene, RG_HUD);
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

  visual.hud.position.copyFrom(worldToScene(ship.x, ship.y - (ship.wid / 2 + 20), HUD_Z));

  if (visual.lastHp !== ship.hp || visual.lastState !== ship.state || visual.lastAlive !== alive) {
    paintShipHud(toCanvas2D(visual.hudTexture), ship, HUD_W, HUD_H);
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

// F 键：选中的舰船攻击最近的敌舰（仅演示命中与血条变化）
function demoAttack(ships: readonly Ship[], selection: ShipSelection): void {
  for (const { ship, target } of nearestEnemyOrders(ships, selection.list)) {
    ship.recoil = 1;
    target.hp = Math.max(0, target.hp - DEMO_DAMAGE);
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
): number {
  const timeRef = useRef(0);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.04, 0.17, 0.27, 1);
    scene.activeCamera = createCamera(scene);

    // 屏蔽右键菜单，否则右键移动会弹出浏览器菜单
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    canvas.addEventListener("contextmenu", preventContextMenu);

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
      const visual = createShipVisual(ship, scene);
      visualsRef.current.set(ship, visual);
      bindShipSelection(scene, visual.mesh, ship, selection, { onMove: moveSelected });
    }
    bindOceanSelection(scene, oceanSurface.mesh, selection, { onMove: moveSelected });
    bindAttackKey(scene, () => demoAttack(shipsRef.current, selection));

    engine.resize();

    let last = performance.now();
    let frames = 0;
    engine.runRenderLoop(() => {
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
      if (frames % 15 === 0) setFps(Math.round(engine.getFps()));
    });

    const observer = new ResizeObserver(() => engine.resize());
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      canvas.removeEventListener("contextmenu", preventContextMenu);
      engine.stopRenderLoop();
      visualsRef.current.clear();
      shipsRef.current = [];
      scene.dispose();
      engine.dispose();
    };
  }, [canvasRef, moveSelected, selection, shipsRef, visualsRef]);

  return fps;
}

function useShipDebug(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const shipsRef = useRef<Ship[]>([]);
  const visualsRef = useRef<Map<Ship, ShipVisual>>(new Map());
  const [selectedCount, setSelectedCount] = useState(0);
  // 选择状态由共用控制器维护，React 只订阅数量用于面板显示
  const [selection] = useState(() => new ShipSelection((ships) => setSelectedCount(ships.length)));

  const moveSelected = useCallback((x: number, y: number) => issueSelectionSail(selection.list, x, y), [selection]);

  const clearSelection = useCallback(() => selection.clear(), [selection]);

  const fps = useShipScene(canvasRef, shipsRef, visualsRef, selection, moveSelected);

  return { fps, selectedCount, clearSelection };
}

export default function TestShip() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { fps, selectedCount, clearSelection } = useShipDebug(canvasRef);

  return (
    <div className="playground">
      <div className="playground-body">
        <section className="playground-controls">
          <h2>{t("ship.title")}</h2>
          <p>{t("ship.hint")}</p>
          <button type="button" onClick={clearSelection}>
            {t("ship.clearSelection")}
          </button>
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
