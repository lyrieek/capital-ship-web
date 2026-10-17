import type { Ship } from "./ship.d";

// Game types and interfaces
export interface Vector2 {
  x: number;
  y: number;
}
export interface MovingPoint {
  x: number;
  y: number;
  // X方向速度
  vx: number;
  // Y方向速度
  vy: number;
}

export interface Projectile extends MovingPoint {
  // 弹药类型：shell-炮弹，torp-鱼雷
  type: "shell" | "torp";
  // 发射该弹药的舰船
  owner: Ship;
  // 碰撞半径
  r: number;
  // 伤害值
  dmg: number;
  // 剩余生命时间
  life: number;
  // 轨迹点坐标列表 [x1,y1,x2,y2,...]
  trail: number[];
  // 是否已标记为删除
  dead?: boolean;
}

export interface ParticleItem extends MovingPoint {
  // 剩余生命时间
  life: number;
  // 最大生命时间
  maxLife: number;
  // 粒子大小
  size: number;
  // 粒子颜色
  color: string;
}

export interface GameState {
  // 所有舰船列表
  ships: Ship[];
  // 所有炮弹/鱼雷列表
  projectiles: Projectile[];
  // 所有粒子效果列表
  particles: ParticleItem[];
  // 游戏运行时间（秒）
  time: number;
  // 游戏是否结束
  over: boolean;
  // 获胜阵营：red-红方，blue-蓝方，null-平局
  winnerTeam: "red" | "blue" | null;

  // 重置游戏到初始状态
  reset(): void;

  /**
   * 发射主炮
   * @param ship: 发射舰船, target: 目标舰船
   */
  fireShell(ship: Ship, target: Ship): void;

  /**
   * 发射鱼雷
   * @param ship: 发射舰船, target: 目标舰船
   */
  fireTorpedo(ship: Ship, target: Ship): void;

  /**
   * 产生爆炸效果
   * @param x, y: 爆炸中心坐标, n: 粒子数量, color: 粒子颜色
   */
  burst(x: number, y: number, n: number, color: string): void;

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
   * 更新所有粒子效果状态
   * @param dt: 时间增量（秒）
   */
  updateParticles(dt: number): void;

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
