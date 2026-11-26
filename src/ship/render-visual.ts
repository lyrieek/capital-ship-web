// 舰船可视对象的创建：主游戏与 playground 共用同一套，避免重复实现。
// 选择/输入由 game/selection.ts 的 bindPointerInput 统一处理；此处只负责 Mesh / 贴图 / 选中圈的创建。
import {
  Color3,
  DynamicTexture,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type LinesMesh,
  type Mesh,
  type Scene,
} from "@babylonjs/core";
import { MAIN_TURRET_BARREL, MAIN_TURRET_RADIUS, paintHull } from "../game/textures";
import { createSelectionRing, type SelectionRing } from "../game/selection";
import { P } from "../game/utils";
import { createPlane, createSpriteMaterial, toCanvas2D, worldToScene } from "../babylon";
import { getWeaponSpec } from "../weapons/spec";
import { paintCannonTurret } from "../weapons";
import { getShipClassSpec } from "./ship-class";
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
  /** 相对主炮塔的缩放，后坐位移也按它换算 */
  scale: number;
  /** 非交战状态下炮管相对舰体的停靠角度 */
  restAngle: number;
}

// 每艘舰船对应的可视对象
export interface ShipVisual {
  mesh: Mesh;
  material: StandardMaterial;
  texture: DynamicTexture;
  hud: ShipHud;
  ring: SelectionRing;
  line: LinesMesh | null;
  turrets: TurretVisual[];
  turretMaterial: StandardMaterial;
  turretTexture: DynamicTexture;
  shipSize: number;
  /** 每门炮的射程扇形（选中时显示，1秒可转角度）：fill 是填充区域，edges 是边缘弧线 */
  rangeArcs: { fill: Mesh; edges: Mesh[] }[];
}

// 创建一门炮塔：pivot 挂在舰体上负责转向，plane 挂在 pivot 上负责显示
function createTurret(
  name: string,
  hull: Mesh,
  scene: Scene,
  x: number,
  scale: number,
  size: number,
  material: StandardMaterial,
  restAngle = 0,
): TurretVisual {
  const plane = createPlane(`turret_${name}`, size, size, scene, RG_SHIP);
  plane.material = material;
  plane.alphaIndex = TURRET_ALPHA_INDEX;

  const pivot = new TransformNode(`turretPivot_${name}`, scene);
  pivot.parent = hull;
  pivot.position.x = x;
  pivot.rotation.z = restAngle;
  plane.parent = pivot;
  plane.scaling.setAll(scale);

  return { pivot, mesh: plane, scale, restAngle };
}

