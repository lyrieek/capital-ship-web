// 武器弹药的数据结构
// 从游戏逻辑层抽离成独立模块：主场景直接使用，playground 里也能单独调试。
// 这里只描述「数据」，不依赖游戏层类型，方便独立复用。
import type { Curve2 } from "./trajectory";

/** 弹药类型：shell-炮弹（主炮），torp-鱼雷 */
export type ProjectileType = "shell" | "torp";

/** 发射者：只需要位置与速度，舰船和调试用的假发射平台都满足 */
export interface ProjectileOwner {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** 命中目标：舰船等可受击对象 */
export interface ProjectileTarget extends ProjectileOwner {
  /** 剩余生命值 */
  hp: number;
  /** 碰撞盒长度 */
  len: number;
  /** 碰撞盒宽度 */
  wid: number;
  /** 受到伤害 */
  takeDamage(dmg: number): void;
}

/** 曲射弹道状态：炮弹沿贝塞尔曲线飞行 */
export interface ArcFlight {
  /** 贝塞尔曲线（起点 / 控制点 / 终点） */
  curve: Curve2;
  /** 飞行进度 0..1 */
  t: number;
  /** 整段飞行时长（秒） */
  duration: number;
}

/** 武器弹药 */
export interface Projectile {
  /** 弹药类型 */
  type: ProjectileType;
  /** 发射者 */
  owner: ProjectileOwner;
  /** X坐标 */
  x: number;
  /** Y坐标 */
  y: number;
  /** X方向速度（曲射时为曲线切线的瞬时速度） */
  vx: number;
  /** Y方向速度 */
  vy: number;
  /** 碰撞半径 */
  r: number;
  /** 伤害值 */
  dmg: number;
  /** 剩余生命时间 */
  life: number;
  /** 轨迹点坐标列表 [x1,y1,x2,y2,...] */
  trail: number[];
  /** 是否已标记为删除 */
  dead?: boolean;
  /** 弹道参数（所有弹药都用曲线描述，弯曲度为 0 时即为直线） */
  arc: ArcFlight;
}
