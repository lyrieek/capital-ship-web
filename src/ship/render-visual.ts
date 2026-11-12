// 舰船可视对象的创建：主游戏与 playground 共用同一套，避免重复实现。
// bindShipSelection 由调用方自行绑定，此处只负责 Mesh / 贴图 / 选中圈的创建。
import { DynamicTexture, type Mesh, type Scene, type StandardMaterial } from "@babylonjs/core";
import { paintShip, paintShipHud } from "../game/textures";
import { createSelectionRing, type SelectionRing } from "../game/selection";
import { createPlane, createSpriteMaterial, toCanvas2D, worldToScene } from "../babylon";
import type { Ship } from "./ship";

// 渲染分组：海面 / 选中圈在最底层，舰船与 HUD 依次叠加
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
  lastHp: number;
  lastState: Ship["state"];
  lastAlive: boolean;
  lastRecoil: number;
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
  const texture = new DynamicTexture(`shipTexture_${ship.name}`, { width: ship.len * scale, height: ship.wid * scale }, scene, true);
  paintShip(toCanvas2D(texture), ship, scale);
  texture.update();

  // 舰船本体网格
  const mesh = createPlane(`ship_${ship.name}`, ship.len * shipSize, ship.wid * shipSize, scene, RG_SHIP);
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

  // 选中圈：画在贴图上，作为舰船下方的绿色椭圆环
  const ring = createSelectionRing(scene, ship, 0);
  ring.mesh.position.copyFrom(worldToScene(ship.x, ship.y, RING_Z));

  return {
    mesh,
    material: mesh.material as StandardMaterial,
    texture,
    hud,
    hudMaterial,
    hudTexture,
    ring,
    lastHp: -1,
    lastState: "normal",
    lastAlive: true,
    lastRecoil: -1,
    shipSize,
  };
}
