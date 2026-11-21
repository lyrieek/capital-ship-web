// Babylon.js 渲染层：把 2D 海战状态同步到「正交俯视」场景
// 相机固定在 -Z 方向俯视 XY 平面，世界单位与游戏像素坐标一一对应。
// 后续还需优化 舰船/炮弹/粒子改为共享图集的 InstancedMesh/thin instance
import { Color3, DynamicTexture, type Engine, type FreeCamera, type Mesh, type Scene, type StandardMaterial, Vector3 } from "@babylonjs/core";
import { paintParticle, paintShip } from "./textures";
import { createOceanSurface, getOceanKind, type OceanSurface } from "../expanse";
import { createWeaponRender, type WeaponRender } from "../weapons";
import { createTerrainRender, getTerrainField, type TerrainRender } from "../terrain";
import type { GameState, ParticleItem } from "./types";
import type { Ship } from "../ship/ship";
import { H, W } from "./utils";
import { VIEW_H, VIEW_W } from "./world";
import { getCameraFocus, resetCameraFocus, updateCameraFocus } from "./camera-focus";
import { bindOceanSelection, bindShipSelection, ShipSelection } from "./selection";
import { issueSelectionSail } from "./movement";
import { RestrictArea, getTeamRestrictBounds } from "./RestrictArea";
import { createBabylonScene, createPlane, createSpriteMaterial, toCanvas2D, updateCameraEffect, worldToScene } from "../babylon";
import { createShipHudLayer, type ShipHudLayer } from "../ship/hud";
import {
  createShipVisual,
  disposeNavLine,
  type ShipVisual,
  SHIP_Z,
  RING_Z,
  SHIP_TEX_SCALE,
  RG_SHIP,
  updateShipNavigationLine,
} from "../ship/render-visual";

// 平面 Mesh 类型（避免为仅作类型的 Mesh 引入额外 import）
type PlaneMesh = Mesh;

// 渲染分组（Babylon 最多 4 组 0..3），组间自动清深度，按组顺序层叠；
// 不能依赖 Z 距离排序：正交相机下远处水面到相机的距离反而更近，会盖住舰船。
const RG_WATER = 0;
const RG_FX = 2;

// 场景资源
let engine: Engine | null = null;
let scene: Scene | null = null;

let particleTexture: DynamicTexture | null = null;
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

export function getShipSelection(): ShipSelection | null {
  return shipSelection;
}

// 右键：让当前选中的舰船驶向落点
function moveSelection(x: number, y: number): void {
  if (shipSelection) issueSelectionSail(shipSelection.list, x, y);
}

// 每艘舰船对应的可视对象（reset 会重建舰船，故按对象身份做增删）
const shipVisuals = new Map<Ship, ShipVisual>();
// 行动限制区域：按阵营分别定义，在画船前验证位置并画虚线框
let restrictAreas: RestrictArea[] | null = null;
// 限制区验证错误信息（由 BattleCanvas 读取并弹 modal）
let restrictError: string | null = null;

export function getRestrictError(): string | null {
  return restrictError;
}

// 炮管转动 / 舰体转向需要重绘舰船贴图；变化太小时跳过，避免每帧都重绘
const REPAINT_STEP = 0.02;
function angleMoved(current: number, last: number): boolean {
  return Math.abs(Math.atan2(Math.sin(current - last), Math.cos(current - last))) > REPAINT_STEP;
}
function turretNeedsRepaint(ship: Ship, visual: ShipVisual): boolean {
  return angleMoved(ship.aimAngle, visual.lastAim) || angleMoved(ship.angle, visual.lastAngle);
}

// 粒子使用对象池复用 Mesh，避免频繁创建销毁
const particlePool: PlaneMesh[] = [];

