// 武器弹药的数据结构
// 从游戏逻辑层抽离成独立模块：主场景直接使用，playground 里也能单独调试。
// 这里只描述「数据」，不依赖游戏层类型，方便独立复用。
import type { Curve2 } from "./trajectory";

/**
 * 武器大类（抽象层）：描述“这是什么武器”，不绑定具体型号。
 * 游戏逻辑（地形阻挡、规避判定等）优先按大类判断，
 * 以后新增同大类的具体型号时不需要改逻辑代码。
 *
 * 目前只实现 cannon（主炮）与 torpedo（鱼雷）；
 * smoke / mine / depthCharge 只做类型占位，具体型号与行为留待后续实现。
 */
export type WeaponKind = "cannon" | "torpedo" | "smoke" | "mine" | "depthCharge";

/** 具体武器型号 id：shell-主炮炮弹，torp-鱼雷。以后可继续增加具体型号。 */
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
  /** 具体武器型号 id */
  type: ProjectileType;
  /** 武器大类：通用逻辑只看它，不依赖具体型号 */
  kind: WeaponKind;
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
  /** 发射瞬间发射者到瞄准点的距离（结算死因时用来判定远近） */
  shotDistance: number;
  /** 轨迹点坐标列表 [x1,y1,x2,y2,...] */
  trail: number[];
  /** 是否已标记为删除 */
  dead?: boolean;
  /**
   * 未命中淡出剩余比例：1 = 完全可见，0 = 完全消失。
   * undefined 表示正常飞行；鱼雷到达最大射程后不再爆炸，而是靠它淡出。
   */
  fade?: number;
  /** 弹道参数（所有弹药都用曲线描述，弯曲度为 0 时即为直线） */
  arc: ArcFlight;
}
