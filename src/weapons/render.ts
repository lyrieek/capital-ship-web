// 武器渲染：弹药合批、弹道预览与尾迹
// 主场景和 playground 调试页共用同一套渲染实现。
import { Color3, Matrix, MeshBuilder, Quaternion, Vector3, type DynamicTexture, type Mesh, type Scene, type StandardMaterial } from "@babylonjs/core";
import { createCannonTexture } from "./cannon";
import { getWeaponSpec, type WeaponId } from "./spec";
import { createSpriteMaterial } from "./texture";
import { createTorpedoTexture } from "./torpedo";
import { sampleCurvePoints } from "./trajectory";
import type { Projectile, WeaponKind } from "./types";

type LinesMesh = ReturnType<typeof MeshBuilder.CreateLines>;

// 弹道预览的采样段数
const PATH_SAMPLES = 24;
// 尾迹保留的点数
const TRAIL_POINTS = 12;
// 每种武器至少预留的 thin instance 数量
const INITIAL_INSTANCE_CAPACITY = 64;

/** 武器渲染参数 */
export interface WeaponRenderOptions {
  /** Babylon 场景 */
  scene: Scene;
  /** 战场宽度（世界坐标） */
  worldWidth: number;
  /** 战场高度（世界坐标） */
  worldHeight: number;
  /** 渲染分组 */
  renderingGroupId?: number;
  /** 是否绘制曲射弹道预览 */
  showPaths?: boolean;
  /** 是否绘制尾迹 */
  showTrails?: boolean;
}

/** 武器渲染句柄 */
export interface WeaponRender {
  /** 同步所有弹药的可视状态 */
  sync(projectiles: Projectile[]): void;
  /** 开关弹道预览 */
  setShowPaths(visible: boolean): void;
  /** 开关尾迹 */
  setShowTrails(visible: boolean): void;
  /** 释放资源 */
  dispose(): void;
}

/** 渲染器内部使用的场景上下文 */
interface RenderContext {
  scene: Scene;
  worldWidth: number;
  worldHeight: number;
  renderingGroupId: number;
  /** 弹药所在层：比粒子更靠上，避免烟雾盖住弹体 */
  alphaIndex: number;
}

/** 一种武器的 thin instance 批次：一个 Mesh + 矩阵缓冲 + 逐实例颜色（用于淡出） */
interface ThinBatch {
  mesh: Mesh;
  buffer: Float32Array;
  /** 逐实例 RGBA：未命中淡出时同时压暗颜色和透明度 */
  colorBuffer: Float32Array;
  capacity: number;
}

// 世界坐标（原点左上、y 向下）-> 场景坐标（居中、y 向上）
function worldToScene(context: RenderContext, x: number, y: number): Vector3 {
  return new Vector3(x - context.worldWidth / 2, context.worldHeight / 2 - y, 0);
}

// 同步弹道预览线（整条贝塞尔曲线）
function syncPath(context: RenderContext, pool: LinesMesh[], projectile: Projectile, index: number): number {
  const points = sampleCurvePoints(projectile.arc.curve, PATH_SAMPLES).map((point) => worldToScene(context, point.x, point.y));
  const existing = pool[index];
  if (existing) {
    MeshBuilder.CreateLines(existing.name, { points, instance: existing });
  } else {
    const mesh = MeshBuilder.CreateLines(`weaponPath_${index}`, { points, updatable: true }, context.scene);
    mesh.color = Color3.FromHexString("#7cc4ff");
    mesh.alpha = 0.4;
    mesh.isPickable = false;
    mesh.renderingGroupId = context.renderingGroupId;
    pool[index] = mesh;
  }
  pool[index].setEnabled(true);
  // 未命中的鱼雷进入淡出时，弹道预览也一起变淡
  pool[index].alpha = 0.4 * (projectile.fade ?? 1);
  return index + 1;
}

// 尾迹线：点数必须恒定，否则 Babylon 无法用 instance 复用
function trailPoint(context: RenderContext, projectile: Projectile, index: number): Vector3 {
  const x = projectile.trail[index * 2] ?? projectile.x;
  const y = projectile.trail[index * 2 + 1] ?? projectile.y;
  return worldToScene(context, x, y);
}

