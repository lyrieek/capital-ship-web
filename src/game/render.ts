// Babylon.js 渲染层：把 2D 海战状态同步到「正交俯视」场景
// 相机固定在 -Z 方向俯视 XY 平面，世界单位与游戏像素坐标一一对应。
// 后续还需优化 舰船/炮弹/粒子改为共享图集的 InstancedMesh/thin instance
import { Color3, DynamicTexture, Vector3, type Engine, type Mesh, type Scene, type StandardMaterial } from "@babylonjs/core";
import { paintParticle, paintShip, paintShipHud } from "./textures";
import { createOceanSurface, getOceanKind, type OceanSurface } from "../expanse";
import { createWeaponRender, type WeaponRender } from "../weapons";
import type { GameState, ParticleItem } from "./types";
import type { Ship } from "../ship/ship";
import { H, W } from "./utils";
import { bindOceanSelection, bindShipSelection, ShipSelection } from "./selection";
import { issueSelectionSail } from "./movement";
import { createBabylonScene, createPlane, createSpriteMaterial, toCanvas2D, worldToScene } from "../babylon";
import { createShipVisual, type ShipVisual, SHIP_Z, HUD_Z, RING_Z, SHIP_TEX_SCALE, HUD_W, HUD_H } from "../ship/render-visual";

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

// 粒子使用对象池复用 Mesh，避免频繁创建销毁
const particlePool: PlaneMesh[] = [];

function createWater() {
  oceanSurface = createOceanSurface({
    scene: scene!,
    kind: getOceanKind(),
    worldWidth: W,
    worldHeight: H,
    segmentsX: 200,
    segmentsY: 112,
    renderingGroupId: RG_WATER,
  });
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

function syncShips(game: GameState) {
  // 死亡或重开后被替换的舰船不再保留在选择列表里
  shipSelection?.retain(game.ships);

  const seen = new Set<Ship>();
  for (const ship of game.ships) {
    seen.add(ship);
    let visual = shipVisuals.get(ship);
    if (!visual) {
      visual = createShipVisual(ship, scene!, 1);
      if (shipSelection) bindShipSelection(scene!, visual.mesh, ship, shipSelection, { onMove: moveSelection });
      shipVisuals.set(ship, visual);
    }

    const alive = ship.alive;
    visual.mesh.setEnabled(alive);
    visual.hud.setEnabled(alive);
    visual.ring.mesh.setEnabled(alive && (shipSelection?.has(ship) ?? false));
    if (!alive) continue;

    visual.mesh.position.copyFrom(worldToScene(ship.x, ship.y, SHIP_Z));
    visual.mesh.rotation.z = -ship.angle;

    // 后坐力：开火时舰体沿反航向方向微向后踢
    const kick = ship.recoil * 10;
    visual.mesh.position.addInPlace(new Vector3(-Math.cos(ship.angle) * kick, -Math.sin(ship.angle) * kick, 0));
    visual.ring.mesh.position.copyFrom(worldToScene(ship.x, ship.y, RING_Z));

    const flash = 1 + ship.hitFlash * 0.9;
    visual.material.emissiveColor.set(flash, flash, flash);

    visual.hud.position.copyFrom(worldToScene(ship.x, ship.y - (ship.wid / 2 + 20) * visual.shipSize, HUD_Z));

    if (visual.lastHp !== ship.hp || visual.lastState !== ship.state || visual.lastAlive !== alive || visual.lastRecoil !== ship.recoil) {
      const hudWidth = HUD_W * visual.shipSize;
      const hudHeight = HUD_H * visual.shipSize;
      paintShip(toCanvas2D(visual.texture), ship, SHIP_TEX_SCALE * visual.shipSize);
      visual.texture.update();
      paintShipHud(toCanvas2D(visual.hudTexture), ship, hudWidth, hudHeight);
      visual.hudTexture.update();
      visual.lastHp = ship.hp;
      visual.lastState = ship.state;
      visual.lastAlive = alive;
      visual.lastRecoil = ship.recoil;
    }
  }

  for (const [ship, visual] of shipVisuals) {
    if (seen.has(ship)) continue;
    visual.mesh.dispose();
    visual.hud.dispose();
    visual.ring.dispose();
    visual.texture.dispose();
    visual.hudTexture.dispose();
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
  shipVisuals.clear();
  shipSelection = null;
  particlePool.length = 0;
  particleTexture = null;
  oceanSurface?.dispose();
  oceanSurface = null;
  weaponRender?.dispose();
  weaponRender = null;
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
    width: W,
    height: H,
  });
  engine = babylon.engine;
  scene = babylon.scene;

  const selection = new ShipSelection();
  shipSelection = selection;

  createWater();
  if (oceanSurface) bindOceanSelection(scene, oceanSurface.mesh, selection, { onMove: moveSelection });

  weaponRender = createWeaponRender({
    scene,
    worldWidth: W,
    worldHeight: H,
    renderingGroupId: RG_FX,
  });
  createParticleResources();
  return engine;
}

export function renderGame(game: GameState) {
  if (!scene) return;
  // 海域以 src/expanse/ocean-state.ts 的状态为准，状态变化后自动切换
  const kind = getOceanKind();
  if (oceanSurface && oceanSurface.kind !== kind) oceanSurface.setKind(kind);
  oceanSurface?.refresh(game.time);
  syncShips(game);
  weaponRender?.sync(game.projectiles);
  syncParticles(game.particles);
  scene.render();
}
