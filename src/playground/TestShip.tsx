import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Scene } from "@babylonjs/core";
import { useTranslation } from "react-i18next";
import { createOceanSurface } from "../expanse";
import { createShip, type Ship } from "../ship/index";
import { RestrictAreaImpl } from "../game/RestrictAreaImpl";
import { defaultMap } from "../map";
import { H, P, W, approachAngle } from "../game/utils";
import { VIEW_H, VIEW_W } from "../game/world";
import { screenToWorld, setCameraFocus } from "../game/camera-focus";
import { issueSelectionSail, updateSailOrder } from "../game/movement";
import { bindAttackKey, bindPointerInput, ShipSelection } from "../game/selection";
import { createBabylonScene, worldToScene } from "../babylon";
import { createShipHudLayer } from "../ship/hud";
import { usePreventContextMenu } from "../hooks/use-prevent-context-menu";
import { createShipVisual, disposeNavLine, type ShipVisual, updateShipNavigationLine } from "../ship/render-visual";
import Model from "../components/Model";
import "./playground.css";
import "./TestShip.css";

// 渲染分组：海面在最底层
const RG_OCEAN = 0;
// 调试页只显示地图中央的一块视口，舰船摆在两岸限制区靠近中线的一侧
const createShips = (): Ship[] => [
  createShip({ team: "red", name: "红-1", nameKey: "shipHud.names.red1", x: 2250, y: 1200, dir: 1 }),
  createShip({ team: "red", name: "红-2", nameKey: "shipHud.names.red2", x: 2400, y: 1600, dir: -1 }),
  createShip({ team: "blue", name: "蓝-1", nameKey: "shipHud.names.blue1", x: 2750, y: 1200, dir: -1 }),
  createShip({ team: "blue", name: "蓝-2", nameKey: "shipHud.names.blue2", x: 2900, y: 1600, dir: 1 }),
];

// 把舰船状态同步到 Babylon 可视对象（位置 / 朝向 / 命中闪白 / 血条）
function syncShipVisual(ship: Ship, visual: ShipVisual, selected: boolean, scene: Scene): void {
  const alive = ship.alive;
  visual.mesh.setEnabled(alive);
  visual.hud.setVisible(alive);
  visual.ring.mesh.setEnabled(alive && selected);
  if (!alive) return;

  // 航行导航虚线：仅选中且有航行目标时显示，每帧重新计算不残留旧点
  if (selected) {
    updateShipNavigationLine(visual, ship, scene);
  } else {
    disposeNavLine(visual);
  }

  visual.mesh.position.copyFrom(worldToScene(ship.x, ship.y));
  visual.mesh.rotation.z = -ship.angle;
  visual.ring.mesh.position.copyFrom(worldToScene(ship.x, ship.y));

  const flash = 1 + ship.hitFlash * 0.9;
  visual.material.emissiveColor.set(flash, flash, flash);
  visual.turretMaterial.emissiveColor.set(flash, flash, flash);

  visual.hud.sync(ship);
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

  // 选中的每艘存活舰船都加后坐力
  for (const ship of selection.list) {
    if (ship.alive) ship.recoil = 1;
  }

  // 在鼠标位置附近寻找最近的存活敌舰作为攻击目标
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

  // 距离足够近时造成伤害与闪白
  if (target && nearest < 150 ** 2) {
    target.takeDamage(20);
    target.hitFlash = 1;
  }
}