function createWater() {
  oceanSurface = createOceanSurface({
    scene: scene!,
    kind: getOceanKind(),
    worldWidth: W,
    worldHeight: H,
    viewHeight: VIEW_H,
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

function createParticleResources() {
  particleTexture = new DynamicTexture("particleTexture", { width: 32, height: 32 }, scene!, true);
  paintParticle(toCanvas2D(particleTexture), 32, 32);
  particleTexture.update();
}

function poolGet(pool: PlaneMesh[], index: number, create: (index: number) => PlaneMesh): PlaneMesh {
  const existing = pool[index];
  if (existing) return existing;
  const created = create(index);
  pool[index] = created;
  return created;
}

// 舰船 vs 地物的碰撞：用 Babylon 内置碰撞系统（scene.collisionsEnabled + mesh.checkCollisions
// + mesh.ellipsoid + mesh.moveWithCollisions），不是物理引擎，也不用手搓圆碰撞。
//
// 为什么放在渲染层：moveWithCollisions 直接操作 Mesh，而 ship.x/y 才是权威数据。
// 所以这里做的是「游戏状态 → 本帧位移 → Babylon 修正 mesh → 修正结果写回 ship.x/y」。
//
// 必须在 syncShips 之前调用：syncShips 会把 mesh 位置重置成 ship.x/y，
// 那时 mesh 已经和目标位置重合，moveWithCollisions 的位移恒为 0，等于没做碰撞。
function resolveTerrainCollisions(game: GameState): void {
  for (const ship of game.ships) {
    if (!ship.alive) continue;
    const visual = shipVisuals.get(ship);
    // 刚生成、还没有可视对象的舰船不参与：它的 mesh 位置是这一帧才同步的
    if (!visual) continue;

    // 上一帧同步之后，mesh 位置 == 舰船上一帧的位置，所以差值就是本帧位移
    const meshWorldX = visual.mesh.position.x + W / 2;
    const meshWorldY = H / 2 - visual.mesh.position.y;
    const dx = ship.x - meshWorldX;
    const dy = ship.y - meshWorldY;
    if (dx === 0 && dy === 0) continue;

    // 碰撞是基于 mesh 世界矩阵做扫掠的，矩阵必须是最新的
    visual.mesh.computeWorldMatrix(true);
    // 场景坐标 Y 轴方向与游戏坐标相反
    visual.mesh.moveWithCollisions(new Vector3(dx, -dy, 0));

    // 修正结果写回游戏状态：本帧后续的索敌、开火、小地图都读 ship.x/y
    ship.x = visual.mesh.position.x + W / 2;
    ship.y = H / 2 - visual.mesh.position.y;
  }
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
      // 然后将限制区边界应用到船上（供碰撞 clamp 使用）
      const area = restrictAreas?.find((a) => a.team === ship.team);
      const err = area?.validate(ship);
      if (err) {
        restrictError = err;
        continue;
      }
      area?.applyTo(ship);

      visual = createShipVisual(ship, scene!, hudLayer, 1);
      if (shipSelection) bindShipSelection(scene!, visual.mesh, ship, shipSelection, { onMove: moveSelection });
      shipVisuals.set(ship, visual);
    }

    const alive = ship.alive;
    const selected = shipSelection?.has(ship) ?? false;
    visual.mesh.setEnabled(alive);
    visual.hud.setVisible(alive);
    visual.ring.mesh.setEnabled(alive && selected);
    if (!alive) continue;

    // 航行导航虚线：仅选中且有航行目标时显示，每帧重新计算不残留旧点
    if (selected) {
      updateShipNavigationLine(visual, ship, scene!);
    } else {
      disposeNavLine(visual);
    }

    visual.mesh.position.copyFrom(worldToScene(ship.x, ship.y, SHIP_Z));
    visual.mesh.rotation.z = -ship.angle;
    visual.ring.mesh.position.copyFrom(worldToScene(ship.x, ship.y, RING_Z));

    const flash = 1 + ship.hitFlash * 0.9;
    visual.material.emissiveColor.set(flash, flash, flash);

    if (
      visual.lastHp !== ship.hp ||
      visual.lastState !== ship.state ||
      visual.lastAlive !== alive ||
      visual.lastRecoil !== ship.recoil ||
      turretNeedsRepaint(ship, visual)
    ) {
      paintShip(toCanvas2D(visual.texture), ship, SHIP_TEX_SCALE * visual.shipSize);
      visual.texture.update();
      visual.lastHp = ship.hp;
      visual.lastState = ship.state;
      visual.lastAlive = alive;
      visual.lastRecoil = ship.recoil;
      visual.lastAim = ship.aimAngle;
      visual.lastAngle = ship.angle;
    }

    visual.hud.sync(ship);
  }

  for (const [ship, visual] of shipVisuals) {
    if (seen.has(ship)) continue;
    visual.mesh.dispose();
    visual.hud.dispose();
    visual.ring.dispose();
    visual.texture.dispose();
    disposeNavLine(visual);
    visual.lineMaterial.dispose();
    shipVisuals.delete(ship);
  }
}

function createParticleMesh(index: number): PlaneMesh {
  const mesh = createPlane(`particle_${index}`, 1, 1, scene!, RG_FX);
  mesh.material = createSpriteMaterial(`particleMaterial_${index}`, particleTexture!, scene!);
  return mesh;
}

function syncParticles(particles: ParticleItem[]) {
  let index = 0;
  for (const particle of particles) {
    const mesh = poolGet(particlePool, index, createParticleMesh);
    const life = Math.max(0, particle.life / particle.maxLife);
    const material = mesh.material as StandardMaterial;
    material.emissiveColor = Color3.FromHexString(particle.color);
    material.alpha = life;
    mesh.position.copyFrom(worldToScene(particle.x, particle.y));
    mesh.scaling.copyFromFloats(particle.size * 2 * life, particle.size * 2 * life, 1);
    mesh.setEnabled(true);
    index++;
  }
  for (; index < particlePool.length; index++) particlePool[index].setEnabled(false);
}

export function disposeRender() {
  restrictError = null;
  shipVisuals.clear();
  shipSelection = null;
  particlePool.length = 0;
  particleTexture = null;
  shipHudLayer?.dispose();
  shipHudLayer = null;
  oceanSurface?.dispose();
  oceanSurface = null;
  terrainRender?.dispose();
  terrainRender = null;
  weaponRender?.dispose();
  weaponRender = null;
  if (restrictAreas) {
    for (const area of restrictAreas) area.dispose();
    restrictAreas = null;
  }
  if (engine) {
    engine.dispose();
    engine = null;
  }
  scene = null;
}

export function initRender(canvas: HTMLCanvasElement): Engine {
  disposeRender();
  const babylon = createBabylonScene({
    canvas,
    clearColor: [0.04, 0.17, 0.27, 1],
    width: VIEW_W,
    height: VIEW_H,
  });
  engine = babylon.engine;
  scene = babylon.scene;

  const selection = new ShipSelection();
  shipSelection = selection;

  // 相机视口仍是 1600 x 900，初始对准地图中心
  resetCameraFocus();

  shipHudLayer = createShipHudLayer(scene, VIEW_W);
  createWater();
  createTerrain();
  if (oceanSurface) bindOceanSelection(scene, oceanSurface.mesh, selection, { onMove: moveSelection });

  // 先定义地图行动限制区（按阵营），再画船；限制区虚线框在此一次性画出。
  // 限制区默认会避开地物：摆船时船不会落在岛上。
  restrictAreas = [new RestrictArea(getTeamRestrictBounds("red"), "red", true), new RestrictArea(getTeamRestrictBounds("blue"), "blue", true)];
  for (const area of restrictAreas) area.draw(scene);

  weaponRender = createWeaponRender({
    scene,
    worldWidth: W,
    worldHeight: H,
    renderingGroupId: RG_FX,
  });
  createParticleResources();
  return engine;
}

export function renderGame(game: GameState, dt = 1 / 60) {
  if (!scene) return;
  // 大地图视口：跟随选中舰队或交战双方质心；minimap 跳转后短暂保持手动视角
  updateCameraFocus(scene, game.ships, shipSelection?.list ?? [], dt);
  // 相机轻微倾斜与摆动（可选，受 babylon/camera 模块开关控制）；放在焦点更新之后
  updateCameraEffect(scene.activeCamera as FreeCamera | null, game.time);
  // 海域以 src/expanse/ocean-state.ts 的状态为准，状态变化后自动切换
  const kind = getOceanKind();
  if (oceanSurface && oceanSurface.kind !== kind) oceanSurface.setKind(kind);
  oceanSurface?.refresh(game.time, H / 2 - getCameraFocus().y);
  // 舰船与岛礁的碰撞（Babylon 内置），必须在同步网格之前做，见函数注释
  resolveTerrainCollisions(game);
  syncShips(game);
  weaponRender?.sync(game.projectiles);
  syncParticles(game.particles);
  scene.render();
}
