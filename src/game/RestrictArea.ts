// 行动限制区域：先按地图定义限制区，再摆放船。
// RestrictArea 负责画虚线框、验证船位置是否在范围内、以及战斗运行中取消限制。
//
// 摆船时必须避开地物（岛屿 / 礁石 / 建筑）：
// 船一旦出生在岛上，既动不了也打不中，渲染层还会因为「位置在陆地」拒绝画这条船并弹错误框。
// 所以这里在随机分配 x/y 时会重试，并且 validate() 会把「落在地物上」当成越界错误。
//
// 注意「船心」和「船身」是两件事：
// 碰撞半径只保证船心不在岛上，船是 100 长的，船头照样会插进沙滩（穿模）。
// 所以 pickFreeSpot() 传的是 SPAWN_CLEARANCE（半舰长 + 余量），保证整条船都在水面上。
import { Color3, MeshBuilder, type LinesMesh, type Scene } from "@babylonjs/core";
import { P, W, clamp } from "./utils";
import { worldToScene } from "../babylon";
import { createShip } from "../ship/create-ship";
import { getTerrainField } from "../terrain";
import type { Ship, ShipConfig } from "../ship/ship";

// 渲染分组：与 HUD 同组
const RG_HUD = 2;
// 自动摆船时最多尝试多少次随机点；超出还没找到空位就报错
const SPAWN_TRIES = 24;
// 摆船时额外留出的净空：约等于半舰长（100 / 2）加一点余量。
// 只检查船心会让船头插进岛里，这里把整条船都算进去。
const SPAWN_CLEARANCE = 60;

export interface RestrictAreaBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// 按阵营划分的默认 X 轴行动边界（红方左半区、蓝方右半区）。
// 地图放大后边界按比例换算：边缘留 4% 海图宽度，中线两侧留 1.2% 无人缓冲带。
const RESTRICT_MARGIN_X = Math.round(W * 0.04);
const RESTRICT_GAP_X = Math.round(W * 0.012);
const TEAM_BOUNDS: Record<"red" | "blue", { minX: number; maxX: number }> = {
  red: { minX: RESTRICT_MARGIN_X, maxX: W / 2 - RESTRICT_GAP_X / 2 },
  blue: { minX: W / 2 + RESTRICT_GAP_X / 2, maxX: W - RESTRICT_MARGIN_X },
};

// 按阵营的虚线颜色
const TEAM_COLORS: Record<"red" | "blue", string> = {
  red: "#ff7b6b",
  blue: "#7cc4ff",
};

// 自动摆船的前沿集结带：靠己方中线一侧出生，避免大地图开局双方隔屏相望；
// Y 轴也收拢到视口可覆盖的中央带，保证交战能被相机同时拍到。
const SPAWN_BAND_X = 650;
const SPAWN_BAND_Y = 720;

// 默认的「不可放船」判定：查当前地物表。
// 单独抽成函数是为了让 RestrictArea 的调用点（Game.ts / render.ts / playground）都不用改。
function defaultIsBlocked(x: number, y: number, radius: number): boolean {
  return getTerrainField()?.isBlockedCircle(x, y, radius) ?? false;
}

// 获取指定阵营的默认行动区域边界（X 轴，Y 轴沿用 P.yMin/P.yMax）
export function getTeamRestrictBounds(team: "red" | "blue"): RestrictAreaBounds {
  const b = TEAM_BOUNDS[team];
  return { minX: b.minX, maxX: b.maxX, minY: P.yMin, maxY: P.yMax };
}

// 获取指定阵营的虚线颜色
export function getTeamRestrictColor(team: "red" | "blue"): string {
  return TEAM_COLORS[team];
}

export class RestrictArea {
  // 限制区边界
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  // 所属阵营，用于确定虚线颜色
  team: "red" | "blue";
  // 是否启用限制；设为 false 后可完全取消限制（战斗运行中可调用 cancel()）
  enabled: boolean;
  // 限制区虚线框网格
  line: LinesMesh | null;
  // 不可放船的判定：返回 true 表示以 (x, y) 为圆心、radius 为半径的圆压到了陆地。
  // 默认查全局地物表（岛屿 / 礁石 / 建筑），playground 可以传入自己的判定。
  isBlocked: (x: number, y: number, radius: number) => boolean;

  constructor(
    bounds: RestrictAreaBounds,
    team: "red" | "blue",
    enabled = true,
    isBlocked: (x: number, y: number, radius: number) => boolean = defaultIsBlocked,
  ) {
    this.minX = bounds.minX;
    this.maxX = bounds.maxX;
    this.minY = bounds.minY;
    this.maxY = bounds.maxY;
    this.team = team;
    this.enabled = enabled;
    this.line = null;
    this.isBlocked = isBlocked;
  }

