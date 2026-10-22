// 右键航行指令：先转向目标点，再沿航向行驶，到达后恢复原航线
import type { Ship } from "../ship/ship";
import { angleDiff, approachAngle, clamp, P } from "./utils";

// 进入这个距离后视为到达目标点
export const ARRIVE_RADIUS = 6;

// 给单艘舰船下达航行指令
export function issueSailOrder(ship: Ship, x: number, y: number): void {
  const targetY = clamp(y, P.yMin, P.yMax);
  ship.order = { x: clamp(x, ship.minX, ship.maxX), y: targetY };
  // 到达后以新的航线继续巡航
  ship.baseY = targetY;
  // 手动指令覆盖当前的规避/回正状态
  ship.state = "normal";
  ship.stateT = 0;
  ship.dodgeT = 0;
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
export function updateSailOrder(ship: Ship, dt: number): boolean {
  const order = ship.order;
  if (!order) return false;

  const dx = order.x - ship.x;
  const dy = order.y - ship.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= ARRIVE_RADIUS) {
    ship.x = order.x;
    ship.y = order.y;
    ship.order = null;
    ship.baseY = ship.y;
    ship.vx = 0;
    ship.vy = 0;
    return true;
  }

  const speed = P.moveSpeed * P.normalFactor;
  const desired = Math.atan2(dy, dx);
  ship.angle = approachAngle(ship.angle, desired, P.turnRate * dt);
  // 航向偏差大时先转体，避免直接横着平移过去
  const alignment = Math.max(0, Math.cos(angleDiff(ship.angle, desired)));
  ship.vx = Math.cos(ship.angle) * speed * alignment;
  ship.vy = Math.sin(ship.angle) * speed * alignment;
  ship.x = clamp(ship.x + ship.vx * dt, ship.minX, ship.maxX);
  ship.y = clamp(ship.y + ship.vy * dt, P.yMin, P.yMax);
  return true;
}