function syncTrail(context: RenderContext, pool: LinesMesh[], projectile: Projectile, index: number): number {
  const available = Math.min(TRAIL_POINTS, Math.floor(projectile.trail.length / 2));
  const points: Vector3[] = [];
  for (let i = 0; i < TRAIL_POINTS - available; i++) points.push(trailPoint(context, projectile, 0));
  for (let i = 0; i < available; i++) points.push(trailPoint(context, projectile, i));
  const existing = pool[index];
  if (existing) {
    MeshBuilder.CreateLines(existing.name, { points, instance: existing });
  } else {
    const mesh = MeshBuilder.CreateLines(`weaponTrail_${index}`, { points, updatable: true }, context.scene);
    mesh.color = Color3.FromHexString("#ffd166");
    mesh.alpha = 0.5;
    mesh.isPickable = false;
    mesh.renderingGroupId = context.renderingGroupId;
    pool[index] = mesh;
  }
  pool[index].setEnabled(true);
  // 尾迹跟着弹体一起淡出，避免鱼雷消失后还留着一条亮线
  pool[index].alpha = 0.5 * (projectile.fade ?? 1);
  return index + 1;
}

/**
 * 创建武器渲染器
 */
export function createWeaponRender(options: WeaponRenderOptions): WeaponRender {
  const context: RenderContext = {
    scene: options.scene,
    worldWidth: options.worldWidth,
    worldHeight: options.worldHeight,
    renderingGroupId: options.renderingGroupId ?? 0,
    alphaIndex: 1,
  };
  let showPaths = options.showPaths ?? false;
  let showTrails = options.showTrails ?? false;

  const materials = new Map<WeaponKind, StandardMaterial>();
  const textures: DynamicTexture[] = [];
  // 每种武器一个 thin instance 批次，弹量再多也只是一次 draw call
  const batches = new Map<WeaponId, ThinBatch>();
  const pathPool: LinesMesh[] = [];
  const trailPool: LinesMesh[] = [];

  // 合批时复用的临时对象，避免每发弹药分配 Matrix / Vector3
  const tmpPosition = new Vector3();
  const tmpScale = new Vector3();
  const tmpRotation = new Quaternion();
  const tmpMatrix = new Matrix();

  function getMaterial(id: WeaponId): StandardMaterial {
    // 贴图与材质按武器大类共享：以后同大类新增型号可以直接复用
    const kind = getWeaponSpec(id).kind;
    const existing = materials.get(kind);
    if (existing) return existing;
    const texture = kind === "torpedo" ? createTorpedoTexture(context.scene) : createCannonTexture(context.scene);
    textures.push(texture);
    const material = createSpriteMaterial(`${kind}Material`, texture, context.scene);
    materials.set(kind, material);
    return material;
  }

  function createBatch(id: WeaponId, capacity: number): ThinBatch {
    const mesh = MeshBuilder.CreatePlane(`weaponBatch_${id}`, { width: 1, height: 1 }, context.scene);
    mesh.material = getMaterial(id);
    mesh.renderingGroupId = context.renderingGroupId;
    mesh.isPickable = false;
    // 弹药位置每帧变化，关闭视锥裁剪，避免整批被包围盒剔掉
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.alphaIndex = context.alphaIndex;

    const buffer = new Float32Array(capacity * 16);
    mesh.thinInstanceSetBuffer("matrix", buffer, 16, false);
    // 未命中的鱼雷通过逐实例颜色淡出：RGB 压暗、A 降低透明度
    const colorBuffer = new Float32Array(capacity * 4);
    colorBuffer.fill(1);
    mesh.thinInstanceSetBuffer("instanceColor", colorBuffer, 4, false);
    mesh.thinInstanceCount = 0;

    const batch: ThinBatch = { mesh, buffer, colorBuffer, capacity };
    batches.set(id, batch);
    return batch;
  }

  function ensureBatch(id: WeaponId, needed: number): ThinBatch {
    const existing = batches.get(id);
    if (!existing) return createBatch(id, Math.max(INITIAL_INSTANCE_CAPACITY, needed));
    if (needed <= existing.capacity) return existing;

    // 弹量超过当前容量：换一段更大的矩阵 / 颜色缓冲
    const capacity = Math.max(needed, existing.capacity * 2);
    const buffer = new Float32Array(capacity * 16);
    existing.mesh.thinInstanceSetBuffer("matrix", buffer, 16, false);
    const colorBuffer = new Float32Array(capacity * 4);
    colorBuffer.fill(1);
    existing.mesh.thinInstanceSetBuffer("instanceColor", colorBuffer, 4, false);
    existing.buffer = buffer;
    existing.colorBuffer = colorBuffer;
    existing.capacity = capacity;
    return existing;
  }

  function writeProjectile(batch: ThinBatch, index: number, projectile: Projectile): void {
    const spec = getWeaponSpec(projectile.type);
    tmpPosition.set(projectile.x - context.worldWidth / 2, context.worldHeight / 2 - projectile.y, 0);
    tmpScale.set(spec.spriteWidth, spec.spriteHeight, 1);
    // 与旧版 mesh.rotation.z 完全等价：只绕 Z 滚转
    const angle = -Math.atan2(projectile.vy, projectile.vx);
    Quaternion.RotationYawPitchRollToRef(0, 0, angle, tmpRotation);
    Matrix.ComposeToRef(tmpScale, tmpRotation, tmpPosition, tmpMatrix);
    tmpMatrix.copyToArray(batch.buffer, index * 16);

    // fade 为 undefined 时完全可见；淡出中同时压暗 RGB 和降低 alpha
    const fade = projectile.fade ?? 1;
    const colorOffset = index * 4;
    batch.colorBuffer[colorOffset] = fade;
    batch.colorBuffer[colorOffset + 1] = fade;
    batch.colorBuffer[colorOffset + 2] = fade;
    batch.colorBuffer[colorOffset + 3] = fade;
  }

  function sync(projectiles: Projectile[]): void {
    // 不写死具体型号：新增型号时这里会自动按 projectile.type 建批次
    const counts = new Map<WeaponId, number>();
    for (const projectile of projectiles) counts.set(projectile.type, (counts.get(projectile.type) ?? 0) + 1);

    for (const [id, count] of counts) ensureBatch(id, count);

    const cursor = new Map<WeaponId, number>();
    let pathIndex = 0;
    let trailIndex = 0;

    for (const projectile of projectiles) {
      const batch = batches.get(projectile.type);
      const index = cursor.get(projectile.type) ?? 0;
      if (batch) writeProjectile(batch, index, projectile);
      cursor.set(projectile.type, index + 1);

      if (showPaths) pathIndex = syncPath(context, pathPool, projectile, pathIndex);
      if (showTrails) trailIndex = syncTrail(context, trailPool, projectile, trailIndex);
    }

    for (const [id, batch] of batches) {
      const count = counts.get(id) ?? 0;
      batch.mesh.thinInstanceCount = count;
      if (count > 0) {
        batch.mesh.thinInstanceBufferUpdated("matrix");
        batch.mesh.thinInstanceBufferUpdated("instanceColor");
      }
    }

    for (; pathIndex < pathPool.length; pathIndex++) pathPool[pathIndex].setEnabled(false);
    for (; trailIndex < trailPool.length; trailIndex++) trailPool[trailIndex].setEnabled(false);
  }

  function dispose(): void {
    for (const batch of batches.values()) batch.mesh.dispose();
    batches.clear();
    for (const mesh of pathPool) mesh.dispose();
    for (const mesh of trailPool) mesh.dispose();
    pathPool.length = 0;
    trailPool.length = 0;
    for (const material of materials.values()) material.dispose();
    for (const texture of textures) texture.dispose();
    materials.clear();
    textures.length = 0;
  }

  return {
    sync,
    setShowPaths(visible: boolean) {
      showPaths = visible;
    },
    setShowTrails(visible: boolean) {
      showTrails = visible;
    },
    dispose,
  };
}
