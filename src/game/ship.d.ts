// 弹药结构定义在 src/weapons
import type { Projectile } from "../weapons";

export interface ShipConfig {
  // X坐标
  x: number;
  // Y坐标
  y: number;
  // 最小X坐标（左边界）
  minX: number;
  // 最大X坐标（右边界）
  maxX: number;
  // 航向方向：1-右，-1-左
  dir: 1 | -1;
  // 舰船亮侧颜色
  light: string;
  // 舰船暗侧颜色
  dark: string;
  // 舰船名称
  name: string;
  // 舰船所属阵营：red-红方，blue-蓝方
  team: "red" | "blue";
  // 基准Y坐标（用于规避和回正）
  baseY: number;
}

export interface Ship extends ShipConfig {
  // 当前生命值
  hp: number;
  // 最大生命值
  maxHp: number;
  // 舰船长度
  len: number;
  // 舰船宽度
  wid: number;
  // 基准角度（朝向）
  angle: number;
  /**
   * 舰船状态
   * normal-正常，dodge-规避，recover-回正
   */
  state: "normal" | "dodge" | "recover";
  // 状态计时器
  stateT: number;
  // 规避计时器
  dodgeT: number;
  // 规避方向：1-上，-1-下
  dodgeSide: 1 | -1;
  // X方向速度
  vx: number;
  // Y方向速度
  vy: number;
  // 主炮冷却时间
  gunCD: number;
  // 鱼雷冷却时间
  torpCD: number;
  // 被击闪白效果
  hitFlash: number;
  // 后坐力效果
  recoil: number;

  // 是否存活（hp>0）
  get alive(): boolean;
  // 查找最近的敌方舰船
  findTarget(): Ship | null;
  // 查找来袭威胁（炮弹/鱼雷）
  findThreat(): ThreatItem | null;
  // 开始规避机动
  startDodge(th: ThreatItem): void;
  // 更新舰船状态
  update(dt: number): void;
  // 受到伤害
  takeDamage(dmg: number): void;
}

export interface ThreatItem {
  t: number;
  p: Projectile;
  miss: number;
}