// 场景、指针输入与渲染循环：负责创建 Babylon 场景、海面、舰船可视对象，
// 并驱动每帧的状态同步与渲染；返回当前帧率供外部显示。
function useShipScene(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  shipsRef: RefObject<Ship[]>,
  visualsRef: RefObject<Map<Ship, ShipVisual>>,
  selection: ShipSelection,
  moveSelected: (x: number, y: number) => void,
  shipSize = 1,
): { fps: number; scene: Scene | null; restrictError: string | null } {
  const timeRef = useRef(0);
  const [fps, setFps] = useState(0);
  const [restrictError, setRestrictError] = useState<string | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  // 鼠标在世界坐标中的位置，供 F 键开火瞄准
  const mouseRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 创建 Babylon 引擎与正交相机场景
    const babylon = createBabylonScene({
      canvas,
      clearColor: [0.04, 0.17, 0.27, 1],
      width: VIEW_W,
      height: VIEW_H,
    });
    const scene = babylon.scene;
    sceneRef.current = scene;
    // 调试页相机固定对准地图中心
    setCameraFocus(W / 2, H / 2);
    const hudLayer = createShipHudLayer(scene, VIEW_W);

    // 海面只铺满可见视口，坐标仍按整张大地图换算
    const oceanSurface = createOceanSurface({
      scene,
      kind: "shallow",
      worldWidth: VIEW_W,
      worldHeight: VIEW_H,
      viewHeight: VIEW_H,
      segmentsX: 200,
      segmentsY: 112,
      renderingGroupId: RG_OCEAN,
    });

    selection.clear();

    shipsRef.current = createShips();
    // 先定义地图行动限制区（按阵营），再画船；限制区虚线框在此一次性画出
    const restrictAreas = defaultMap.zones.map((zone) => new RestrictAreaImpl(zone));
    for (const area of restrictAreas) area.draw(scene);

    for (const ship of shipsRef.current) {
      // 先验证船位置是否在限制区内（在画船之前），不在则拒绝画并记录错误供 modal 显示；
      // 然后将限制区边界应用到船上（供碰撞 clamp 使用）
      const area = restrictAreas.find((a) => a.team === ship.team);
      const err = area?.validate(ship);
      if (err) {
        setRestrictError(err);
        continue;
      }
      area?.applyTo(ship);

      // 创建舰船本体 + 头顶 HUD + 选中圈
      const visual = createShipVisual(ship, scene, hudLayer, shipSize);
      visualsRef.current.set(ship, visual);
    }
    bindPointerInput(scene, selection, { onMove: moveSelected });
    // F 键：选中的舰船向鼠标位置开火
    bindAttackKey(scene, () => demoAttack(shipsRef.current, selection, mouseRef.current));

    // 将屏幕坐标转换为游戏世界坐标（按当前相机焦点换算）
    const toWorld = (event: MouseEvent): { x: number; y: number } | null => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return screenToWorld(scene, event.clientX, event.clientY, rect);
    };

    // 鼠标移动时更新鼠标世界坐标
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
        if (visual) syncShipVisual(ship, visual, selection.has(ship), scene);
      }

      scene.render();

      frames += 1;
      // 帧率统计限流，避免每帧触发 React 重渲染
      if (frames % 15 === 0) setFps(Math.round(babylon.engine.getFps()));
    });

    return () => {
      canvas.removeEventListener("mousemove", handleMove);
      hudLayer.dispose();
      babylon.dispose();
      setRestrictError(null);
      for (const area of restrictAreas) area.dispose();
      visualsRef.current.clear();
      shipsRef.current = [];
    };
  }, [canvasRef, moveSelected, selection, shipsRef, visualsRef, shipSize]);

  return { fps, scene: sceneRef.current, restrictError };
}

// 调试页的公共控制器：维护舰船列表、可视对象、选择状态；
// shipSize 可从外部传入，用于缩放舰船与 HUD 尺寸。
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

  const { fps, scene, restrictError } = useShipScene(canvasRef, shipsRef, visualsRef, selection, moveSelected, shipSize);

  return { fps, scene, selectedCount, clearSelection, restrictError };
}

export default function TestShip() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 舰船与 HUD 缩放比例，默认 1，可在控制面板调节
  const [shipSize, setShipSize] = useState(1);
  const { fps, scene, selectedCount, clearSelection, restrictError } = useShipDebug(canvasRef, shipSize);
  // 限制区错误模态：点击确认后清除
  const [showRestrictError, setShowRestrictError] = useState(false);

  useEffect(() => {
    if (restrictError) setShowRestrictError(true);
  }, [restrictError]);

  return (
    <div className="playground">
      <div className="playground-body">
        <section className="playground-controls">
          <h2>{t("ship.title")}</h2>
          <p>{t("ship.hint")}</p>
          <button type="button" disabled={selectedCount === 0} onClick={clearSelection}>
            {t("ship.clearSelection")}
          </button>
          <label className="playground-field">
            <span>{t("ship.shipSize")}</span>
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
          <canvas ref={canvasRef} className="playground-canvas" width={VIEW_W} height={VIEW_H} />
        </section>
      </div>
      <Model
        scene={scene}
        open={showRestrictError}
        title={t("ship.restrictErrorTitle")}
        message={restrictError ?? ""}
        actions={[
          {
            label: t("ship.restrictErrorButton"),
            onClick: () => {
              setShowRestrictError(false);
            },
          },
        ]}
      />
    </div>
  );
}
