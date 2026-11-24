// 船厂：一半在岸上（码头 / 船台 / 吊车），一半在水里（船坞）。
//
// 为什么船厂要长这样：
//   进厂检测的判定是「同时靠海 + 靠陆」，所以几何本身就按这个逻辑摆——
//   码头压在岸线上（-X 侧），船坞朝水面（+X 侧），
//   船坞四周的框就是检测区，画出来的框和 field.checkShipyard() 用的是同一个矩形
//   （见 shipyard-zone.ts），不会出现「看着在厂里、判定说不在」的错位。
//
// 陆域设施的占地由 shipyard-zone.ts 的 SHIPYARD_LAND_BOXES 统一定义，
// 渲染与落位校验共用同一份数据，避免「画出来的盒子」和「校验的盒子」不一致。
//
// 网格朝向：和岛屿一致，海平面是 XY，高度沿 -Z 抬升（负数越大越高）。
// 整个船厂是一个合并网格 + 顶点色，所以只要一份材质。
import { Color3, Mesh, MeshBuilder, type Scene, StandardMaterial, VertexBuffer } from "@babylonjs/core";
import { SHIPYARD_LAND_BOXES, shipyardBoxLocal, shipyardZoneLocal, type ShipyardBox } from "./shipyard-zone";
import type { TerrainSpec } from "./spec";
import type { TerrainItem } from "./types";

// 配色：混凝土码头 / 深一点的船台 / 吊车用警示黄 / 船坞检测框用亮青
const QUAY_COLOR = Color3.FromHexString("#9aa0a8");
const SHED_COLOR = Color3.FromHexString("#6f7780");
const CRANE_COLOR = Color3.FromHexString("#d9a13b");
const ZONE_COLOR = Color3.FromHexString("#7fe3ff");

// 陆域设施的垂直参数：横向占地由 SHIPYARD_LAND_BOXES 决定，这里只补高度和离地
interface LandRenderSpec {
  height: number;
  z: number;
  color: Color3;
}

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

// 按本地占地矩形建盒子
function addLocalBox(scene: Scene, name: string, box: { minX: number; maxX: number; minY: number; maxY: number }, spec: LandRenderSpec): Mesh {
  return addBox(
    scene,
    name,
    box.maxX - box.minX,
    box.maxY - box.minY,
    spec.height,
    (box.minX + box.maxX) / 2,
    (box.minY + box.maxY) / 2,
    spec.z,
    spec.color,
  );
}

// 陆域设施的高度 / 颜色：与 SHIPYARD_LAND_BOXES 的 id 一一对应
function landRenderSpecs(height: number): Record<ShipyardBox["id"], LandRenderSpec> {
  const shedHeight = height * 0.55;
  const craneHeight = height * 0.9;
  return {
    quay: { height: 6, z: -7, color: QUAY_COLOR },
    shedTop: { height: shedHeight, z: -4 - shedHeight / 2, color: SHED_COLOR },
    shedBottom: { height: shedHeight, z: -4 - shedHeight / 2, color: SHED_COLOR },
    crane: { height: craneHeight, z: -4 - craneHeight / 2, color: CRANE_COLOR },
  };
}

/**
 * 建一座船厂
 * @param name Mesh 名
 * @param scene Babylon 场景
 * @param spec 船厂参数（radius / height）
 * @param item 摆位（缩放 / 旋转）
 */
export function createShipyardMesh(name: string, scene: Scene, spec: TerrainSpec, _item: TerrainItem): Mesh {
  const r = spec.radius;
  const h = spec.height;
  const specs = landRenderSpecs(h);

  // ===== 岸上的部分（本地 -X 侧）=====
  // 几何保持未缩放坐标，item.scale 由渲染层的 mesh.scaling 统一处理
  const landMeshes = SHIPYARD_LAND_BOXES.map((box) => addLocalBox(scene, `${name}_${box.id}`, shipyardBoxLocal(box, r), specs[box.id]));

  // 吊车吊臂：从吊车基座伸向水面，属于水上结构，不计入陆域占地
  const craneBoxSpec = SHIPYARD_LAND_BOXES.find((box) => box.id === "crane");
  if (!craneBoxSpec) throw new Error("[terrain] 船厂缺少 crane 占地定义");
  const craneBox = shipyardBoxLocal(craneBoxSpec, r);
  const jibHeight = h * 0.9;
  const jib = addBox(scene, `${name}_jib`, r * 0.5, r * 0.06, r * 0.06, craneBox.maxX + r * 0.25, 0, -4 - jibHeight, CRANE_COLOR);

  // ===== 水里的部分（本地 +X 侧）=====
  // 船坞检测区：四条细边把矩形框出来。
  // 这里用的矩形就是 shipyardZoneLocal()，和 field.checkShipyard() 判定用的是同一个，
  // 所以「看到的框」和「生效的框」严格一致。
  const zone = shipyardZoneLocal(r);
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

  const merged = Mesh.MergeMeshes([...landMeshes, jib, zoneTop, zoneBottom, zoneLeft, zoneRight], true, true, undefined, false, false);
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
