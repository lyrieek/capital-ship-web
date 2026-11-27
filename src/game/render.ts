// Babylon.js 渲染层：把 2D 海战状态同步到「正交俯视」场景
// 相机固定在 -Z 方向俯视 XY 平面，世界单位与游戏像素坐标一一对应。
// 舰船仍是独立 Mesh；炮弹已用 thin instance 合批，粒子用 SolidParticleSystem。
import type { Engine, FreeCamera, Scene } from "@babylonjs/core";
import { createOceanSurface, getOceanKind, type OceanSurface } from "../expanse";
import { createWeaponRender, type WeaponRender } from "../weapons";
import { createTerrainRender, getTerrainField, type TerrainRender } from "../terrain";
import type { GameState } from "./types";
import type { Ship } from "../ship/ship";
import { H, W } from "./utils";
import type { ViewportSize } from "./viewport";
import { getCameraFocus, resetCameraFocus, setCameraFocus, updateCameraFocus } from "./camera-focus";
import { bindPointerInput, ShipSelection } from "./selection";
import { issueSelectionSail } from "./movement";
import type { RestrictAreaImpl } from "./RestrictAreaImpl";
import { applyZoomToCamera, createBabylonScene, getViewHeight, setCameraBaseSize, updateCameraEffect } from "../babylon";
import { emitWake } from "./fx";
import { createParticleFx, type ParticleFx } from "./particle-fx";
import { createShipHudLayer, type ShipHudLayer } from "../ship/hud";
import { createShipVisual, disposeNavLine, disposeShipTurrets, type ShipVisual, RG_SHIP, syncShipVisual } from "../ship/render-visual";

// 渲染分组（Babylon 最多 4 组 0..3），组间自动清深度，按组顺序层叠：
// 0 = 海面；1 = 地物 + 舰船/选中圈/炮塔（组内 alphaIndex 排序）；2 = 弹药/粒子/导航线。
// 世界 Z 只表示真实 3D 高度（地形）和必要的共面深度偏移，不再当图层序号。
const RG_WATER = 0;
const RG_FX = 2;
// 尾流发射速度门槛（px/s）：低于此速度不发尾流，避免原地转圈刷粒子
const WAKE_MIN_SPEED = 6;
// 尾流从船尾外侧的偏移距离，避免与船体贴图重叠
const WAKE_TAIL_OFFSET = 14;
// 尾流按航迹距离发射（世界单位）：船每走这么远才发一次，而不是每帧都发。
// 帧率无关，高刷屏不会成倍增加粒子；密度仍足够让泡沫带连续。
const WAKE_EMIT_SPACING = 5;
// 每艘船上一次发射尾迹时的位置，用于按距离节流
const wakeTrailPoints = new WeakMap<Ship, { x: number; y: number }>();

// 场景资源
let engine: Engine | null = null;
let scene: Scene | null = null;

// 粒子表现（SolidParticleSystem：所有粒子共用一个 Mesh + 一份材质）
let particleFx: ParticleFx | null = null;
// 海面（海浪贴图 + 材质 + 平面），具体绘制在 src/expanse/ocean.ts
let oceanSurface: OceanSurface | null = null;
// 地物（岛屿 / 礁石 / 建筑），具体实现见 src/terrain
let terrainRender: TerrainRender | null = null;
// 舰船头顶 HUD：单个全屏 Babylon GUI 层，所有舰船共用
let shipHudLayer: ShipHudLayer | null = null;
// 弹药渲染（贴图 / Mesh 池 / 弹道），具体实现在 src/weapons/render.ts
let weaponRender: WeaponRender | null = null;

// 当前对局的选择状态（主游戏 / playground 共用同一套选择逻辑）
let shipSelection: ShipSelection | null = null;
// 场景级指针输入的解绑函数
let unbindPointer: (() => void) | null = null;

export function getShipSelection(): ShipSelection | null {
  return shipSelection;
}

/** 重开一局时清空仍在飞的粒子 */
export function clearParticles(): void {
  particleFx?.clear();
}

