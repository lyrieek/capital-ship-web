// 礁石：几段低矮的多面体岩块拼成一片，纯 Babylon 原语 + 合并网格。
//
// 现在是「能看」的占位实现：先确认网格管线、渲染分组、碰撞半径能对上。
// TODO: 换成沿形状分布的岩块 + 水下礁盘（半透明），并与 island.ts 共用同一套顶点色方案，
//       这样斜视角时礁石也有水下部分，而不是一个个浮在水面的石头。
import { Color3, Mesh, MeshBuilder, type Scene, StandardMaterial } from "@babylonjs/core";
import type { TerrainSpec } from "./spec";
import type { TerrainItem } from "./types";

/** 岩块数量：固定 4 块，靠 seed 决定排布，避免每帧随机导致形状变化 */
const ROCKS = 4;

/**
 * 建一片礁石
 * @param name Mesh 名
 * @param scene Babylon 场景
 * @param spec 礁石参数（半径 / 高度）
 * @param item 摆位（缩放 / 种子）
 */
export function createReefMesh(name: string, scene: Scene, spec: TerrainSpec, item: TerrainItem): Mesh {
  const seed = item.seed ?? 0;
  const parts: Mesh[] = [];

  for (let i = 0; i < ROCKS; i++) {
    const angle = (i / ROCKS) * Math.PI * 2 + seed;
    const distance = spec.radius * 0.42;
    // 交错使用八面体 / 二十面体，避免四块石头长得一模一样
    const rock = MeshBuilder.CreatePolyhedron(`${name}_rock${i}`, { type: i % 2 === 0 ? 1 : 3, size: spec.radius * (0.3 + 0.08 * (i % 3)) }, scene);
    rock.rotation.z = angle;
    // 压扁：礁石是「趴」在水里的，不是球
    rock.scaling.set(1, 0.85, 0.5);
    rock.position.set(Math.cos(angle) * distance, Math.sin(angle) * distance, -spec.height * 0.45);
    parts.push(rock);
  }

  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!merged) throw new Error(`[terrain] 礁石网格合并失败: ${name}`);
  merged.name = name;
  return merged;
}

/** 礁石材质：湿岩灰，几乎不反光 */
export function createReefMaterial(name: string, scene: Scene): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.FromHexString("#5b6b70");
  material.specularColor = Color3.Black();
  material.emissiveColor = Color3.Black();
  material.backFaceCulling = false;
  return material;
}