  // 画限制区虚线框：四条虚线围成矩形，颜色跟随阵营并带透明度
  draw(scene: Scene): LinesMesh | null {
    if (!this.enabled) return null;
    if (this.line) return this.line;

    // 同组内的高度统一为 0：压在海面之上靠渲染分组，不靠世界 Z 偏移
    const points = [
      worldToScene(this.minX, this.minY),
      worldToScene(this.maxX, this.minY),
      worldToScene(this.maxX, this.maxY),
      worldToScene(this.minX, this.maxY),
      worldToScene(this.minX, this.minY),
    ];

    // 虚线密度跟随限制区周长，避免大地图上出现超长虚线段
    const perimeter = 2 * (this.maxX - this.minX + this.maxY - this.minY);
    const dashNb = clamp(Math.round(perimeter / 60), 48, 600);
    this.line = MeshBuilder.CreateDashedLines(`restrictArea_${this.team}`, { points, dashNb, gapSize: 3, dashSize: 4 }, scene);
    this.line.renderingGroupId = RG_HUD;
    this.line.isPickable = false;
    // LinesMesh 自带 color / alpha，直接设置即可，不必再挂一份 StandardMaterial
    this.line.color = Color3.FromHexString(TEAM_COLORS[this.team]);
    this.line.alpha = 0.35;

    return this.line;
  }

  // 验证船位置是否在限制区内；不在则返回错误信息，由调用方决定如何提示（如弹 modal）
  validate(ship: Ship): string | null {
    if (!this.enabled) return null;
    if (ship.x < this.minX || ship.x > this.maxX || ship.y < this.minY || ship.y > this.maxY) {
      return `[RestrictArea] 船 "${ship.name}" 位置 (${ship.x}, ${ship.y}) 超出限制区域 [${this.minX},${this.maxX}] x [${this.minY},${this.maxY}]`;
    }
    // 岛礁 / 建筑不可占用：船停在岛上等于搁浅，后续移动和索敌都会出错。
    // 这里只查船心（radius = 0）：航行时的贴岸由 Babylon 碰撞负责，
    // 船心贴到岸边是正常的，用整条船去判定反而会把正常贴岸的船判成搁浅。
    if (this.isBlocked(ship.x, ship.y, 0)) {
      return `[RestrictArea] 船 "${ship.name}" 位置 (${ship.x}, ${ship.y}) 落在岛礁 / 建筑上`;
    }
    return null;
  }

  // 将限制区边界应用到船上（供碰撞 clamp 使用）
  applyTo(ship: Ship): void {
    if (!this.enabled) return;
    ship.minX = this.minX;
    ship.maxX = this.maxX;
  }

  // 在本队的集结带内随机找一个不被地物占用的点。
  // 反复随机而不是「找到岛就挪开」，是因为集结带可能整片被岛占住，
  // 需要多次尝试才能确认是真的没有空位。
  pickFreeSpot(): { x: number; y: number } | null {
    const band = Math.min(SPAWN_BAND_X, this.maxX - this.minX);
    const bandY = Math.min(SPAWN_BAND_Y, this.maxY - this.minY);
    const centerY = (this.minY + this.maxY) / 2;
    for (let i = 0; i < SPAWN_TRIES; i++) {
      const x = this.team === "red" ? this.maxX - Math.random() * band : this.minX + Math.random() * band;
      const y = centerY + (Math.random() - 0.5) * bandY;
      // 用 SPAWN_CLEARANCE 而不是 0：船头船尾也要在水面上，不能只保证船心不压到岛
      if (!this.isBlocked(x, y, SPAWN_CLEARANCE)) return { x, y };
    }
    return null;
  }

  // 自动在限制区内摆放一艘船：分配 x/y/dir，缺省按阵营朝向
  // 传入的 cfg 可省略 x/y/dir，由本限制区随机分配；已指定的则保留并做越界校验
  createShip(cfg: ShipConfig): Ship {
    const ship = createShip(cfg);
    // 自动分配未指定的 x/y；这里必须避开岛礁，否则船会直接出生在岛上
    if (cfg.x === undefined || cfg.y === undefined) {
      const spot = this.pickFreeSpot();
      if (!spot) {
        throw new Error(`[RestrictArea] 队伍 "${this.team}" 在限制区内找不到不被地物占用的空位（尝试 ${SPAWN_TRIES} 次）`);
      }
      if (cfg.x === undefined) ship.x = spot.x;
      if (cfg.y === undefined) ship.y = spot.y;
    }
    // 缺省按阵营朝向
    if (cfg.dir === undefined) {
      ship.dir = this.team === "red" ? 1 : -1;
    }
    // 基准Y坐标缺省等于 y
    if (cfg.baseY === undefined) {
      ship.baseY = ship.y;
    }
    // 校验位置在限制区内、且不在地物上，越界则拒绝
    const err = this.validate(ship);
    if (err) throw new Error(err);
    this.applyTo(ship);
    return ship;
  }

  // 取消限制区（战斗运行中可调用）：销毁虚线框，后续不再限制船位置
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
