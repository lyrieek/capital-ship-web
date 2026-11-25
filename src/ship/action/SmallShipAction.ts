// 小型舰行动模式：贴近到主炮射程后横船绕行炮战。
//
// 核心思路不是写死「接近 → 开炮 → 掉头」几个动画，而是用连续环绕控制：
//   1. 期望航向 = 目标方位 ± 90°，并根据当前距离做径向修正；
//   2. 距离大于环绕半径时向内偏并加速，小于时向外偏并减速；
//   3. 目标跑到船尾 / 距离过近时进入 loop，加速绕圈回头；
//   4. 靠近限制区边界时不再自己掉头，交给 locomotion 统一处理：
//      能浅转就贴着边界平行跑几步，转不到平行才减速掉头。
// 这样「走过头 → 加速绕圈 → 回来继续开炮」会自然发生。
import type { Ship } from "../ship";
import { angleDiff, clamp } from "../../game/utils";
import { getTerrainField } from "../../terrain";
import { getWeaponSpec } from "../../weapons";
import { isHeadingOutOfBounds } from "../locomotion";
import { ActionMode, type ActionIntent } from "./ActionMode";

const SHELL_RANGE = getWeaponSpec("shell").range;

// 环绕半径按自身长度比例（小型舰 100 → 400），保证绕行弧度足够大，
// 不会因为固定世界半径在大小舰之间失衡；数值可在这里统一调参。
const ORBIT_RADIUS_PER_LEN = 4;
const MIN_ORBIT_RADIUS = 280;

// 进入交战的射程（主炮射程的 90%）
const ENGAGE_RANGE_FACTOR = 0.9;

// 速度档位：相对本舰巡航速度
const APPROACH_SPEED = 1.35;
const FAR_APPROACH_SPEED = 1.6;
const ENGAGE_SPEED = 0.8;
const MAX_ENGAGE_SPEED = 1.15;
const MIN_ENGAGE_SPEED = 0.7;
const LOOP_SPEED = 1.6;

// 径向修正上限：太远时最多把航向从切线往目标方向偏 55°，太近时反向偏
const MAX_INWARD_CORRECTION = (55 * Math.PI) / 180;
const BOUNDARY_LOOK_AHEAD = 240;

// loop 阶段最短持续时间，以及距离恢复到多少后回到 engage
const LOOP_MIN_TIME = 0.8;
const LOOP_EXIT_RADIUS_FACTOR = 0.7;

// 目标相对船头超过这个角度就算「跑到了船尾」，进入 loop 加速绕回
const BEHIND_ANGLE = (115 * Math.PI) / 180;

// 距离小于环绕半径的这个比例就算「贴太近」，先加速拉开
const TOO_CLOSE_FACTOR = 0.55;

export type SmallShipPhase = "search" | "approach" | "engage" | "loop";

export class SmallShipAction extends ActionMode {
  readonly name = "small-ship";

  private phase: SmallShipPhase = "search";
  private orbitSide: 1 | -1 = 1;
  private loopT = 0;

  reset(): void {
    super.reset();
    this.phase = "search";
    this.orbitSide = 1;
    this.loopT = 0;
  }

  update(ship: Ship, dt: number): ActionIntent {
    this.acquireTarget(ship);

    const target = this.target;
    if (!target) return SmallShipAction.searchIntent(ship);

    const distance = Math.hypot(target.x - ship.x, target.y - ship.y);
    const bearing = Math.atan2(target.y - ship.y, target.x - ship.x);
    const orbitRadius = SmallShipAction.orbitRadius(ship);
    const engageRange = SHELL_RANGE * ENGAGE_RANGE_FACTOR;

    this.updatePhase(ship, distance, bearing, orbitRadius, engageRange, dt);

    let heading = 0;
    let speedFactor = 1;
    if (this.phase === "approach") {
      // 斜向接近，避免正对目标时被鱼雷迎面命中
      heading = bearing + this.orbitSide * 0.35;
      speedFactor = distance > orbitRadius * 2 ? FAR_APPROACH_SPEED : APPROACH_SPEED;
    } else if (this.phase === "loop") {
      heading = this.orbitHeading(bearing, distance, orbitRadius);
      speedFactor = LOOP_SPEED;
    } else {
      heading = this.orbitHeading(bearing, distance, orbitRadius);
      speedFactor = SmallShipAction.engageSpeed(distance, orbitRadius);
    }

    ship.target = target;
    return { heading, speedFactor };
  }

