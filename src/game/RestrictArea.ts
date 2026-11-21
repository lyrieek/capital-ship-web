// 行动限制区域：先按地图定义限制区，再摆放船。
// RestrictArea 负责画虚线框、验证船位置是否在范围内、以及战斗运行中取消限制。
import { Color3, MeshBuilder, StandardMaterial, type Mesh, type Scene } from "@babylonjs/core";
import { P, W } from "./utils";
import { worldToScene } from "../babylon";
import { createShip } from "../ship/create-ship";
import type { Ship, ShipConfig } from "../ship/ship";

// 渲染分组：与 HUD 同组
const RG_HUD = 2;
// 限制区虚线框的 Z 层：贴在海面之上
const RESTRICT_Z = -0.5;

export interface RestrictAreaBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// 按阵营划分的默认 X 轴行动边界（红方左半区、蓝方右半区），中间留 10px 间隙
const RESTRICT_GAP_X = 10;
const TEAM_BOUNDS: Record<"red" | "blue", { minX: number; maxX: number }> = {
  red: { minX: 70, maxX: W / 2 - RESTRICT_GAP_X / 2 },
  blue: { minX: W / 2 + RESTRICT_GAP_X / 2, maxX: W - 70 },
};

// 按阵营的虚线颜色
const TEAM_COLORS: Record<"red" | "blue", string> = {
  red: "#ff7b6b",
  blue: "#7cc4ff",
};

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
  line: Mesh | null;

  constructor(bounds: RestrictAreaBounds, team: "red" | "blue", enabled = true) {
    this.minX = bounds.minX;
    this.maxX = bounds.maxX;
    this.minY = bounds.minY;
    this.maxY = bounds.maxY;
    this.team = team;
    this.enabled = enabled;
    this.line = null;
  }

  // 画限制区虚线框：四条虚线围成矩形，颜色跟随阵营并带透明度
  draw(scene: Scene): Mesh | null {
    if (!this.enabled) return null;
    if (this.line) return this.line;

    const points = [
      worldToScene(this.minX, this.minY, RESTRICT_Z),
      worldToScene(this.maxX, this.minY, RESTRICT_Z),
      worldToScene(this.maxX, this.maxY, RESTRICT_Z),
      worldToScene(this.minX, this.maxY, RESTRICT_Z),
      worldToScene(this.minX, this.minY, RESTRICT_Z),
    ];

    this.line = MeshBuilder.CreateDashedLines(`restrictArea_${this.team}`, { points, dashNb: 48, gapSize: 3, dashSize: 4 }, scene);
    this.line.renderingGroupId = RG_HUD;
    this.line.isPickable = false;

    const material = new StandardMaterial(`restrictAreaMaterial_${this.team}`, scene);
    const color = Color3.FromHexString(TEAM_COLORS[this.team]);
    material.diffuseColor = color;
    material.emissiveColor = color;
    material.alpha = 0.35;
    this.line.material = material;

    return this.line;
  }

  // 验证船位置是否在限制区内；不在则返回错误信息，由调用方决定如何提示（如弹 modal）
  validate(ship: Ship): string | null {
    if (!this.enabled) return null;
    if (ship.x < this.minX || ship.x > this.maxX || ship.y < this.minY || ship.y > this.maxY) {
      return `[RestrictArea] 船 "${ship.name}" 位置 (${ship.x}, ${ship.y}) 超出限制区域 [${this.minX},${this.maxX}] x [${this.minY},${this.maxY}]`;
    }
    return null;
  }

  // 将限制区边界应用到船上（供碰撞 clamp 使用）
  applyTo(ship: Ship): void {
    if (!this.enabled) return;
    ship.minX = this.minX;
    ship.maxX = this.maxX;
  }

  // 自动在限制区内摆放一艘船：分配 x/y/dir，缺省按阵营朝向
  // 传入的 cfg 可省略 x/y/dir，由本限制区随机分配；已指定的则保留并做越界校验
  createShip(cfg: ShipConfig): Ship {
    const ship = createShip(cfg);
    // 自动分配未指定的 x/y/dir
    if (cfg.x === undefined) {
      ship.x = this.minX + Math.random() * (this.maxX - this.minX);
    }
    if (cfg.y === undefined) {
      ship.y = this.minY + Math.random() * (this.maxY - this.minY);
    }
    if (cfg.dir === undefined) {
      ship.dir = this.team === "red" ? 1 : -1;
    }
    // 基准Y坐标缺省等于 y
    if (cfg.baseY === undefined) {
      ship.baseY = ship.y;
    }
    // 校验位置在限制区内，越界则拒绝
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
