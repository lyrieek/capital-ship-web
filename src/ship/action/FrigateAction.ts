// 护卫舰行动模式：更保守的环绕炮战。
//
//   1. 交战距离比鱼雷艇更远（环绕半径约 850px），站在主炮射程边缘输出；
//   2. 全程注意与最近友舰的间距，保持在 250~550px 的「不近不远」区间；
//   3. 索敌时如果目标很远（>900px）且身边有友舰，有 70% 概率观望 5 秒：
//      期间在友舰附近游弋、不主动追击；目标逼近 / 队友受威胁 / 友舰走散时提前解除。
import type { Ship } from "../ship";
import { getGameInstance } from "../../game/Game";
import { SmallShipAction } from "./SmallShipAction";
import type { ActionIntent } from "./ActionMode";

// 与最近友舰的理想间距
const ALLY_MIN = 250;
const ALLY_MAX = 550;
// 索敌时至少要有这个距离内的友舰才考虑观望
const ALLY_SUPPORT = 550;
// 观望期间友舰走散到这个距离外就解除
const ALLY_LOST = 700;
// 队友附近出现这个距离内的敌舰，视为队友受威胁
const ALLY_THREAT_RADIUS = 600;

// 交战环绕半径：让实际交战距离大致落在 750~950
const ENGAGE_ORBIT_RADIUS = 850;
// 超过这个距离的目标才可能触发「观望」
const FAR_TARGET_DISTANCE = 900;
// 观望期间目标逼近到这个距离内就立刻接战
const HOLD_BREAK_DISTANCE = 800;
const HOLD_CHANCE = 0.7;
const HOLD_DURATION = 5;

// 观望时围绕友舰游弋
const LOITER_RADIUS = 400;
const LOITER_SPEED = 0.9;
// 与友舰距离修正最多占航向权重的比例
const SPACING_BLEND = 0.7;

export class FrigateAction extends SmallShipAction {
  readonly name = "frigate";

  private holdT = 0;
  /** 护卫舰保持更远的炮战距离；用实例字段满足覆写方法的 this 使用约定 */
  private readonly engageOrbitRadius = ENGAGE_ORBIT_RADIUS;

  reset(): void {
    super.reset();
    this.holdT = 0;
  }

  protected override orbitRadius(_ship: Ship): number {
    return this.engageOrbitRadius;
  }

  protected override onTargetChanged(ship: Ship): void {
    this.holdT = 0;
    const target = this.target;
    if (!target) return;
    if (Math.hypot(target.x - ship.x, target.y - ship.y) <= FAR_TARGET_DISTANCE) return;
    if (!FrigateAction.hasNearbyAlly(ship)) return;
    // 70% 概率：这 5 秒内不主动去追这个远处的敌人
    if (Math.random() < HOLD_CHANCE) this.holdT = HOLD_DURATION;
  }

  update(ship: Ship, dt: number): ActionIntent {
    if (this.holdT > 0) {
      if (!this.target?.alive || this.shouldBreakHold(ship)) {
        this.holdT = 0;
      } else {
        this.holdT = Math.max(0, this.holdT - dt);
        if (this.holdT > 0) return this.holdIntent(ship);
      }
    }

    const intent = super.update(ship, dt);
    // 基类本帧刚锁定一个远处目标并进入观望时，直接改用观望意图
    if (this.holdT > 0) return this.holdIntent(ship);
    return FrigateAction.applyAllySpacing(ship, intent);
  }

  /** 观望的提前解除条件：目标逼近、友舰走散、队友被咬 */
  private shouldBreakHold(ship: Ship): boolean {
    const target = this.target;
    if (!target) return true;
    if (Math.hypot(target.x - ship.x, target.y - ship.y) <= HOLD_BREAK_DISTANCE) return true;

    const game = getGameInstance();
    if (!game) return true;

    let hasAlly = false;
    for (const ally of game.ships) {
      if (!ally.alive || ally === ship || ally.team !== ship.team) continue;
      if (Math.hypot(ally.x - ship.x, ally.y - ship.y) <= ALLY_LOST) hasAlly = true;
      for (const enemy of game.ships) {
        if (!enemy.alive || enemy.team === ship.team) continue;
        if (Math.hypot(enemy.x - ally.x, enemy.y - ally.y) <= ALLY_THREAT_RADIUS) return true;
      }
    }
    return !hasAlly;
  }

  /** 观望时的机动：贴着最近友舰游弋，不主动靠近远处的敌人 */
  private holdIntent(ship: Ship): ActionIntent {
    const ally = FrigateAction.nearestAlly(ship);
    if (!ally) {
      this.holdT = 0;
      return SmallShipAction.searchIntent(ship);
    }

    ship.target = this.target;
    const distance = Math.hypot(ally.x - ship.x, ally.y - ship.y);
    const bearing = Math.atan2(ally.y - ship.y, ally.x - ship.x);

    if (distance > ALLY_MAX) return { heading: bearing, speedFactor: 1.2 };
    if (distance < ALLY_MIN) return { heading: bearing + Math.PI, speedFactor: 1.2 };
    return {
      heading: SmallShipAction.orbitHeadingForSide(bearing, distance, LOITER_RADIUS, this.orbitSide),
      speedFactor: LOITER_SPEED,
    };
  }

  /** 正常交战时，把越界的友舰间距修正混入行动模式的航向 */
  private static applyAllySpacing(ship: Ship, intent: ActionIntent): ActionIntent {
    const ally = FrigateAction.nearestAlly(ship);
    if (!ally) return intent;

    const distance = Math.hypot(ally.x - ship.x, ally.y - ship.y);
    let desired = intent.heading;
    let deviation = 0;
    if (distance < ALLY_MIN) {
      desired = Math.atan2(ship.y - ally.y, ship.x - ally.x);
      deviation = (ALLY_MIN - distance) / ALLY_MIN;
    } else if (distance > ALLY_MAX) {
      desired = Math.atan2(ally.y - ship.y, ally.x - ship.x);
      deviation = (distance - ALLY_MAX) / ALLY_MAX;
    } else {
      return intent;
    }

    const weight = Math.min(SPACING_BLEND, deviation * SPACING_BLEND);
    const hx = Math.cos(intent.heading) * (1 - weight) + Math.cos(desired) * weight;
    const hy = Math.sin(intent.heading) * (1 - weight) + Math.sin(desired) * weight;
    return { heading: Math.atan2(hy, hx), speedFactor: intent.speedFactor };
  }

  private static hasNearbyAlly(ship: Ship): boolean {
    const ally = FrigateAction.nearestAlly(ship);
    if (!ally) return false;
    return Math.hypot(ally.x - ship.x, ally.y - ship.y) <= ALLY_SUPPORT;
  }

  private static nearestAlly(ship: Ship): Ship | null {
    const game = getGameInstance();
    if (!game) return null;

    let nearest: Ship | null = null;
    let nearestDistance = Infinity;
    for (const other of game.ships) {
      if (!other.alive || other === ship || other.team !== ship.team) continue;
      const distance = Math.hypot(other.x - ship.x, other.y - ship.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = other;
      }
    }
    return nearest;
  }
}
