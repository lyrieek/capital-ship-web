// 地物渲染：把 TerrainItem 列表同步成 Babylon 网格。
// 地物是静态的，正常只在初始化时 sync 一次；保留 sync 是为了以后支持「战斗中被击毁 / 动态生成」。
import type { Mesh, Scene, StandardMaterial } from "@babylonjs/core";
import { worldToScene } from "../babylon";
import { createIslandMaterial, createIslandMesh } from "./island";
import { createReefMaterial, createReefMesh } from "./reef";
import { createShipyardMaterial, createShipyardMesh } from "./shipyard";
import { getTerrainSpec, type TerrainSpec } from "./spec";
import type { TerrainItem, TerrainKind } from "./types";

/** 地物 Z 值：与海面同高，靠渲染分组压在海面之上 */
export const TERRAIN_Z = 0;
/** 地物渲染分组：必须与舰船同组（RG_SHIP = 1），否则会被海面（组 0）盖住 */
export const TERRAIN_RENDERING_GROUP = 1;

/** 单个地物的网格 / 材质工厂 */
interface TerrainFactory {
  createMesh(name: string, scene: Scene, spec: TerrainSpec, item: TerrainItem): Mesh;
  createMaterial(name: string, scene: Scene): StandardMaterial;
}

// 类型 → 工厂。新增地物类型时只改这里、spec 表和对应文件
const FACTORIES: Record<TerrainKind, TerrainFactory> = {
  island: { createMesh: createIslandMesh, createMaterial: createIslandMaterial },
  reef: { createMesh: createReefMesh, createMaterial: createReefMaterial },
  shipyard: { createMesh: createShipyardMesh, createMaterial: createShipyardMaterial },
};

/** 地物渲染参数 */
export interface TerrainRenderOptions {
  /** Babylon 场景 */
  scene: Scene;
  /** 渲染分组，缺省 TERRAIN_RENDERING_GROUP */
  renderingGroupId?: number;
  /** 场景 Z 值，缺省 TERRAIN_Z */
  z?: number;
}

/** 地物渲染句柄 */
export interface TerrainRender {
  /** 按数据创建 / 更新 / 移除可视对象 */
  sync(items: readonly TerrainItem[]): void;
  /** 释放全部资源 */
  dispose(): void;
}

/** 创建地物渲染器 */
export function createTerrainRender(options: TerrainRenderOptions): TerrainRender {
  const { scene } = options;
  const renderingGroupId = options.renderingGroupId ?? TERRAIN_RENDERING_GROUP;
  const z = options.z ?? TERRAIN_Z;

  // 碰撞不在这里：地物只负责画，舰船 vs 地形的判定在 game/collision.ts。
  // 每个地物一个 Mesh：key 为 item.id，sync 时按 id 增删
  const meshes = new Map<string, Mesh>();
  // 材质按类型缓存：同类型地物共用一份，几何形状差异靠 seed 体现在网格上
  const materials = new Map<TerrainKind, StandardMaterial>();

  function getMaterial(kind: TerrainKind): StandardMaterial {
    const existing = materials.get(kind);
    if (existing) return existing;
    const material = FACTORIES[kind].createMaterial(`terrainMaterial_${kind}`, scene);
    // 地物材质是静态的：冻结后跳过每帧的 effect/define 检查
    material.freeze();
    materials.set(kind, material);
    return material;
  }

  function createMesh(item: TerrainItem): Mesh {
    const spec = getTerrainSpec(item.kind);
    const mesh = FACTORIES[item.kind].createMesh(`terrain_${item.id}`, scene, spec, item);
    mesh.material = getMaterial(item.kind);
    mesh.renderingGroupId = renderingGroupId;
    // TODO: 地物是否参与拾取（点击查看名称 / 耐久）？需要时改 true，并把 id / kind 挂到 metadata
    mesh.isPickable = false;
    return mesh;
  }

  function applyTransform(mesh: Mesh, item: TerrainItem): void {
    const scale = item.scale ?? 1;
    // 网格可能被冻结过（见下），更新前先解冻
    mesh.unfreezeWorldMatrix();
    mesh.position.copyFrom(worldToScene(item.x, item.y, z));
    // 绕 Z 轴旋转 = 在海平面内打转（Z 是高度轴）。船厂用它决定朝陆 / 朝海
    mesh.rotation.z = item.rotation ?? 0;
    mesh.scaling.set(scale, scale, scale);
    // 地物是静态的：冻结世界矩阵，省掉每帧的矩阵计算。
    // 冻结后世界矩阵已算好，碰撞系统可以直接用，不用每帧重算。
    // 以后要动态移动 / 击沉时，记得先 unfreezeWorldMatrix()
    mesh.freezeWorldMatrix();
  }

  function sync(items: readonly TerrainItem[]): void {
    const seen = new Set<string>();
    for (const item of items) {
      seen.add(item.id);
      let mesh = meshes.get(item.id);
      if (!mesh) {
        mesh = createMesh(item);
        meshes.set(item.id, mesh);
      }
      applyTransform(mesh, item);
      mesh.setEnabled(true);
    }
    // 数据里已经没有了的地物：销毁网格；材质保留在缓存里复用
    for (const [id, mesh] of meshes) {
      if (seen.has(id)) continue;
      mesh.dispose();
      meshes.delete(id);
    }
  }

  function dispose(): void {
    for (const mesh of meshes.values()) mesh.dispose();
    meshes.clear();
    for (const material of materials.values()) material.dispose();
    materials.clear();
  }

  return { sync, dispose };
}