// 创建单门炮的射程扇形：以 (0,0) 为中心、局部 +X 为基准方向，从 -turnRate 到 +turnRate 的扇形区域。
// fill 是极其透明的浅红扇形面积，edges 是淡红色的边缘弧线与半径线。
// 创建后由调用方通过 position / rotation.z 把它放到炮塔世界坐标并朝向当前 aimAngle。
function createRangeArc(
  name: string,
  scene: Scene,
  range: number,
  turnRate: number,
): {
  fill: Mesh;
  edges: Mesh[];
} {
  const inner = 6;
  const outer = range;
  const segments = 24;
  const innerArc: Vector3[] = [];
  const outerArc: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = -turnRate + turnRate * 2 * t;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    innerArc.push(new Vector3(cx * inner, cy * inner, 0));
    outerArc.push(new Vector3(cx * outer, cy * outer, 0));
  }

  // 扇形填充区域：inner -> outer 的环带 Ribbon，极其透明浅红
  const fill = MeshBuilder.CreateRibbon(`rangeArcFill_${name}`, { pathArray: [innerArc, outerArc] }, scene);
  const fillMat = new StandardMaterial(`rangeArcFillMat_${name}`, scene);
  fillMat.diffuseColor = Color3.FromHexString("#ff6b6b");
  fillMat.emissiveColor = Color3.FromHexString("#ff6b6b");
  fillMat.alpha = 0.06;
  fillMat.disableDepthWrite = true;
  fill.material = fillMat;
  fill.renderingGroupId = RG_SHIP;
  fill.isPickable = false;
  fill.alphaIndex = TURRET_ALPHA_INDEX;

  // 边缘：淡红色弧线与半径线
  const edgeColor = Color3.FromHexString("#ff6b6b");
  const edges: Mesh[] = [];

  const innerLine = MeshBuilder.CreateLines(`rangeArcInner_${name}`, { points: innerArc }, scene);
  innerLine.color = edgeColor;
  innerLine.alpha = 0.25;
  innerLine.renderingGroupId = RG_SHIP;
  innerLine.isPickable = false;
  edges.push(innerLine);

  const outerLine = MeshBuilder.CreateLines(`rangeArcOuter_${name}`, { points: outerArc }, scene);
  outerLine.color = edgeColor;
  outerLine.alpha = 0.25;
  outerLine.renderingGroupId = RG_SHIP;
  outerLine.isPickable = false;
  edges.push(outerLine);

  const startA = -turnRate;
  const endA = turnRate;
  const scx = Math.cos(startA);
  const scy = Math.sin(startA);
  const ecx = Math.cos(endA);
  const ecy = Math.sin(endA);

  const radius1 = MeshBuilder.CreateLines(
    `rangeArcRadius1_${name}`,
    {
      points: [Vector3.Zero(), new Vector3(scx * inner, scy * inner, 0), new Vector3(scx * outer, scy * outer, 0)],
    },
    scene,
  );
  radius1.color = edgeColor;
  radius1.alpha = 0.45;
  radius1.renderingGroupId = RG_SHIP;
  radius1.isPickable = false;
  edges.push(radius1);

  const radius2 = MeshBuilder.CreateLines(
    `rangeArcRadius2_${name}`,
    {
      points: [Vector3.Zero(), new Vector3(ecx * inner, ecy * inner, 0), new Vector3(ecx * outer, ecy * outer, 0)],
    },
    scene,
  );
  radius2.color = edgeColor;
  radius2.alpha = 0.45;
  radius2.renderingGroupId = RG_SHIP;
  radius2.isPickable = false;
  edges.push(radius2);

  return { fill, edges };
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

  const turrets = getShipClassSpec(ship.shipClass).turrets.map((mount, index) => {
    const restAngle = mount.facing === "aft" ? Math.PI : 0;
    return createTurret(
      `${ship.name}_${index}`,
      mesh,
      scene,
      mount.offsetRatio * ship.len * shipSize,
      mount.scale,
      turretWorldSize,
      turretMaterial,
      restAngle,
    );
  });

  // 射程扇形：选中时显示每门炮 1 秒内可转到的扇形区域
  const cannonRange = getWeaponSpec("shell").range;
  const rangeArcs = getShipClassSpec(ship.shipClass).turrets.map((_mount, index) =>
    createRangeArc(`${ship.name}_arc_${index}`, scene, cannonRange, P.turretTurnRate),
  );

  return {
    mesh,
    material: mesh.material as StandardMaterial,
    texture,
    hud,
    ring,
    line: null,
    turrets,
    turretMaterial,
    turretTexture,
    shipSize,
    rangeArcs,
  };
}

// 每帧同步炮塔：交战时所有炮塔跟随瞄准角，非交战时回到各自的停靠朝向；开火时沿炮管方向后坐
export function syncShipTurrets(visual: ShipVisual, ship: Ship): void {
  const aiming = ship.aimOrder !== null || ship.target?.alive === true;
  const aimRotation = -(ship.aimAngle - ship.angle);
  for (let i = 0; i < visual.turrets.length; i++) {
    const turret = visual.turrets[i];
    turret.pivot.rotation.z = aiming ? aimRotation : turret.restAngle;
    // 逐门开火时只有当前炮塔后坐；整船 recoil 仍用于鱼雷 / 手动演示
    const kick = Math.max(ship.recoil, ship.turretRecoil[i] ?? 0);
    turret.mesh.position.x = -kick * TURRET_KICK * turret.scale * visual.shipSize;
  }
}

