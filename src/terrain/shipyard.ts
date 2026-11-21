// 船厂：一半在岸上（码头 / 船台 / 吊车），一半在水里（船坞）。
//
// 为什么船厂要长这样：
//   进厂检测的判定是「同时靠海 + 靠陆」，所以几何本身就按这个逻辑摆——
//   码头压在岸线上（-X 侧），船坞朝水面（+X 侧），
//   船坞四周的框就是检测区，画出来的框和 field.checkShipyard() 用的是同一个矩形
//   （见 shipyard-zone.ts），不会出现「看着在厂里、判定说不在」的错位。
//
// 网格朝向：和岛屿一致，海平面是 XY，高度沿 -Z 抬升（负数越大越高）。
// 整个船厂是一个合并网格 + 顶点色，所以只要一份材质。
import { Color3, Mesh, MeshBuilder, type Scene, StandardMaterial, VertexBuffer } from "@babylonjs/core";
import { shipyardZoneLocal } from "./shipyard-zone";
import type { TerrainSpec } from "./spec";
import type { TerrainItem } from "./types";

// 配色：混凝土码头 / 深一点的船台 / 吊车用警示黄 / 船坞检测框用亮青
const QUAY_COLOR = Color3.FromHexString("#9aa0a8");
const SHED_COLOR = Color3.FromHexString("#6f7780");
const CRANE_COLOR = Color3.FromHexString("#d9a13b");
const ZONE_COLOR = Color3.FromHexString("#7fe3ff");

// 给整块几何刷上同一个顶点色（后续 MergeMeshes 会保留顶点色）
function paintSolid(mesh: Mesh, color: Color3): void {
  const count = mesh.getTotalVertices();
  const colors = Array.from({ length: count }, () => [color.r, color.g, color.b, 1]).flat();
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  mesh.useVertexColors = true;
}

// 建一个长方体：width 沿 X、depth 沿 Y（海平面上的进深）、height 沿 Z（高度）
function addBox(scene: Scene, name: string, width: number, depth: number, height: number, x: number, y: number, z: number, color: Color3): Mesh {
  const box = MeshBuilder.CreateBox(name, { width, height: depth, depth: height }, scene);
  box.position.set(x, y, z);
  paintSolid(box, color);
  return box;
}

/**
 * 建一座船厂
 * @param name Mesh 名
 * @param scene Babylon 场景
 * @param spec 船厂参数（radius / height）
 * @param item 摆位（缩放 / 旋转）
 */
export function createShipyardMesh(name: string, scene: Scene, spec: TerrainSpec, item: TerrainItem): Mesh {
  const r = spec.radius;
  const h = spec.height;

  // ===== 岸上的部分（本地 -X 侧）=====
  // 码头平台：贴着水线的一块低矮混凝土台，船靠过来时不会显得悬空
  const quay = addBox(scene, `${name}_quay`, r * 0.9, r * 1.7, 6, r * 0.45, 0, -7, QUAY_COLOR);

  // 两座船台 / 仓库：并排放在码头上，高度约半个船厂高
  const shedWidth = r * 0.52;
  const shedDepth = r * 0.42;
  const shedHeight = h * 0.55;
  const shedTop = addBox(scene, `${name}_shedTop`, shedWidth, shedDepth, shedHeight, r * 0.36, -r * 0.38, -4 - shedHeight / 2, SHED_COLOR);
  const shedBottom = addBox(scene, `${name}_shedBottom`, shedWidth, shedDepth, shedHeight, r * 0.36, r * 0.38, -4 - shedHeight / 2, SHED_COLOR);

  // 吊车：立在码头临水的一侧，配一根伸向水面的吊臂
  const craneX = r * 0.78;
  const craneHeight = h * 0.9;
  const crane = addBox(scene, `${name}_crane`, r * 0.12, r * 0.12, craneHeight, craneX, 0, -4 - craneHeight / 2, CRANE_COLOR);
  const jib = addBox(scene, `${name}_jib`, r * 0.5, r * 0.06, r * 0.06, craneX + r * 0.25, 0, -4 - craneHeight, CRANE_COLOR);

  // ===== 水里的部分（本地 +X 侧）=====
  // 船坞检测区：四条细边把矩形框出来。
  // 这里用的矩形就是 shipyardZoneLocal()，和 field.checkShipyard() 判定用的是同一个，
  // 所以「看到的框」和「生效的框」严格一致。
  const zone = shipyardZoneLocal(r, item.scale ?? 1);
  const bar = r * 0.05;
  const zoneZ = -0.6;
  const zoneW = zone.maxX - zone.minX;
  const zoneD = zone.maxY - zone.minY;
  const zoneCx = (zone.minX + zone.maxX) / 2;
  const zoneCy = (zone.minY + zone.maxY) / 2;
  const zoneTop = addBox(scene, `${name}_zoneTop`, zoneW, bar, 1.2, zoneCx, zone.minY, zoneZ, ZONE_COLOR);
  const zoneBottom = addBox(scene, `${name}_zoneBottom`, zoneW, bar, 1.2, zoneCx, zone.maxY, zoneZ, ZONE_COLOR);
  const zoneLeft = addBox(scene, `${name}_zoneLeft`, bar, zoneD, 1.2, zone.minX, zoneCy, zoneZ, ZONE_COLOR);
  const zoneRight = addBox(scene, `${name}_zoneRight`, bar, zoneD, 1.2, zone.maxX, zoneCy, zoneZ, ZONE_COLOR);

  const merged = Mesh.MergeMeshes(
    [quay, shedTop, shedBottom, crane, jib, zoneTop, zoneBottom, zoneLeft, zoneRight],
    true,
    true,
    undefined,
    false,
    false,
  );
  if (!merged) throw new Error(`[terrain] 船厂网格合并失败: ${name}`);
  merged.name = name;
  return merged;
}

/** 船厂材质：白色底 + 顶点色 + 受光（和岛屿同一套思路，斜视角才有体积感） */
export function createShipyardMaterial(name: string, scene: Scene): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.White();
  material.specularColor = Color3.Black();
  material.emissiveColor = Color3.Black();
  material.backFaceCulling = false;
  return material;
}
