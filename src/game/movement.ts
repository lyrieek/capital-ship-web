// 右键航行指令：先转向目标点，再沿航向行驶，到达后恢复行动模式。
import type { Ship, ShipMotionTarget } from "../ship/ship";
import { shipBounds } from "../ship/bounds";
import { clamp } from "./utils";
import { resetDriveMemory, steerToHeading } from "../ship/locomotion";

// 进入这个距离后视为到达目标点
export const ARRIVE_RADIUS = 6;

// 给单艘舰船下达航行指令
export function issueSailOrder(ship: Ship, x: number, y: number): void {
  const bounds = shipBounds(ship);
  const targetY = clamp(y, bounds.minY, bounds.maxY);
  ship.order = { x: clamp(x, bounds.minX, bounds.maxX), y: targetY };
  // 到达后以新的航线继续巡航
  ship.baseY = targetY;
  // 手动指令覆盖当前的规避/回正状态，并重置行动模式的内部状态；
  // 同时清掉转向疲劳 / 卡位计时，让玩家指令立即得到完整的转向响应。
  ship.state = "normal";
  ship.stateT = 0;
  ship.evasionT = 0;
  ship.target = null;
  ship.turnFatigue = 0;
  ship.stuckT = 0;
  ship.actionMode.reset();
  resetDriveMemory(ship);
}

// 给当前选中舰船统一下达航行指令
export function issueSelectionSail(ships: readonly Ship[], x: number, y: number): void {
  for (const ship of ships) {
    if (ship.alive) issueSailOrder(ship, x, y);
  }
}

/**
 * 推进航行指令
 * @returns true 表示这一帧由指令接管了移动
 */
export function updateSailOrder(ship: ShipMotionTarget, dt: number): boolean {
  const order = ship.order;
  if (!order) return false;

  const dx = order.x - ship.x;
  const dy = order.y - ship.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= ARRIVE_RADIUS) {
    ship.order = null;
    ship.baseY = ship.y;
    // 路点是导航意图，不是瞬移目标：停在到达半径内的当前位置，不吸附到任意 XY。
    ship.stopMotion();
    return true;
  }

  // 统一运动层：转向、地形预避让、边界 clamp 都在 driveShip 里处理；
  // alignSpeed 保留手动航行「航向偏差大时慢一点」的旧手感。
  steerToHeading(ship, Math.atan2(dy, dx), 1, dt, { alignSpeed: true, bounce: false });
  return true;
}
