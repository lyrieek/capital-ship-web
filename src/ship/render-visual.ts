// 舰船可视对象的创建：主游戏与 playground 共用同一套，避免重复实现。
// bindShipSelection 由调用方自行绑定，此处只负责 Mesh / 贴图 / 选中圈的创建。
import { Color3, DynamicTexture, MeshBuilder, StandardMaterial, type Mesh, type Scene } from "@babylonjs/core";
import { paintShip, paintShipHud, SHIP_TEX_PAD } from "../game/textures";
import { createSelectionRing, type SelectionRing } from "../game/selection";
import { createPlane, createSpriteMaterial, toCanvas2D, worldToScene } from "../babylon";
import type { Ship } from "./ship";

// 渲染分组：海面在最底层，选中圈与舰船同组（靠 Z 值排在舰船下），HUD 再叠加
export const RG_SHIP = 1;
export const RG_HUD = 2;

// 舰船贴图的 Z 偏移：靠近相机一侧，保证点击时优先选中舰船而不是海面
export const SHIP_Z = -1;
export const HUD_Z = -2;
// 选中圈贴在海面之上、舰船之下
export const RING_Z = -0.5;

// 舰船贴图放大倍率（矢量绘制，放大后更清晰）
export const SHIP_TEX_SCALE = 2;
// 单艘舰船的 HUD 贴图基础尺寸（世界单位 / 像素），随 shipSize 缩放
export const HUD_W = 160;
export const HUD_H = 56;

// 每艘舰船对应的可视对象
export interface ShipVisual {
  mesh: Mesh;
  material: StandardMaterial;
  texture: DynamicTexture;
  hud: Mesh;
  hudMaterial: StandardMaterial;
  hudTexture: DynamicTexture;
  ring: SelectionRing;
  line: Mesh | null;
  // 导航虚线材质：每帧重建 LineMesh 时复用，避免每帧新建/销毁材质导致 shader 反复编译
  lineMaterial: StandardMaterial;
  lastHp: number;
  lastState: Ship["state"];
  lastAlive: boolean;
  lastRecoil: number;
  // 上一次绘制炮管时的瞄准角度，用于炮塔持续转动时重绘贴图
  lastAim: number;
  // 上一次绘制贴图时的舰体朝向（炮塔角度是相对舰体的，舰体转向后需要重绘）
  lastAngle: number;
  shipSize: number;
}

/**
 * 创建舰船本体 + 头顶 HUD + 选中圈
 * 贴图复用游戏内同一套绘制函数
 * shipSize 缩放舰船与 HUD 尺寸，默认 1
 */
export function createShipVisual(ship: Ship, scene: Scene, shipSize = 1): ShipVisual {
  // 贴图分辨率随 shipSize 放大，矢量绘制放大后更清晰
  const scale = SHIP_TEX_SCALE * shipSize;
  // 高度加上炮管留白，舰船本体仍绘制在贴图中央
  const textureHeight = (ship.wid + 2 * SHIP_TEX_PAD) * scale;
  const texture = new DynamicTexture(`shipTexture_${ship.name}`, { width: ship.len * scale, height: textureHeight }, scene, true);
  paintShip(toCanvas2D(texture), ship, scale);
  texture.update();

  // 舰船本体网格
  const mesh = createPlane(`ship_${ship.name}`, ship.len * shipSize, (ship.wid + 2 * SHIP_TEX_PAD) * shipSize, scene, RG_SHIP);
  mesh.material = createSpriteMaterial(`shipMaterial_${ship.name}`, texture, scene);
  mesh.position.copyFrom(worldToScene(ship.x, ship.y, SHIP_Z));
  mesh.metadata = ship;
  mesh.isPickable = true;

  // 头顶 HUD 网格，尺寸随 shipSize 缩放
  const hudWidth = HUD_W * shipSize;
  const hudHeight = HUD_H * shipSize;
  const hudTexture = new DynamicTexture(`shipHudTexture_${ship.name}`, { width: hudWidth, height: hudHeight }, scene, true);
  paintShipHud(toCanvas2D(hudTexture), ship, hudWidth, hudHeight);
  hudTexture.update();

  const hud = createPlane(`shipHud_${ship.name}`, hudWidth, hudHeight, scene, RG_HUD);
  const hudMaterial = createSpriteMaterial(`shipHudMaterial_${ship.name}`, hudTexture, scene);
  hud.material = hudMaterial;

  // 选中圈：必须与舰船同组（RG_SHIP）而不是海面 group 0。
  // 海面顶点着色器会把波峰朝相机方向推最多约 12 个世界单位，group 0 内波峰会比 z=-0.5 的圈更近，
  // 深度测试会把圈随波峰"擦掉"又"画回来"；渲染分组之间会清深度缓冲，同组即可避开。
  const ring = createSelectionRing(scene, ship, RG_SHIP);
  ring.mesh.position.copyFrom(worldToScene(ship.x, ship.y, RING_Z));

  // 导航虚线材质：线网格每帧重建，但材质只创建一次并复用，保证 shader 一直 ready
  const lineMaterial = new StandardMaterial(`navLineMaterial_${ship.name}`, scene);
  lineMaterial.diffuseColor = Color3.FromHexString("#4ade80");
  lineMaterial.emissiveColor = Color3.FromHexString("#4ade80");
  lineMaterial.alpha = 0.6;

  return {
    mesh,
    material: mesh.material as StandardMaterial,
    texture,
    hud,
    hudMaterial,
    hudTexture,
    ring,
    line: null,
    lineMaterial,
    lastHp: -1,
    lastState: "normal",
    lastAlive: true,
    lastRecoil: -1,
    lastAim: ship.aimAngle,
    lastAngle: ship.angle,
    shipSize,
  };
}

// 销毁导航虚线（复用材质由 ShipVisual 持有，不随 Mesh.dispose 释放）
export function disposeNavLine(visual: ShipVisual): void {
  if (!visual.line) return;
  visual.line.dispose();
  visual.line = null;
}

/**
 * 更新舰船的航行导航虚线：从船当前位置到右键下达的目标点。
 * 每帧重新计算并重建，不保留旧点位，避免残留轨迹线。
 * ship 无航行目标（order 为 null）时销毁旧线。
 */
export function updateShipNavigationLine(visual: ShipVisual, ship: Ship, scene: Scene): void {
  const order = ship.order;
  if (!order) {
    disposeNavLine(visual);
    return;
  }

  const start = worldToScene(ship.x, ship.y, RING_Z);
  const end = worldToScene(order.x, order.y, RING_Z);

  // 每帧销毁旧线后重建，确保线只连接当前船位到当前目标点，不残留历史轨迹
  disposeNavLine(visual);

  visual.line = MeshBuilder.CreateDashedLines(
    `navLine_${ship.name}`,
    {
      points: [start, end],
      dashNb: 24,
      gapSize: 5,
      dashSize: 5,
    },
    scene,
  );
  visual.line.renderingGroupId = RG_HUD;
  visual.line.isPickable = false;
  visual.line.material = visual.lineMaterial;
}