  /** 目标锁定：活着就继续追，死了或不存在才重新找最近的敌人 */
  private acquireTarget(ship: Ship): void {
    if (this.target?.alive) return;

    const next = ship.findTarget();
    if (next !== this.target) {
      this.phase = "search";
      this.loopT = 0;
    }
    this.target = next;
  }

  private updatePhase(ship: Ship, distance: number, bearing: number, orbitRadius: number, engageRange: number, dt: number): void {
    if (this.phase === "search") {
      if (distance <= engageRange) {
        this.phase = "engage";
        this.chooseOrbitSide(ship, bearing, distance, orbitRadius);
      } else {
        this.phase = "approach";
      }
      return;
    }

    if (this.phase === "approach") {
      if (distance <= engageRange) {
        this.phase = "engage";
        this.chooseOrbitSide(ship, bearing, distance, orbitRadius);
      }
      return;
    }

    if (this.phase === "engage") {
      const targetBehind = Math.abs(angleDiff(ship.angle, bearing)) > BEHIND_ANGLE;
      if (distance < orbitRadius * TOO_CLOSE_FACTOR || targetBehind) {
        this.phase = "loop";
        this.loopT = 0;
      }
      return;
    }

    // loop：先加速绕出去，距离恢复后回到 engage
    this.loopT += dt;
    if (this.loopT >= LOOP_MIN_TIME && distance > orbitRadius * LOOP_EXIT_RADIUS_FACTOR) {
      this.phase = "engage";
    }
  }

  /** 环绕半径按自身长度比例，并给一个下限 */
  private static orbitRadius(ship: Ship): number {
    return Math.max(MIN_ORBIT_RADIUS, ship.len * ORBIT_RADIUS_PER_LEN);
  }

  /** 横船航向：切线方向 + 距离误差修正 */
  private orbitHeading(bearing: number, distance: number, orbitRadius: number): number {
    return SmallShipAction.orbitHeadingForSide(bearing, distance, orbitRadius, this.orbitSide);
  }

  private static orbitHeadingForSide(bearing: number, distance: number, orbitRadius: number, side: 1 | -1): number {
    const radialError = clamp((distance - orbitRadius) / Math.max(1, orbitRadius), -1, 1);
    return bearing + side * (Math.PI / 2 - radialError * MAX_INWARD_CORRECTION);
  }

  /** 横船时的速度：略远就稍微加速追，贴太近就压到 0.7 保持机动 */
  private static engageSpeed(distance: number, orbitRadius: number): number {
    const error = distance - orbitRadius;
    if (error > 0) return Math.min(MAX_ENGAGE_SPEED, ENGAGE_SPEED + (error / orbitRadius) * 0.35);
    return Math.max(MIN_ENGAGE_SPEED, ENGAGE_SPEED + (error / orbitRadius) * 0.1);
  }

  /** 进入交战瞬间选一个转弯代价小、且不朝地形/边界冲的环绕方向 */
  private chooseOrbitSide(ship: Ship, bearing: number, distance: number, orbitRadius: number): void {
    const field = getTerrainField();
    let bestSide: 1 | -1 = this.orbitSide;
    let bestCost = Infinity;

    for (const side of [-1, 1] as const) {
      const heading = SmallShipAction.orbitHeadingForSide(bearing, distance, orbitRadius, side);
      let cost = Math.abs(angleDiff(ship.angle, heading));
      if (isHeadingOutOfBounds(ship, heading, BOUNDARY_LOOK_AHEAD)) cost += Math.PI;
      if (field?.isPathBlocked(ship.x, ship.y, heading, 280, ship.wid / 2 + 16)) cost += Math.PI * 0.7;
      if (cost < bestCost) {
        bestCost = cost;
        bestSide = side;
      }
    }

    this.orbitSide = bestSide;
  }

  private static searchIntent(ship: Ship): ActionIntent {
    ship.target = null;
    // 没有目标时沿当前方向巡航；撞边界后 driveShip 会更新 dir
    return { heading: ship.dir > 0 ? 0 : Math.PI, speedFactor: 1 };
  }
}

// 大型舰占位说明：
// TODO(大型舰): 大型舰行动模式（可停船炮战、更慢转向、更远射界）尚未实现。
// 现在 createDefaultActionMode("capital") 也暂时复用本模式；
// 舰种类型与 CapitalShipTraits 已在 ship.d.ts 预留。
