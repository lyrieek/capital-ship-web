// 地物渲染：把 TerrainItem 列表同步成 Babylon 网格。
// 地物是静态的，正常只在初始化时 sync 一次；保留 sync 是为了以后支持「战斗中被击毁 / 动态生成」。
// 同一类型的地物被静态合批为一个 Mesh（顶点已烘入世界变换），把 N 个地物的 N 次绘制降为每类 1 次。
import { Mesh, type Scene, type StandardMaterial } from "@babylonjs/core";
import { worldToScene } from "../babylon";
import { createIslandMaterial, createIslandMesh, islandSurfaceZ } from "./island";
import { createReefMaterial, createReefMesh } from "./reef";
import { createShipyardMaterial, createShipyardMesh } from "./shipyard";
import { createPalmForest, placePalms, type PalmInstance } from "./palm";
import { getTerrainSpec, type TerrainSpec } from "./spec";
import { TERRAIN_KINDS, type TerrainItem, type TerrainKind } from "./types";

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
  // 材质按类型缓存：同类型地物共用一份，几何形状差异靠 seed 体现在网格上
  const materials = new Map<TerrainKind, StandardMaterial>();
  // 静态合批后的网格：每类地物一个 Mesh
  const batches = new Map<TerrainKind, Mesh>();
  // 棕榈林：所有大岛的棕榈共享同一份 thin instance 网格（二次渲染）
  let palmForest: Mesh | null = null;

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
    // 绕 Z 轴旋转 = 在海平面内打转（Z 是高度轴）。
    // 注意：rotation 存的是世界角度（Y 向下、顺时针为正），场景坐标 Y 向上，
    // 所以这里必须取反，否则船厂的“靠陆 / 靠海”会整个翻转。
    mesh.rotation.z = -(item.rotation ?? 0);
    mesh.scaling.set(scale, scale, scale);
    // 地物是静态的：冻结世界矩阵，省掉每帧的矩阵计算。
    mesh.freezeWorldMatrix();
  }

  function buildBatch(kind: TerrainKind, items: readonly TerrainItem[]): Mesh | null {
    const meshes: Mesh[] = [];
    for (const item of items) {
      if (item.kind !== kind) continue;
      const mesh = createMesh(item);
      applyTransform(mesh, item);
      meshes.push(mesh);
    }
    if (meshes.length === 0) return null;
    // 合批：把同类地物的顶点烘入一个 Mesh，绘制次数从 N 降到 1；disposeSource=true 会释放源网格
    const batch = Mesh.MergeMeshes(meshes, true, true);
    if (!batch) throw new Error(`[terrain] 地物网格合并失败: ${kind}`);
    batch.name = `terrainBatch_${kind}`;
    batch.material = getMaterial(kind);
    batch.renderingGroupId = renderingGroupId;
    batch.isPickable = false;
    // 合批后的网格同样静态：冻结世界矩阵（identity），省掉每帧矩阵计算
    batch.freezeWorldMatrix();
    return batch;
  }

  function buildPalmForest(items: readonly TerrainItem[]): void {
    // 释放旧棕榈林及其材质
    palmForest?.material?.dispose();
    palmForest?.dispose();
    palmForest = null;

    // 收集所有大岛上的棕榈（岛屿局部坐标 -> 场景坐标，注意世界 Y 向下、场景 Y 向上，需翻转偏移）
    // 树干底部贴岛面：按棕榈所在位置反查岛屿高度剖面，避免漂浮在海面或陷进岛里
    const instances: PalmInstance[] = [];
    for (const item of items) {
      if (item.kind !== "island") continue;
      const spec = getTerrainSpec(item.kind);
      const locals = placePalms(item, spec.radius);
      const base = worldToScene(item.x, item.y, 0);
      const scale = item.scale ?? 1;
      const seed = item.seed ?? 0;
      for (const local of locals) {
        // placePalms 返回的是世界偏移（已乘 scale）；岛网格也按 scale 放大，
        // 所以先换回局部坐标求地表高度，再把高度乘回 scale。
        const localZ = islandSurfaceZ(local.x / scale, local.y / scale, spec, seed);
        instances.push({
          x: base.x + local.x,
          y: base.y - local.y,
          z: base.z + localZ * scale,
          scale: local.scale,
          angle: local.angle,
        });
      }
    }

    palmForest = createPalmForest("palmForest", scene, renderingGroupId, instances);
  }

  function sync(items: readonly TerrainItem[]): void {
    // 释放旧合批
    for (const batch of batches.values()) batch.dispose();
    batches.clear();
    // 每类地物重建一份合批（地物静态，sync 只在初始化时调用；如需动态增删，这里重建即可）
    for (const kind of TERRAIN_KINDS) {
      const batch = buildBatch(kind, items);
      if (batch) batches.set(kind, batch);
    }

    buildPalmForest(items);
  }

  function dispose(): void {
    for (const batch of batches.values()) batch.dispose();
    batches.clear();
    palmForest?.material?.dispose();
    palmForest?.dispose();
    palmForest = null;
    for (const material of materials.values()) material.dispose();
    materials.clear();
  }

  return { sync, dispose };
}
