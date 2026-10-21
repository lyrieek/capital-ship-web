// Babylon.js 渲染层：把 2D 海战状态同步到「正交俯视」场景
// 相机固定在 -Z 方向俯视 XY 平面，世界单位与游戏像素坐标一一对应。
// 后续还需优化 舰船/炮弹/粒子改为共享图集的 InstancedMesh/thin instance
import { Camera, Color3, Color4, DynamicTexture, Engine, FreeCamera, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { paintParticle, paintShip, paintShipHud, paintShell, paintTorpedo, toCanvas2D } from "./textures";
import { createOceanSurface, getOceanKind, type OceanSurface } from "../expanse";
import type { GameState, ParticleItem, Projectile } from "./types";
import type { Ship } from "./ship.d";
import { H, W } from "./utils";

// 平面 Mesh 类型（避免为仅作类型的 Mesh 引入额外 import）
type PlaneMesh = ReturnType<typeof MeshBuilder.CreatePlane>;

// 渲染分组（Babylon 最多 4 组 0..3），组间自动清深度，按组顺序层叠；
// 不能依赖 Z 距离排序：正交相机下远处水面到相机的距离反而更近，会盖住舰船。
const RG_WATER = 0;
const RG_SHIP = 1;
const RG_FX = 2;
const RG_OVERLAY = 3;

// 舰船贴图放大倍率（矢量绘制，放大后更清晰）
const SHIP_TEX_SCALE = 2;

// 单艘舰船的 HUD 贴图尺寸（世界单位 / 像素）
const HUD_W = 160;
const HUD_H = 56;

// 场景资源
let engine: Engine | null = null;
let scene: Scene | null = null;

let shellMaterial: StandardMaterial | null = null;
let torpMaterial: StandardMaterial | null = null;
let particleTexture: DynamicTexture | null = null;
// 海面（海浪贴图 + 材质 + 平面），具体绘制在 src/expanse/ocean.ts
let oceanSurface: OceanSurface | null = null;

// 每艘舰船对应的可视对象（reset 会重建舰船，故按对象身份做增删）
interface ShipVisual {
  mesh: PlaneMesh;
  material: StandardMaterial;
  texture: DynamicTexture;
  hud: PlaneMesh;
  hudMaterial: StandardMaterial;
  hudTexture: DynamicTexture;
  lastHp: number;
  lastState: Ship["state"];
  lastAlive: boolean;
}
const shipVisuals = new Map<Ship, ShipVisual>();

// 炮弹 / 粒子使用对象池复用 Mesh，避免频繁创建销毁
const projectilePool: PlaneMesh[] = [];
const particlePool: PlaneMesh[] = [];

// 游戏像素坐标 -> 场景坐标（游戏原点在左上、y 向下；场景居中、y 向上）
function worldToScene(x: number, y: number): Vector3 {
  return new Vector3(x - W / 2, H / 2 - y, 0);
}
// 通用的「自发光贴图」材质：忽略光照，颜色直接来自贴图，支持透明
function makeSpriteMaterial(name: string, texture: DynamicTexture): StandardMaterial {
  // DynamicTexture.hasAlpha 默认 false，必须显式开启，否则透明区域会被当成不透明（整屏 HUD 会变黑）
  texture.hasAlpha = true;
  const material = new StandardMaterial(name, scene!);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.emissiveColor = Color3.White();
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.useAlphaFromDiffuseTexture = true;
  material.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  return material;
}
// 创建指定渲染分组的平面（分组决定层叠顺序）
function createLayerPlane(name: string, width: number, height: number, group: number): PlaneMesh {
  const mesh = MeshBuilder.CreatePlane(name, { width, height }, scene!);
  mesh.renderingGroupId = group;
  mesh.isPickable = false;
  return mesh;
}
function createWater() {
  oceanSurface = createOceanSurface({
    scene: scene!,
    kind: getOceanKind(),
    worldWidth: W,
    worldHeight: H,
    textureWidth: 512,
    textureHeight: 288,
    renderingGroupId: RG_WATER,
  });
}

function createProjectileMaterials() {
  const shellTexture = new DynamicTexture("shellTexture", { width: 32, height: 32 }, scene!, true);
  paintShell(toCanvas2D(shellTexture), 32, 32);
  shellTexture.update();
  shellMaterial = makeSpriteMaterial("shellMaterial", shellTexture);

  const torpTexture = new DynamicTexture("torpTexture", { width: 48, height: 20 }, scene!, true);
  paintTorpedo(toCanvas2D(torpTexture), 48, 20);
  torpTexture.update();
  torpMaterial = makeSpriteMaterial("torpMaterial", torpTexture);
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

function createShipVisual(ship: Ship): ShipVisual {
  const texture = new DynamicTexture(
    `shipTexture_${ship.name}`,
    { width: ship.len * SHIP_TEX_SCALE, height: ship.wid * SHIP_TEX_SCALE },
    scene!,
    true,
  );
  paintShip(toCanvas2D(texture), ship, SHIP_TEX_SCALE);
  texture.update();

  const mesh = createLayerPlane(`ship_${ship.name}`, ship.len, ship.wid, RG_SHIP);
  const material = makeSpriteMaterial(`shipMaterial_${ship.name}`, texture);
  mesh.material = material;

  const shipHudTexture = new DynamicTexture(`shipHudTexture_${ship.name}`, { width: HUD_W, height: HUD_H }, scene!, true);
  const hud = createLayerPlane(`shipHud_${ship.name}`, HUD_W, HUD_H, RG_OVERLAY);
  const hudMaterial = makeSpriteMaterial(`shipHudMaterial_${ship.name}`, shipHudTexture);
  hud.material = hudMaterial;

  const visual: ShipVisual = {
    mesh,
    material,
    texture,
    hud,
    hudMaterial,
    hudTexture: shipHudTexture,
    lastHp: -1,
    lastState: "normal",
    lastAlive: true,
  };
  paintShipHud(toCanvas2D(shipHudTexture), ship, HUD_W, HUD_H);
  shipHudTexture.update();
  return visual;
}

function syncShips(game: GameState) {
  const seen = new Set<Ship>();
  for (const ship of game.ships) {
    seen.add(ship);
    let visual = shipVisuals.get(ship);
    if (!visual) {
      visual = createShipVisual(ship);
      shipVisuals.set(ship, visual);
    }

    const alive = ship.alive;
    visual.mesh.setEnabled(alive);
    visual.hud.setEnabled(alive);
    if (!alive) continue;

    visual.mesh.position.copyFrom(worldToScene(ship.x, ship.y));
    visual.mesh.rotation.z = -ship.angle;

    const flash = 1 + ship.hitFlash * 0.9;
    visual.material.emissiveColor.set(flash, flash, flash);

    visual.hud.position.copyFrom(worldToScene(ship.x, ship.y - (ship.wid / 2 + 20)));

    if (visual.lastHp !== ship.hp || visual.lastState !== ship.state || visual.lastAlive !== alive) {
      paintShipHud(toCanvas2D(visual.hudTexture), ship, HUD_W, HUD_H);
      visual.hudTexture.update();
      visual.lastHp = ship.hp;
      visual.lastState = ship.state;
      visual.lastAlive = alive;
    }
  }

  for (const [ship, visual] of shipVisuals) {
    if (seen.has(ship)) continue;
    visual.mesh.dispose();
    visual.hud.dispose();
    visual.texture.dispose();
    visual.hudTexture.dispose();
    shipVisuals.delete(ship);
  }
}

function createProjectileMesh(index: number): PlaneMesh {
  return createLayerPlane(`projectile_${index}`, 1, 1, RG_FX);
}

/**
 * 同步炮弹/鱼雷渲染状态
 * TODO: 画出炮弹/鱼雷的尾迹（原 Canvas 版本有拖尾线条）
 */
function syncProjectiles(projectiles: Projectile[]) {
  let index = 0;
  for (const projectile of projectiles) {
    const mesh = poolGet(projectilePool, index, createProjectileMesh);
    const torp = projectile.type === "torp";
    mesh.material = torp ? torpMaterial : shellMaterial;
    mesh.position.copyFrom(worldToScene(projectile.x, projectile.y));
    mesh.rotation.z = torp ? -Math.atan2(projectile.vy, projectile.vx) : 0;
    mesh.scaling.set(torp ? 22 : 18, torp ? 9 : 18, 1);
    mesh.setEnabled(true);
    index++;
  }
  for (; index < projectilePool.length; index++) projectilePool[index].setEnabled(false);
}

function createParticleMesh(index: number): PlaneMesh {
  const mesh = createLayerPlane(`particle_${index}`, 1, 1, RG_FX);
  mesh.material = makeSpriteMaterial(`particleMaterial_${index}`, particleTexture!);
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
  projectilePool.length = 0;
  particlePool.length = 0;
  shellMaterial = null;
  torpMaterial = null;
  particleTexture = null;
  oceanSurface?.dispose();
  oceanSurface = null;
  if (engine) {
    engine.dispose();
    engine = null;
  }
  scene = null;
}

export function initRender(canvas: HTMLCanvasElement): Engine {
  disposeRender();
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
  scene = new Scene(engine);
  scene.clearColor = new Color4(0.04, 0.17, 0.27, 1);

  const camera = new FreeCamera("camera", new Vector3(0, 0, -100), scene);
  camera.setTarget(Vector3.Zero());
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -W / 2;
  camera.orthoRight = W / 2;
  camera.orthoTop = H / 2;
  camera.orthoBottom = -H / 2;
  camera.minZ = 0.1;
  camera.maxZ = 1000;
  scene.activeCamera = camera;

  createWater();
  createProjectileMaterials();
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
  syncProjectiles(game.projectiles);
  syncParticles(game.particles);
  scene.render();
}
