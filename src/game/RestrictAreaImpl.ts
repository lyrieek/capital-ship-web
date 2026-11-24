// 行动限制区（游戏层实现）：在地图层 RestrictArea 的基础上加入可绘制、可校验的战场行为。
//
// 职责：
//   1. 画限制区虚线框；
//   2. 校验船是否越界、是否落在岛礁 / 建筑上；
//   3. 把边界写回舰船，供移动 clamp 使用；
//   4. 在限制区内自动摆船。
//
// 边界、阵营、出生点等静态数据由地图层 RestrictArea 统一校验并持有；
// 这里只保留运行期状态（enabled / 虚线框 / 地形占用判定）。
import { Color3, MeshBuilder, type LinesMesh, type Scene } from "@babylonjs/core";
import { clamp } from "./utils";
import { worldToScene } from "../babylon";
import { createShip } from "../ship/create-ship";
import { getTerrainField } from "../terrain";
import { MAP_TEAM_COLORS, type MapZone } from "../map/types";
import { RestrictArea } from "../map/RestrictArea";
import type { Ship, ShipConfig } from "../ship/ship";

// 限制区虚线框与 HUD 同组
const RG_HUD = 2;
// 自动摆船最多尝试多少次随机点；超出仍未找到空位就报错
const SPAWN_TRIES = 24;
// 摆船净空：约等于半舰长（100 / 2）+ 余量，避免船头插进沙滩
const SPAWN_CLEARANCE = 60;

// 出生集结带：靠己方中线一侧，避免大地图开局双方隔屏相望；
// Y 轴收拢到地图中部，保证交战能被相机同时拍到。
const SPAWN_BAND_X = 650;
const SPAWN_BAND_Y = 720;

// 默认的「不可放船」判定：查当前地物表。
// 独立成函数，playground 可以传入自己的判定而不改这里。
function defaultIsBlocked(x: number, y: number, radius: number): boolean {
  return getTerrainField()?.isBlockedCircle(x, y, radius) ?? false;
}

export class RestrictAreaImpl extends RestrictArea {
  /** 是否启用限制；取消后不再校验、也不再画框 */
  enabled: boolean;
  /** 限制区虚线框网格 */
  line: LinesMesh | null;
  /** 不可放船判定：以 (x, y) 为圆心、radius 为半径的圆是否压到陆地 */
  isBlocked: (x: number, y: number, radius: number) => boolean;

  constructor(zone: MapZone, enabled = true, isBlocked: (x: number, y: number, radius: number) => boolean = defaultIsBlocked) {
    super(zone);
    this.enabled = enabled;
    this.line = null;
    this.isBlocked = isBlocked;
  }

  // 画限制区虚线框：颜色跟随阵营并带透明度。
  // 密度按周长调整，避免大地图上出现超长虚线段。
  draw(scene: Scene): LinesMesh | null {
    if (!this.enabled) return null;
    if (this.line) return this.line;

    const points = [
      worldToScene(this.minX, this.minY),
      worldToScene(this.maxX, this.minY),
      worldToScene(this.maxX, this.maxY),
      worldToScene(this.minX, this.maxY),
      worldToScene(this.minX, this.minY),
    ];
    const perimeter = 2 * (this.width + this.height);
    const dashNb = clamp(Math.round(perimeter / 60), 48, 600);
    this.line = MeshBuilder.CreateDashedLines(`restrictArea_${this.id}`, { points, dashNb, gapSize: 3, dashSize: 4 }, scene);
    this.line.renderingGroupId = RG_HUD;
    this.line.isPickable = false;
    // LinesMesh 自带 color / alpha，不必再挂 StandardMaterial
    this.line.color = Color3.FromHexString(MAP_TEAM_COLORS[this.team]);
    this.line.alpha = 0.35;
    return this.line;
  }

  // 校验船位置：越界或压在岛礁 / 建筑上时返回错误信息，由调用方决定如何提示。
  // 这里只查船心：航行中的贴岸由碰撞系统负责，用整条船判定会把正常贴岸误判成搁浅。
  validate(ship: Ship): string | null {
    if (!this.enabled) return null;
    if (!this.contains(ship.x, ship.y)) {
      return `[RestrictArea] 船 "${ship.name}" 位置 (${ship.x}, ${ship.y}) 超出限制区域 [${this.minX},${this.maxX}] x [${this.minY},${this.maxY}]`;
    }
    if (this.isBlocked(ship.x, ship.y, 0)) {
      return `[RestrictArea] 船 "${ship.name}" 位置 (${ship.x}, ${ship.y}) 落在岛礁 / 建筑上`;
    }
    return null;
  }

  // 把边界写回舰船，供移动逻辑 clamp
  applyTo(ship: Ship): void {
    if (!this.enabled) return;
    ship.minX = this.minX;
    ship.maxX = this.maxX;
  }

  // 在本队集结带内随机找一个不被地物占用的点。
  // 反复随机而不是「发现岛就挪开」，是因为集结带可能整片被占住，需要多次尝试确认。
  pickFreeSpot(): { x: number; y: number } | null {
    const band = Math.min(SPAWN_BAND_X, this.width);
    const bandY = Math.min(SPAWN_BAND_Y, this.height);
    const centerY = this.center.y;
    for (let i = 0; i < SPAWN_TRIES; i++) {
      const x = this.team === "red" ? this.maxX - Math.random() * band : this.minX + Math.random() * band;
      const y = centerY + (Math.random() - 0.5) * bandY;
      if (!this.isBlocked(x, y, SPAWN_CLEARANCE)) return { x, y };
    }
    return null;
  }

  // 自动在限制区内摆放一艘船：未指定的 x/y 随机分配，缺省朝向按阵营。
  createShip(cfg: ShipConfig): Ship {
    const ship = createShip(cfg);
    if (cfg.x === undefined || cfg.y === undefined) {
      const spot = this.pickFreeSpot();
      if (!spot) {
        throw new Error(`[RestrictArea] 队伍 "${this.team}" 在限制区内找不到不被地物占用的空位（尝试 ${SPAWN_TRIES} 次）`);
      }
      if (cfg.x === undefined) ship.x = spot.x;
      if (cfg.y === undefined) ship.y = spot.y;
    }
    if (cfg.dir === undefined) {
      ship.dir = this.team === "red" ? 1 : -1;
    }
    if (cfg.baseY === undefined) {
      ship.baseY = ship.y;
    }
    const error = this.validate(ship);
    if (error) throw new Error(error);
    this.applyTo(ship);
    return ship;
  }

  /** 取消限制：销毁虚线框，后续不再限制船位置 */
  cancel(): void {
    this.enabled = false;
    if (this.line) {
      this.line.dispose();
      this.line = null;
    }
  }

  dispose(): void {
    this.cancel();
  }
}
