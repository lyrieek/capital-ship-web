// 舰船可视对象的创建：主游戏与 playground 共用同一套，避免重复实现。
// 选择/输入由 game/selection.ts 的 bindPointerInput 统一处理；此处只负责 Mesh / 贴图 / 选中圈的创建。
import { Color3, DynamicTexture, MeshBuilder, TransformNode, type LinesMesh, type Mesh, type Scene, type StandardMaterial } from "@babylonjs/core";
import { MAIN_TURRET_BARREL, MAIN_TURRET_RADIUS, mainTurretOffset, paintHull, rearTurretOffset, REAR_TURRET_SCALE } from "../game/textures";
import { createSelectionRing, type SelectionRing } from "../game/selection";
import { createPlane, createSpriteMaterial, toCanvas2D, worldToScene } from "../babylon";
import { paintCannonTurret } from "../weapons";
import type { ShipHud, ShipHudLayer } from "./hud";
import type { Ship } from "./ship";

// 渲染分组：海面在最底层，选中圈 / 舰船 / 炮塔同组，靠 alphaIndex 排序，HUD 再叠加
export const RG_SHIP = 1;
export const RG_HUD = 2;

// 舰船贴图放大倍率（矢量绘制，放大后更清晰）
export const SHIP_TEX_SCALE = 2;

// 同组内的透明排序：圈(0) → 舰体(1) → 炮塔(2)。图层顺序由 alphaIndex 决定，不再用世界 Z 当图层。
const SHIP_ALPHA_INDEX = 1;
const TURRET_ALPHA_INDEX = 2;

// 满后坐时炮塔沿炮管方向后退的世界距离（shipSize = 1 时）
const TURRET_KICK = 3.2;
// 炮塔贴图四周留白（世界单位，shipSize = 1 时），保证旋转时炮口/炮尾不被裁掉
const TURRET_PAD = 4;

// 导航虚线颜色（LinesMesh 原生 color/alpha，不需要单独材质）
const NAV_LINE_COLOR = Color3.FromHexString("#4ade80");
const NAV_LINE_ALPHA = 0.6;

// 单个炮塔：pivot 负责转向，mesh 负责显示与后坐位移
export interface TurretVisual {
  pivot: TransformNode;
  mesh: Mesh;
}

// 每艘舰船对应的可视对象
export interface ShipVisual {
  mesh: Mesh;
  material: StandardMaterial;
  texture: DynamicTexture;
  hud: ShipHud;
  ring: SelectionRing;
  line: LinesMesh | null;
  mainTurret: TurretVisual;
  rearTurret: TurretVisual;
  turretMaterial: StandardMaterial;
  turretTexture: DynamicTexture;
  shipSize: number;
}

// 创建一门炮塔：pivot 挂在舰体上负责转向，plane 挂在 pivot 上负责显示
function createTurret(name: string, hull: Mesh, scene: Scene, x: number, scale: number, size: number, material: StandardMaterial): TurretVisual {
  const plane = createPlane(`turret_${name}`, size, size, scene, RG_SHIP);
  plane.material = material;
  plane.alphaIndex = TURRET_ALPHA_INDEX;

  const pivot = new TransformNode(`turretPivot_${name}`, scene);
  pivot.parent = hull;
  pivot.position.x = x;
  plane.parent = pivot;
  plane.scaling.setAll(scale);

  return { pivot, mesh: plane };
}

/**
 * 创建舰船本体 + 头顶 HUD + 选中圈 + 可转动炮塔
 * 贴图复用游戏内同一套绘制函数
 * shipSize 缩放舰船与 HUD 尺寸，默认 1
 * 注意：限制区虚线不在此处创建，应在画船前由 RestrictArea 统一画出。
 * 若舰船位置超出其限制区，由 RestrictArea.validate 在画前抛错拒绝画。
 */
