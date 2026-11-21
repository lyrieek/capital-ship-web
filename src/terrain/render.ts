// 地物渲染：把 TerrainItem 列表同步成 Babylon 网格。
// 地物是静态的，正常只在初始化时 sync 一次；保留 sync 是为了以后支持「战斗中被击毁 / 动态生成」。
import { Color3, HemisphericLight, type Mesh, type Scene, type StandardMaterial, Vector3 } from "@babylonjs/core";
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

  // Babylon 内置碰撞：地物作为「静态障碍物」参与碰撞。
  // 移动方（舰船）的椭球在 ship/render-visual.ts 里定义，由 game/render.ts 调用 moveWithCollisions。
  scene.collisionsEnabled = true;

  // 每个地物一个 Mesh：key 为 item.id，sync 时按 id 增删
  const meshes = new Map<string, Mesh>();
  // 材质按类型缓存：同类型地物共用一份，几何形状差异靠 seed 体现在网格上
  const materials = new Map<TerrainKind, StandardMaterial>();

  // 地物要有真实光照才有体积感。场景里其他材质都是自发光贴图（舰船 / 弹药 / 粒子）
  // 或 ShaderMaterial（海面），不受这盏灯影响，所以可以放心在这里加。
  // HemisphericLight 的 direction 指向光源：我们的网格法线朝 -Z（相机一侧），
  // 所以光源也放在 -Z 一侧，岛顶才是亮的。
  // TODO: 以后接入统一的太阳 / 环境光系统时，把这盏灯挪到 babylon/scene.ts 管理
  const light = new HemisphericLight("terrainLight", new Vector3(-0.35, 0.45, -1).normalize(), scene);
  light.intensity = 0.95;
  light.diffuse = Color3.White();
  light.groundColor = Color3.FromHexString("#24404f");
  light.specular = Color3.Black();

  function getMaterial(kind: TerrainKind): StandardMaterial {
    const existing = materials.get(kind);
    if (existing) return existing;
    const material = FACTORIES[kind].createMaterial(`terrainMaterial_${kind}`, scene);
    materials.set(kind, material);
    return material;
  }

  function createMesh(item: TerrainItem): Mesh {
    const spec = getTerrainSpec(item.kind);
    const mesh = FACTORIES[item.kind].createMesh(`terrain_${item.id}`, scene, spec, item);
    mesh.material = getMaterial(item.kind);
    mesh.renderingGroupId = renderingGroupId;
    // 只有 spec.solid 的地物才当障碍物：
    // 船厂 solid = false——它有一半在水里（船坞），必须让船能开进去，否则进厂检测永远不成立。
    mesh.checkCollisions = spec.solid;
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
    light.dispose();
  }

  return { sync, dispose };
}
