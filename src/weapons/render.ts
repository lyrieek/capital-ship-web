// 武器渲染：弹药合批、弹道预览与尾迹
// 主场景和 playground 调试页共用同一套渲染实现。
import { Color3, Matrix, MeshBuilder, Quaternion, Vector3, type DynamicTexture, type Mesh, type Scene, type StandardMaterial } from "@babylonjs/core";
import { createCannonTexture } from "./cannon";
import { getWeaponSpec, type WeaponId } from "./spec";
import { createSpriteMaterial } from "./texture";
import { createTorpedoTexture } from "./torpedo";
import { sampleCurvePoints } from "./trajectory";
import type { Projectile } from "./types";

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

/** 一种武器的 thin instance 批次：一个 Mesh + 一段矩阵缓冲 */
interface ThinBatch {
  mesh: Mesh;
  buffer: Float32Array;
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

  const materials = new Map<WeaponId, StandardMaterial>();
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
    const existing = materials.get(id);
    if (existing) return existing;
    const texture = id === "shell" ? createCannonTexture(context.scene) : createTorpedoTexture(context.scene);
    textures.push(texture);
    const material = createSpriteMaterial(`${id}Material`, texture, context.scene);
    materials.set(id, material);
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
    mesh.thinInstanceCount = 0;

    const batch: ThinBatch = { mesh, buffer, capacity };
    batches.set(id, batch);
    return batch;
  }

  function ensureBatch(id: WeaponId, needed: number): ThinBatch {
    const existing = batches.get(id);
    if (!existing) return createBatch(id, Math.max(INITIAL_INSTANCE_CAPACITY, needed));
    if (needed <= existing.capacity) return existing;

    // 弹量超过当前容量：换一段更大的矩阵缓冲
    const capacity = Math.max(needed, existing.capacity * 2);
    const buffer = new Float32Array(capacity * 16);
    existing.mesh.thinInstanceSetBuffer("matrix", buffer, 16, false);
    existing.buffer = buffer;
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
  }

  function sync(projectiles: Projectile[]): void {
    const counts: Record<WeaponId, number> = { shell: 0, torp: 0 };
    for (const projectile of projectiles) counts[projectile.type] += 1;

    if (counts.shell > 0) ensureBatch("shell", counts.shell);
    if (counts.torp > 0) ensureBatch("torp", counts.torp);

    const cursor: Record<WeaponId, number> = { shell: 0, torp: 0 };
    let pathIndex = 0;
    let trailIndex = 0;

    for (const projectile of projectiles) {
      const batch = batches.get(projectile.type);
      if (batch) writeProjectile(batch, cursor[projectile.type]++, projectile);

      if (showPaths) pathIndex = syncPath(context, pathPool, projectile, pathIndex);
      if (showTrails) trailIndex = syncTrail(context, trailPool, projectile, trailIndex);
    }

    for (const [id, batch] of batches) {
      const count = counts[id];
      batch.mesh.thinInstanceCount = count;
      if (count > 0) batch.mesh.thinInstanceBufferUpdated("matrix");
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
