import type { Ship } from "../ship/ship";
// 弹药结构已抽离到 src/weapons（游戏层只引用，不重复定义）
import type { Projectile } from "../weapons";
import type { BattleRecord } from "./BattleRecord";

// Game types and interfaces
export interface Vector2 {
  x: number;
  y: number;
}

export interface GameState {
  // 所有舰船列表
  ships: Ship[];
  // 所有炮弹/鱼雷列表
  projectiles: Projectile[];
  // 游戏运行时间（秒）
  time: number;
  // 游戏是否结束
  over: boolean;
  // 阵营首次被全歼后的结束倒计时（秒）
  endTimer: number | null;
  // 获胜阵营：red-红方，blue-蓝方，null-平局
  winnerTeam: "red" | "blue" | null;
  // 手动齐射剩余冷却时间（秒）
  manualFireCD: number;
  // 本局战斗记录（存活时间 / 死亡原因 / 杀敌数）
  record: BattleRecord;

  // 重置游戏到初始状态
  reset(): void;

  /**
   * 发射主炮
   * @param ship: 发射舰船, target: 目标舰船, from: 炮口所在舰体位置（缺省船心）
   */
  fireShell(ship: Ship, target: Ship, from?: { x: number; y: number }): void;

  /**
   * 向世界坐标点发射一发鱼雷
   * @param ship: 发射舰船, x: 目标点 X, y: 目标点 Y, shotIndex: 这一发在齐射中的序号
   */
  fireTorpedoAt(ship: Ship, x: number, y: number, shotIndex?: number): void;

  /**
   * 向世界坐标点开火主炮
   * @param ship: 发射舰船, x: 目标点 X, y: 目标点 Y, from: 炮口所在舰体位置（缺省船心）
   */
  fireShellAt(ship: Ship, x: number, y: number, from?: { x: number; y: number }): void;

  /**
   * 命令选中舰船向世界坐标点齐射（默认对准鼠标位置）
   * @param ships: 选中的舰船列表, x: 目标点 X 坐标, y: 目标点 Y 坐标
   */
  focusFireAt(ships: readonly Ship[], x: number, y: number): void;

  /**
   * 产生爆炸效果
   * @param x, y: 爆炸中心坐标, n: 粒子数量, color: 粒子颜色
   */
  burst(x: number, y: number, n: number, color: string): void;

  /** 在舰船位置产生上升烟雾 */
  smoke(x: number, y: number): void;

  /**
   * 处理舰船间碰撞（同舰互推开）
   */
  resolveCollisions(): void;

  /**
   * 更新所有炮弹/鱼雷状态
   * @param dt: 时间增量（秒）
   */
  updateProjectiles(dt: number): void;

  /**
   * 更新游戏主循环
   * @param dt: 时间增量（秒）
   */
  update(dt: number): void;

  /**
   * 渲染游戏画面
   */
  draw(): void;
}
