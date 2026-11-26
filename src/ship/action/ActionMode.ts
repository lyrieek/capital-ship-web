// 行动模式抽象：模式只输出「期望航向 + 相对巡航的速度倍率」，
// 具体舵角、加减速、地形预避让和边界处理由 locomotion 统一执行；ActionMode 不拥有坐标写权限。
//
// 控制优先级（从高到低）：
//   玩家手动航行指令 > 鱼雷规避 > ActionMode > 默认巡航
import type { Ship } from "../ship";

export interface ActionIntent {
  /** 期望航向（弧度） */
  heading: number;
  /** 相对本舰巡航速度的倍率；小型舰由 ship.speedMin/speedMax 限制在 0.7~1.6 */
  speedFactor: number;
}

export abstract class ActionMode {
  /** 当前锁定的目标，供开火逻辑复用；由子类维护 */
  target: Ship | null = null;
  /** 模式名，调试 / 日志用 */
  abstract readonly name: string;

  /** 每帧决策；heading 是战术意图，执行时会转换为 ±90° 内的相对舵角，不直接移动舰船。 */
  abstract update(ship: Ship, dt: number): ActionIntent;

  /**
   * 鱼雷成功发射后的通知。
   * 鱼雷齐射会持续推进，舰种可以借此切换到「打了就跑」等后续阶段。
   */
  // oxlint-disable-next-line class-methods-use-this
  onTorpedoLaunched(_ship: Ship): void {
    // 默认不响应
  }

  /** 玩家手动指令 / 重生时清空内部状态 */
  reset(): void {
    this.target = null;
  }
}
