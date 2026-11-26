// 鱼雷艇行动模式：平时沿用环绕炮战；附近以少打多时，打出一轮鱼雷后立刻脱离。
//
// 打了就跑：
//   1. 鱼雷成功发射时统计附近敌我数量，附近敌舰 ≥2 且多于附近友舰（含自己）才触发；
//   2. 立即朝远离最近敌舰的方向全速后撤，后撤阶段只允许舰尾炮还击；
//   3. 撤到敌方主炮射程外后，等鱼雷冷却完毕再绕回交战；
//      鱼雷没装填好时在射程边缘游弋，不主动回到敌炮火里。
import type { Ship } from "../ship";
import { getGameInstance } from "../../game/Game";
import { getWeaponSpec } from "../../weapons";
import { isHeadingOutOfBounds } from "../locomotion";
import { SmallShipAction } from "./SmallShipAction";
import type { ActionIntent } from "./ActionMode";

const SHELL_RANGE = getWeaponSpec("shell").range;
// 距离最近敌舰超过这个值就算撤出敌主炮射程（留 100px 余量）
const RETREAT_SAFE_DISTANCE = SHELL_RANGE + 100;
// 统计「附近」敌我的半径
const SCAN_RADIUS = 1000;
const RETREAT_SPEED = 1.6;
const RETREAT_TURN = (35 * Math.PI) / 180;
const BOUNDARY_LOOK_AHEAD = 240;
// 同速追击时可能一直拉不开距离，给后撤阶段一个兜底时限
const MAX_RETREAT_TIME = 8;
// 等待鱼雷装填时的游弋半径与速度
const WAIT_ORBIT_RADIUS = RETREAT_SAFE_DISTANCE + 100;
const WAIT_SPEED = 0.85;

type TorpedoBoatPhase = "normal" | "retreat" | "wait";

export class TorpedoBoatAction extends SmallShipAction {
  readonly name = "torpedo-boat";

  private mode: TorpedoBoatPhase = "normal";
  private retreatT = 0;

  reset(): void {
    super.reset();
    this.mode = "normal";
    this.retreatT = 0;
  }

  onTorpedoLaunched(ship: Ship): void {
    // 只有「附近敌多我少」才值得打完雷立刻脱离；普通 1v1 继续环绕炮战
    if (TorpedoBoatAction.isLocallyOutnumbered(ship)) {
      this.mode = "retreat";
      this.retreatT = 0;
    }
  }

  update(ship: Ship, dt: number): ActionIntent {
    if (this.mode === "retreat") return this.updateRetreat(ship, dt);
    if (this.mode === "wait") return this.updateWait(ship, dt);

    ship.gunMode = "all";
    return super.update(ship, dt);
  }

  /** 附近敌舰 ≥2 且多于附近友舰（含自己）才判定为「以少打多」 */
  private static isLocallyOutnumbered(ship: Ship): boolean {
    const game = getGameInstance();
    if (!game) return false;

    let enemies = 0;
    let friendlies = 0;
    for (const other of game.ships) {
      if (!other.alive) continue;
      if (Math.hypot(other.x - ship.x, other.y - ship.y) > SCAN_RADIUS) continue;
      if (other.team === ship.team) friendlies += 1;
      else enemies += 1;
    }
    return enemies >= 2 && enemies > friendlies;
  }

  private updateRetreat(ship: Ship, dt: number): ActionIntent {
    const enemy = TorpedoBoatAction.nearestEnemy(ship);
    if (!enemy) {
      this.mode = "normal";
      ship.gunMode = "all";
      return super.update(ship, dt);
    }

    this.retreatT += dt;
    const distance = Math.hypot(enemy.x - ship.x, enemy.y - ship.y);
    if (distance >= RETREAT_SAFE_DISTANCE || this.retreatT >= MAX_RETREAT_TIME) {
      ship.gunMode = "all";
      if (ship.torpCD <= 0) {
        this.mode = "normal";
        return this.resumeEngage(ship, dt);
      }
      this.mode = "wait";
      return this.updateWait(ship, dt);
    }

    // 后撤时保留目标，供舰尾炮塔还击
    this.target = enemy;
    ship.target = enemy;
    ship.gunMode = "aftOnly";
    return { heading: TorpedoBoatAction.retreatHeading(ship, enemy), speedFactor: RETREAT_SPEED };
  }

  private updateWait(ship: Ship, dt: number): ActionIntent {
    if (ship.torpCD <= 0) {
      this.mode = "normal";
      ship.gunMode = "all";
      return this.resumeEngage(ship, dt);
    }

    const enemy = TorpedoBoatAction.nearestEnemy(ship);
    if (!enemy) {
      this.mode = "normal";
      ship.gunMode = "all";
      return super.update(ship, dt);
    }

    const distance = Math.hypot(enemy.x - ship.x, enemy.y - ship.y);
    // 敌人压上来就重新拉开距离
    if (distance < RETREAT_SAFE_DISTANCE - 100) {
      this.mode = "retreat";
      this.retreatT = 0;
      return this.updateRetreat(ship, dt);
    }

    this.target = enemy;
    ship.target = enemy;
    ship.gunMode = "all";

    const bearing = Math.atan2(enemy.y - ship.y, enemy.x - ship.x);
    // 贴着安全距离外缘游弋，等鱼雷装填
    if (distance < RETREAT_SAFE_DISTANCE + 50) {
      return { heading: bearing + Math.PI, speedFactor: 1.2 };
    }
    const heading = SmallShipAction.orbitHeadingForSide(bearing, distance, WAIT_ORBIT_RADIUS, this.orbitSide);
    return { heading, speedFactor: WAIT_SPEED };
  }

  /** 回到正常交战：重置阶段，让基类重新走 approach → engage */
  private resumeEngage(ship: Ship, dt: number): ActionIntent {
    this.phase = "search";
    this.loopT = 0;
    return super.update(ship, dt);
  }

  private static nearestEnemy(ship: Ship): Ship | null {
    const game = getGameInstance();
    if (!game) return null;

    let nearest: Ship | null = null;
    let nearestDistance = Infinity;
    for (const other of game.ships) {
      if (!other.alive || other.team === ship.team) continue;
      const distance = Math.hypot(other.x - ship.x, other.y - ship.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = other;
      }
    }
    return nearest;
  }

  /** 远离最近敌舰；如果正后方是边界/地形，就带一点侧向偏角滑出去 */
  private static retreatHeading(ship: Ship, enemy: Ship): number {
    const away = Math.atan2(ship.y - enemy.y, ship.x - enemy.x);
    for (const heading of [away + RETREAT_TURN, away - RETREAT_TURN, away]) {
      if (!isHeadingOutOfBounds(ship, heading, BOUNDARY_LOOK_AHEAD)) return heading;
    }
    return away;
  }
}
