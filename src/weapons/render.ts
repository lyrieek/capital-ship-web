// 武器渲染：弹药贴图、Mesh 池、弹道预览与尾迹
// 主场景和 playground 调试页共用同一套渲染实现。
import { Color3, MeshBuilder, Vector3, type DynamicTexture, type Scene, type StandardMaterial } from "@babylonjs/core";
import { createCannonTexture } from "./cannon";
import { getWeaponSpec, type WeaponId } from "./spec";
import { createSpriteMaterial } from "./texture";
import { createTorpedoTexture } from "./torpedo";
import { sampleCurvePoints } from "./trajectory";
import type { Projectile } from "./types";

// 平面 Mesh 类型（避免为仅作类型的 Mesh 引入额外 import）
type PlaneMesh = ReturnType<typeof MeshBuilder.CreatePlane>;
type LinesMesh = ReturnType<typeof MeshBuilder.CreateLines>;

// 弹道预览的采样段数
const PATH_SAMPLES = 24;
// 尾迹保留的点数
const TRAIL_POINTS = 12;

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
  };
  let showPaths = options.showPaths ?? false;
  let showTrails = options.showTrails ?? false;

  const materials = new Map<WeaponId, StandardMaterial>();
  const textures: DynamicTexture[] = [];
  const projectilePool: PlaneMesh[] = [];
  const pathPool: LinesMesh[] = [];
  const trailPool: LinesMesh[] = [];

  function getMaterial(id: WeaponId): StandardMaterial {
    const existing = materials.get(id);
    if (existing) return existing;
    const texture = id === "shell" ? createCannonTexture(context.scene) : createTorpedoTexture(context.scene);
    textures.push(texture);
    const material = createSpriteMaterial(`${id}Material`, texture, context.scene);
    materials.set(id, material);
    return material;
  }

  function createProjectileMesh(index: number): PlaneMesh {
    const mesh = MeshBuilder.CreatePlane(`weapon_${index}`, { width: 1, height: 1 }, context.scene);
    mesh.renderingGroupId = context.renderingGroupId;
    mesh.isPickable = false;
    return mesh;
  }

  function poolGet(pool: PlaneMesh[], index: number, create: (index: number) => PlaneMesh): PlaneMesh {
    const existing = pool[index];
    if (existing) return existing;
    const created = create(index);
    pool[index] = created;
    return created;
  }

  function sync(projectiles: Projectile[]): void {
    let index = 0;
    let pathIndex = 0;
    let trailIndex = 0;

    for (const projectile of projectiles) {
      const spec = getWeaponSpec(projectile.type);
      const mesh = poolGet(projectilePool, index, createProjectileMesh);
      mesh.material = getMaterial(projectile.type);
      mesh.position.copyFrom(worldToScene(context, projectile.x, projectile.y));
      mesh.rotation.z = -Math.atan2(projectile.vy, projectile.vx);
      mesh.scaling.set(spec.spriteWidth, spec.spriteHeight, 1);
      mesh.setEnabled(true);
      index += 1;

      if (showPaths) pathIndex = syncPath(context, pathPool, projectile, pathIndex);
      if (showTrails) trailIndex = syncTrail(context, trailPool, projectile, trailIndex);
    }

    for (; index < projectilePool.length; index++) projectilePool[index].setEnabled(false);
    for (; pathIndex < pathPool.length; pathIndex++) pathPool[pathIndex].setEnabled(false);
    for (; trailIndex < trailPool.length; trailIndex++) trailPool[trailIndex].setEnabled(false);
  }

  function dispose(): void {
    for (const mesh of projectilePool) mesh.dispose();
    for (const mesh of pathPool) mesh.dispose();
    for (const mesh of trailPool) mesh.dispose();
    projectilePool.length = 0;
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