export function createShipVisual(ship: Ship, scene: Scene, hudLayer: ShipHudLayer, shipSize = 1): ShipVisual {
  // 贴图分辨率随 shipSize 放大，矢量绘制放大后更清晰
  const scale = SHIP_TEX_SCALE * shipSize;

  // 舰体贴图只画舰体，不再包含炮塔
  const texture = new DynamicTexture(`shipTexture_${ship.name}`, { width: ship.len * scale, height: ship.wid * scale }, scene, true);
  paintHull(toCanvas2D(texture), ship, scale);
  texture.update();

  // 舰船本体网格
  const mesh = createPlane(`ship_${ship.name}`, ship.len * shipSize, ship.wid * shipSize, scene, RG_SHIP);
  mesh.material = createSpriteMaterial(`shipMaterial_${ship.name}`, texture, scene);
  mesh.position.copyFrom(worldToScene(ship.x, ship.y));
  mesh.metadata = ship;
  mesh.isPickable = true;
  mesh.alphaIndex = SHIP_ALPHA_INDEX;

  // 碰撞不在这里：game/collision.ts 用 2D 胶囊 vs 地形圆，和渲染完全解耦。

  // 头顶 HUD：Babylon GUI 控件，随 mesh 投影跟随，不再生成贴图平面
  const hud = hudLayer.create(ship, mesh, shipSize);

  // 选中圈：与舰船同组（RG_SHIP）。海面在 group 0，波峰位移到 -Z 也只影响 group 0；
  // 组间会清深度缓冲，所以圈不会被波峰"擦掉"。组内顺序由 alphaIndex 决定（圈 0 → 舰体 1 → 炮塔 2）。
  const ring = createSelectionRing(scene, ship, RG_SHIP);
  ring.mesh.position.copyFrom(worldToScene(ship.x, ship.y));

  // ===== 炮塔：单独贴图 + 子 Mesh，转动时只改变换，不重绘舰体 =====
  // 主炮贴图里炮管朝本地 +X；尾部炮复用同一张并整体缩放。
  const turretWorldSize = (MAIN_TURRET_BARREL + TURRET_PAD) * 2 * shipSize;
  const turretTexSize = Math.max(1, Math.round(turretWorldSize * SHIP_TEX_SCALE));
  const pxPerWorld = turretTexSize / turretWorldSize;
  const turretTexture = new DynamicTexture(`shipTurretTexture_${ship.name}`, { width: turretTexSize, height: turretTexSize }, scene, true);
  paintCannonTurret(
    toCanvas2D(turretTexture),
    turretTexSize / 2,
    turretTexSize / 2,
    0,
    MAIN_TURRET_RADIUS * shipSize * pxPerWorld,
    MAIN_TURRET_BARREL * shipSize * pxPerWorld,
    ship.light,
    ship.dark,
    0,
  );
  turretTexture.update();

  // createSpriteMaterial 已统一禁用深度写入，炮塔与舰体同层时靠 alphaIndex 排序即可
  const turretMaterial = createSpriteMaterial(`shipTurretMaterial_${ship.name}`, turretTexture, scene);

  const mainTurret = createTurret(`${ship.name}_main`, mesh, scene, mainTurretOffset(ship.len) * shipSize, 1, turretWorldSize, turretMaterial);
  const rearTurret = createTurret(
    `${ship.name}_rear`,
    mesh,
    scene,
    rearTurretOffset(ship.len) * shipSize,
    REAR_TURRET_SCALE,
    turretWorldSize,
    turretMaterial,
  );
  mainTurret.pivot.rotation.z = -(ship.aimAngle - ship.angle);
  rearTurret.pivot.rotation.z = Math.PI;

  return {
    mesh,
    material: mesh.material as StandardMaterial,
    texture,
    hud,
    ring,
    line: null,
    mainTurret,
    rearTurret,
    turretMaterial,
    turretTexture,
    shipSize,
  };
}

// 每帧同步炮塔：主炮跟随瞄准角，尾部炮固定朝后，开火时沿炮管方向后坐
export function syncShipTurrets(visual: ShipVisual, ship: Ship): void {
  visual.mainTurret.pivot.rotation.z = -(ship.aimAngle - ship.angle);
  visual.mainTurret.mesh.position.x = -ship.recoil * TURRET_KICK * visual.shipSize;
  visual.rearTurret.mesh.position.x = -ship.recoil * 0.5 * TURRET_KICK * visual.shipSize;
}

// 释放炮塔：pivot.dispose() 会连同子 Mesh 一起销毁，材质/贴图为两门炮共用，只释放一次
export function disposeShipTurrets(visual: ShipVisual): void {
  visual.mainTurret.pivot.dispose();
  visual.rearTurret.pivot.dispose();
  visual.turretMaterial.dispose();
  visual.turretTexture.dispose();
}

// 销毁导航虚线（材质由 LinesMesh 内部管理）
export function disposeNavLine(visual: ShipVisual): void {
  if (!visual.line) return;
  visual.line.dispose();
  visual.line = null;
}

/**
 * 更新舰船的航行导航虚线：从船当前位置到右键下达的目标点。
 * 首次创建可更新的 LineMesh，之后每帧只原地更新两个点位，不销毁重建。
 * ship 无航行目标（order 为 null）时销毁旧线。
 */
export function updateShipNavigationLine(visual: ShipVisual, ship: Ship, scene: Scene): void {
  const order = ship.order;
  if (!order) {
    disposeNavLine(visual);
    return;
  }

  const start = worldToScene(ship.x, ship.y);
  const end = worldToScene(order.x, order.y);

  if (!visual.line) {
    visual.line = MeshBuilder.CreateDashedLines(
      `navLine_${ship.name}`,
      {
        points: [start, end],
        dashNb: 24,
        gapSize: 5,
        dashSize: 5,
        // 点数量固定，创建时就标成可更新，后续用 instance 原地改点位
        updatable: true,
      },
      scene,
    );
    visual.line.renderingGroupId = RG_HUD;
    visual.line.isPickable = false;
    visual.line.color = NAV_LINE_COLOR;
    visual.line.alpha = NAV_LINE_ALPHA;
    return;
  }

  MeshBuilder.CreateDashedLines(visual.line.name, { points: [start, end], instance: visual.line }, scene);
}