// 右键：让当前选中的舰船驶向落点
function moveSelection(x: number, y: number): void {
  if (shipSelection) issueSelectionSail(shipSelection.list, x, y);
}

// 每艘舰船对应的可视对象（reset 会重建舰船，故按对象身份做增删）
const shipVisuals = new Map<Ship, ShipVisual>();
// 行动限制区域：按阵营分别定义，在画船前验证位置并画虚线框
let restrictAreas: RestrictAreaImpl[] | null = null;
// 限制区验证错误信息（由 BattleCanvas 读取并弹 modal）
let restrictError: string | null = null;

export function getRestrictError(): string | null {
  return restrictError;
}

function createWater() {
  oceanSurface = createOceanSurface({
    scene: scene!,
    kind: getOceanKind(),
    worldWidth: W,
    worldHeight: H,
    viewHeight: getViewHeight(),
    // 细分数按可见像素密度设定（约 5px/格），不随地图面积线性暴涨
    segmentsX: 320,
    segmentsY: 180,
    renderingGroupId: RG_WATER,
  });
}

function createTerrain() {
  // 地物数据由 Game.ts 在 initializeGame() 时建好（摆船要用它避开岛礁），
  // 这里只把同一份数据画出来，避免两处各建一份、对不上。
  const field = getTerrainField();
  if (!field) return;
  terrainRender = createTerrainRender({ scene: scene!, renderingGroupId: RG_SHIP });
  terrainRender.sync(field.items);
}

function syncShips(game: GameState) {
  const hudLayer = shipHudLayer;
  if (!hudLayer) return;

  // 死亡或重开后被替换的舰船不再保留在选择列表里
  shipSelection?.retain(game.ships);

  const seen = new Set<Ship>();
  for (const ship of game.ships) {
    seen.add(ship);
    let visual = shipVisuals.get(ship);
    if (!visual) {
      // 先验证船位置是否在限制区内、是否落在地物上（在画船之前），不在则拒绝画并记录错误供 modal 显示；
      // 然后把限制区绑定到船上（ship.bounds，供移动 / 碰撞实时读取 X/Y 边界）
      const area = restrictAreas?.find((a) => a.team === ship.team);
      const err = area?.validate(ship);
      if (err) {
        restrictError = err;
        continue;
      }
      area?.attach(ship);

      visual = createShipVisual(ship, scene!, hudLayer, 1);
      shipVisuals.set(ship, visual);
    }

    // 单船视觉同步（位置/朝向/选中圈/导航线/闪白/炮塔/HUD）统一由 render-visual 提供
    const selected = shipSelection?.has(ship) ?? false;
    syncShipVisual(ship, visual, selected, scene!);
  }

  for (const [ship, visual] of shipVisuals) {
    if (seen.has(ship)) continue;
    disposeShipTurrets(visual);
    visual.mesh.dispose();
    visual.hud.dispose();
    visual.ring.dispose();
    visual.texture.dispose();
    disposeNavLine(visual);
    shipVisuals.delete(ship);
  }
}

export function disposeRender() {
  restrictError = null;
  shipVisuals.clear();
  unbindPointer?.();
  unbindPointer = null;
  shipSelection = null;
  particleFx?.dispose();
  particleFx = null;
  shipHudLayer?.dispose();
  shipHudLayer = null;
  oceanSurface?.dispose();
  oceanSurface = null;
  terrainRender?.dispose();
  terrainRender = null;
  weaponRender?.dispose();
  weaponRender = null;
  // 限制区由 Game 持有并在下一局初始化时销毁；这里只清掉虚线框引用，
  // 避免场景销毁后仍留下已释放的 LinesMesh。
  if (restrictAreas) {
    for (const area of restrictAreas) area.cancel();
    restrictAreas = null;
  }
  if (engine) {
    engine.dispose();
    engine = null;
  }
  scene = null;
}

