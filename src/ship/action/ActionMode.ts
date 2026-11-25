// 行动模式抽象：模式只输出「期望航向 + 相对巡航的速度倍率」，
// 具体转向、加减速、地形预避让和边界处理由 locomotion 统一执行。
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

  /** 每帧决策；只返回意图，不直接改坐标 */
  abstract update(ship: Ship, dt: number): ActionIntent;

  /** 玩家手动指令 / 重生时清空内部状态 */
  reset(): void {
    this.target = null;
  }
}