// 同步射程弧：仅选中时显示，每帧把弧移到炮塔世界坐标并朝向当前 aimAngle。
// oxlint-disable-next-line complexity
function syncRangeArcs(visual: ShipVisual, ship: Ship, selected: boolean): void {
  for (let i = 0; i < visual.rangeArcs.length; i++) {
    const arc = visual.rangeArcs[i];
    if (!selected) {
      arc.fill.setEnabled(false);
      for (const edge of arc.edges) edge.setEnabled(false);
      continue;
    }

    const from = ship.turretPosition(i);
    const center = worldToScene(from.x, from.y);
    arc.fill.position.copyFrom(center);
    for (const edge of arc.edges) edge.position.copyFrom(center);

    // 游戏坐标 Y 向下，Babylon 坐标 Y 向上，aimAngle 需要取反才是场景里的朝向
    arc.fill.rotation.z = -ship.aimAngle;
    for (const edge of arc.edges) edge.rotation.z = -ship.aimAngle;

    arc.fill.setEnabled(true);
    for (const edge of arc.edges) edge.setEnabled(true);
  }
}

// 释放射程弧
export function disposeShipRangeArcs(visual: ShipVisual): void {
  for (const arc of visual.rangeArcs) {
    arc.fill.dispose();
    for (const edge of arc.edges) edge.dispose();
  }
  visual.rangeArcs.length = 0;
}

// 释放炮塔：pivot.dispose() 会连同子 Mesh 一起销毁，材质/贴图为所有炮塔共用，只释放一次
export function disposeShipTurrets(visual: ShipVisual): void {
  for (const turret of visual.turrets) turret.pivot.dispose();
  visual.turrets.length = 0;
  visual.turretMaterial.dispose();
  visual.turretTexture.dispose();
  disposeShipRangeArcs(visual);
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

/**
 * 把单艘舰船的运行状态同步到可视对象：
 * 显示/隐藏、选中圈、航行导航线、位置朝向、命中闪白、炮塔、头顶 HUD。
 * 主游戏（game/render）与 playground（TestShip）共用，避免两套逐行重复的同步逻辑。
 */
export function syncShipVisual(ship: Ship, visual: ShipVisual, selected: boolean, scene: Scene): void {
  const alive = ship.alive;
  visual.mesh.setEnabled(alive);
  visual.hud.setVisible(alive);
  visual.ring.mesh.setEnabled(alive && selected);
  if (!alive) {
    // 船已阵亡：导航虚线和射程扇形必须一起清掉，否则会残留在海面上
    disposeNavLine(visual);
    for (const arc of visual.rangeArcs) {
      arc.fill.setEnabled(false);
      for (const edge of arc.edges) edge.setEnabled(false);
    }
    return;
  }

  // 航行导航虚线：仅选中且有航行目标时显示，每帧重新计算不残留旧点
  if (selected) updateShipNavigationLine(visual, ship, scene);
  else disposeNavLine(visual);

  visual.mesh.position.copyFrom(worldToScene(ship.x, ship.y));
  visual.mesh.rotation.z = -ship.angle;
  visual.ring.mesh.position.copyFrom(worldToScene(ship.x, ship.y));

  const flash = 1 + ship.hitFlash * 0.9;
  visual.material.emissiveColor.set(flash, flash, flash);
  visual.turretMaterial.emissiveColor.set(flash, flash, flash);

  // 炮塔转向 / 后坐只改变换，舰体贴图创建后不再重绘
  syncShipTurrets(visual, ship);

  // 选中时显示每门炮的射程弧（1秒可转区域）
  syncRangeArcs(visual, ship, selected);

  visual.hud.sync(ship);
}