export function initRender(canvas: HTMLCanvasElement, areas: readonly RestrictAreaImpl[], viewport: ViewportSize): Engine {
  disposeRender();
  const babylon = createBabylonScene({
    canvas,
    clearColor: [0.04, 0.17, 0.27, 1],
    width: viewport.width,
    height: viewport.height,
  });
  engine = babylon.engine;
  scene = babylon.scene;

  const selection = new ShipSelection();
  shipSelection = selection;

  // 相机视口按当前可用空间等比计算，初始对准地图中心
  resetCameraFocus();

  // 场景级指针状态机：选择 / 右键移动 / hover；只绑定一次，不随舰船数量增长
  unbindPointer = bindPointerInput(scene, selection, { onMove: moveSelection });

  shipHudLayer = createShipHudLayer(scene, viewport.width);
  createWater();
  createTerrain();

  // 限制区由 Game 按当前地图创建；渲染层只负责画框。
  // 先在画船前准备好，开局的越界检查才能读到同一批边界。
  restrictAreas = [...areas];
  for (const area of restrictAreas) area.draw(scene);

  weaponRender = createWeaponRender({
    scene,
    worldWidth: W,
    worldHeight: H,
    renderingGroupId: RG_FX,
  });
  particleFx = createParticleFx(scene, RG_FX);
  return engine;
}

/** 可用空间变化后同步相机、HUD、海面与 backbuffer；未初始化时只更新基准尺寸。 */
export function resizeRender(width: number, height: number): void {
  setCameraBaseSize(width, height);

  // 视口变化后把焦点重新夹回地图范围（地图视角边缘不会露出海面外）
  const focus = getCameraFocus();
  setCameraFocus(focus.x, focus.y);

  const camera = scene?.activeCamera as FreeCamera | null;
  if (camera) applyZoomToCamera(camera);

  shipHudLayer?.setViewportWidth(width);
  oceanSurface?.setViewHeight(getViewHeight());
  engine?.resize();
}

export function renderGame(game: GameState, dt = 1 / 60) {
  if (!scene) return;
  // 限制区虚线缓慢流动：只改顶点缓冲，不重建网格
  for (const area of restrictAreas ?? []) area.update(dt);
  // 大地图视口：跟随选中舰队或交战双方质心；minimap 跳转后短暂保持手动视角
  updateCameraFocus(scene, game.ships, shipSelection?.list ?? [], dt);
  // 相机轻微倾斜与摆动（可选，受 babylon/camera 模块开关控制）；放在焦点更新之后
  updateCameraEffect(scene.activeCamera as FreeCamera | null, game.time);
  // 海域以 src/expanse/ocean-state.ts 的状态为准，状态变化后自动切换
  const kind = getOceanKind();
  if (oceanSurface && oceanSurface.kind !== kind) oceanSurface.setKind(kind);
  oceanSurface?.refresh(game.time, H / 2 - getCameraFocus().y);
  syncShips(game);
  // 船尾迹：存活且航速超过门槛的船，每走 WAKE_EMIT_SPACING 世界单位才在船尾发一次粒子。
  // 沉船 / 停船后清掉记录，屏上残留粒子按各自生命自然淡出，稳定消失、无残留。
  for (const ship of game.ships) {
    if (!ship.alive) {
      wakeTrailPoints.delete(ship);
      continue;
    }
    const speed = Math.hypot(ship.vx, ship.vy);
    if (speed < WAKE_MIN_SPEED) {
      wakeTrailPoints.delete(ship);
      continue;
    }
    const last = wakeTrailPoints.get(ship);
    if (last && Math.hypot(ship.x - last.x, ship.y - last.y) < WAKE_EMIT_SPACING) continue;
    wakeTrailPoints.set(ship, { x: ship.x, y: ship.y });
    const tailX = ship.x - Math.cos(ship.angle) * (ship.len / 2 + WAKE_TAIL_OFFSET);
    const tailY = ship.y - Math.sin(ship.angle) * (ship.len / 2 + WAKE_TAIL_OFFSET);
    emitWake(tailX, tailY, ship.angle, speed);
  }
  weaponRender?.sync(game.projectiles);
  particleFx?.sync(dt);
  scene.render();
}
