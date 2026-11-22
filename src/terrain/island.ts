// 岛屿：用 Babylon 的真实网格生成，不用 Canvas 贴图。
//
// 为什么不画贴图（重要）：
//   现在是正交俯视，贴图看不出问题；但以后相机会抬高、甚至切成斜视角 / 环绕视角，
//   贴图会立刻变成「贴」在海面上的一张纸片——没有体积、没有遮挡、也接不住炮弹和舰船。
//   真实网格在任意角度都有轮廓和明暗，还能直接做拾取与碰撞。
//
// 网格朝向：海平面是 XY 平面，相机在 -Z 一侧看向 +Z，
// 所以高度沿 -Z 抬升（岛心最靠近相机，岸线沉到水面以下）。
import { Color3, Mesh, type Scene, StandardMaterial, VertexData } from "@babylonjs/core";
import type { TerrainSpec } from "./spec";
import type { TerrainItem } from "./types";

// 岸线沉到水面以下的深度：让岸线被海面自然遮住，避免看起来像「贴在海面上的一张饼」
const SINK = 1.2;
// 环数 / 每环顶点数：顶点数 = 1 + rings * segments，越大越圆滑也越费
const RINGS = 5;
const SEGMENTS = 30;

// 沙滩 / 草地：顶点色直接烘进网格，材质保持白色受光即可
const SAND = Color3.FromHexString("#e7d8ab");
const GRASS = Color3.FromHexString("#4f7d52");

// 海岸线：几个不同频率的正弦叠加当「伪噪声」。
// 不引噪声库是因为形状必须可复现——同一个 seed 每次生成的岛屿完全一致，
// 摆位表、碰撞半径、小地图才能对得上。
function coastlineScale(angle: number, seed: number): number {
  const phase = seed * 1.7;
  return 1 + 0.12 * Math.sin(angle * 3 + phase) + 0.07 * Math.sin(angle * 7 + phase * 2.3) + 0.04 * Math.sin(angle * 13 + phase * 4.1);
}

/**
 * 岸线在指定角度上的半径（世界单位，未乘 item.scale）
 * 渲染和小地图共用同一个函数，保证小地图上的岛形和 3D 网格一致。
 */
export function islandRadiusAt(angle: number, spec: TerrainSpec, seed: number): number {
  return spec.radius * coastlineScale(angle, seed);
}

// 高度剖面：t=0 是岛心，t=1 是岸线；向岸边平滑降到 0，沙滩段几乎与海面齐平
function heightProfile(t: number): number {
  return Math.max(0, 1 - t / 0.82) ** 0.75;
}

// 顶点色：外圈沙滩 → 内圈草地，中间插值过渡，避免生硬的一圈边
function islandColor(profile: number): Color3 {
  const t = Math.min(1, Math.max(0, (profile - 0.16) / 0.42));
  return Color3.Lerp(SAND, GRASS, t);
}

/**
 * 建一座岛
 * @param name Mesh 名
 * @param scene Babylon 场景
 * @param spec 岛屿参数（半径 / 高度）
 * @param item 摆位（缩放 / 种子）
 */
export function createIslandMesh(name: string, scene: Scene, spec: TerrainSpec, item: TerrainItem): Mesh {
  const seed = item.seed ?? 0;
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];

  const pushVertex = (x: number, y: number, z: number, color: Color3): void => {
    positions.push(x, y, z);
    colors.push(color.r, color.g, color.b, 1);
  };

  // 岛心：最高点
  pushVertex(0, 0, -spec.height, islandColor(1));

  // 同心环：半径随角度抖动得到不规则岸线，高度按剖面抬升
  for (let ring = 1; ring <= RINGS; ring++) {
    const t = ring / RINGS;
    const profile = heightProfile(t);
    for (let s = 0; s < SEGMENTS; s++) {
      const angle = (s / SEGMENTS) * Math.PI * 2;
      const r = islandRadiusAt(angle, spec, seed) * t;
      // 边缘额外下沉 SINK，让岸线藏进海面以下
      const z = -(spec.height * profile + SINK * t);
      pushVertex(Math.cos(angle) * r, Math.sin(angle) * r, z, islandColor(profile));
    }
  }

  // 三角面：中心扇形 + 环间四边形（拆两个三角形）
  for (let s = 0; s < SEGMENTS; s++) {
    indices.push(0, 1 + s, 1 + ((s + 1) % SEGMENTS));
  }
  for (let ring = 1; ring < RINGS; ring++) {
    const inner = 1 + (ring - 1) * SEGMENTS;
    const outer = 1 + ring * SEGMENTS;
    for (let s = 0; s < SEGMENTS; s++) {
      const next = (s + 1) % SEGMENTS;
      indices.push(inner + s, outer + s, outer + next, inner + s, outer + next, inner + next);
    }
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.colors = colors;

  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  // 法线朝向：相机在 -Z 一侧，需要法线朝 -Z。
  // 用全部法线的 Z 分量之和判断方向，比只看第一个法线稳；反了就交给 Babylon 同时翻转法线和绕序。
  let normalZ = 0;
  for (let i = 2; i < normals.length; i += 3) normalZ += normals[i];
  if (normalZ > 0) mesh.flipFaces(true);
  // 沙滩 / 草地已经烘进顶点色，材质只要「白色 + 受光」
  mesh.useVertexColors = true;
  return mesh;
}

/** 岛屿材质：白色底 + 顶点色 + 受光，斜视角时才有体积感 */
export function createIslandMaterial(name: string, scene: Scene): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.White();
  material.specularColor = Color3.Black();
  material.emissiveColor = Color3.Black();
  // 岛屿是开放曲面（没有底面），关掉背面剔除，避免绕序问题导致整岛消失
  material.backFaceCulling = false;
  return material;
}
