/**
 * 规避行为抽象（原 Dodge，改称 Evasion）：不同舰船可使用不同规避逻辑
 * （未来如驱逐舰为战列舰主动挡雷）。
 * 当前所有舰船缺省使用 DefaultEvasionBehavior。
 *
 * 现在的规避是「自适应横移」：对全部“未来会命中”的来袭鱼雷，
 * 以命中椭圆半径 + 安全余量算出脱离所需的最小横向位移，
 * 优先选偏移更小、且两侧都不够时最坏余量更大的一侧，
 * 再按最早命中时刻反推规避速度，保证在命中前脱离。
 */
import type { Ship, ThreatItem } from "./ship";
import { clamp, P } from "../game/utils";
import { getWeaponSpec } from "../weapons";
import { getGameInstance } from "../game/Game";

export interface EvasionPlan {
  // 规避方向：1-向下，-1-向上
  side: 1 | -1;
  // 规避阶段的速度系数（相对基础航速），用于限制机动幅度
  speedFactor: number;
  // 规避阶段持续时间（秒），到期进入回正
  duration: number;
  // 横向规避位移（像素）：自适应，需足以脱离命中椭圆
  amplitude: number;
}

/**
 * 规避行为抽象：决定一艘舰船面对来袭威胁时该如何规避。
 * 不同舰船可传入不同的行为实现（未来如驱逐舰为战列舰主动挡雷）；
 * 缺省所有舰船使用 DefaultEvasionBehavior。
 */
export interface EvasionBehavior {
  /**
   * 根据来袭威胁决定本次规避方案；返回 null 表示不规避。
   */
  decide(ship: Ship, threat: ThreatItem): EvasionPlan | null;
}

// 评估未来威胁的时间窗（秒）：只看这段时间内会命中自己的鱼雷
const THREAT_WINDOW = 2.2;
// 脱离命中椭圆之外再留的安全余量（像素）
const CLEAR_MARGIN = 24;
// 基础横移幅度（像素）：即使威胁不大也至少做这么点机动
const BASE_AMPLITUDE = 42;
// 横移幅度上限（像素）：避免为了躲雷做过长的横穿
const MAX_AMPLITUDE = 168;
// 搜索脱离幅度时的步长（像素）
const AMPLITUDE_STEP = 12;
// 规避最短持续时间（秒）
const EVASION_DURATION = 0.9;
// 规避时的速度系数范围
const MIN_SPEED_FACTOR = 0.65;
const MAX_SPEED_FACTOR = 1.6;

export const DEFAULT_EVASION_PLAN: EvasionPlan = {
  side: 1,
  speedFactor: MIN_SPEED_FACTOR,
  duration: EVASION_DURATION,
  amplitude: BASE_AMPLITUDE,
};

// 查点 q 到静止点 (px, py) 的最近接近距离（只评估未来 THREAT_WINDOW 秒内）
function closestApproachToPoint(q: { x: number; y: number; vx: number; vy: number }, px: number, py: number): number {
  const rx = q.x - px;
  const ry = q.y - py;
  const vv = q.vx * q.vx + q.vy * q.vy;
  if (vv < 1e-6) return Math.hypot(rx, ry);
  let t = -(rx * q.vx + ry * q.vy) / vv;
  if (t < 0) t = 0;
  if (t > THREAT_WINDOW) t = THREAT_WINDOW;
  const cx = q.x + q.vx * t;
  const cy = q.y + q.vy * t;
  return Math.hypot(cx - px, cy - py);
}

// 收集所有“会在时间窗内命中本舰”的鱼雷（按命中椭圆判定）
function collectThreats(ship: Ship): ThreatItem[] {
  const game = getGameInstance();
  if (!game) return [];
  const halfW = ship.wid / 2;
  const threats: ThreatItem[] = [];
  for (const p of game.projectiles) {
    if (p.owner === ship || p.kind !== "torpedo" || p.dead || p.fade !== undefined) continue;
    const rx = ship.x - p.x;
    const ry = ship.y - p.y;
    const rvx = ship.vx - p.vx;
    const rvy = ship.vy - p.vy;
    const vv = rvx * rvx + rvy * rvy;
    if (vv < 100) continue;
    const t = -(rx * rvx + ry * rvy) / vv;
    if (t < 0 || t > THREAT_WINDOW) continue;
    const miss = Math.hypot(rx + rvx * t, ry + rvy * t);
    // 只有真正落进命中椭圆的鱼雷才需要规避
    if (miss <= getWeaponSpec(p.type).radius + halfW) threats.push({ t, p, miss });
  }
  return threats;
}

// 候选位置的最坏情况余量：对全部威胁鱼雷取“离命中椭圆最近的距离”
function minClearance(ship: Ship, threats: ThreatItem[], candY: number): number {
  const halfW = ship.wid / 2;
  let minClear = Infinity;
  for (const th of threats) {
    const dist = closestApproachToPoint(th.p, ship.x, candY);
    const clear = dist - getWeaponSpec(th.p.type).radius - halfW;
    if (clear < minClear) minClear = clear;
  }
  return minClear;
}

// 朝某一侧逐渐加大横移，返回第一个能脱离全部威胁的幅度；到边界仍不行返回 null
function firstClearingOffset(ship: Ship, threats: ThreatItem[], side: 1 | -1): number | null {
  for (let offset = BASE_AMPLITUDE; offset <= MAX_AMPLITUDE; offset += AMPLITUDE_STEP) {
    const candY = clamp(ship.y + side * offset, P.yMin, P.yMax);
    if (minClearance(ship, threats, candY) >= CLEAR_MARGIN) return offset;
    // 已被 Y 边界夹住，再加大幅度也到不了更远，这一侧放弃
    if (side > 0 ? candY >= P.yMax : candY <= P.yMin) return null;
  }
  return null;
}

// 选择规避方案：优先能脱离且幅度更小的一侧；两侧都脱离不了时取最坏余量最大的一侧
function chooseManeuver(ship: Ship, threats: ThreatItem[], hitY: number): { side: 1 | -1; amplitude: number } {
  let bestSide: 1 | -1 = hitY > ship.y ? -1 : 1;
  let bestOffset = Infinity;
  let roomOfBest = -Infinity;
  let found = false;

  for (const side of [-1, 1] as const) {
    const offset = firstClearingOffset(ship, threats, side);
    if (offset === null) continue;
    // 两侧都能脱离时：幅度更小的优先；幅度相同则选离 Y 边界更远、机动空间更大的一侧
    const room = side > 0 ? P.yMax - ship.y : ship.y - P.yMin;
    if (offset < bestOffset - 1e-6 || (Math.abs(offset - bestOffset) <= 1e-6 && room > roomOfBest)) {
      bestSide = side;
      bestOffset = offset;
      roomOfBest = room;
      found = true;
    }
  }
  if (found) return { side: bestSide, amplitude: bestOffset };

  // 两侧都无法完全脱离：取最大幅度下最坏余量更大的一侧（两害相权取其轻）
  let bestClear = -Infinity;
  bestSide = hitY > ship.y ? -1 : 1;
  for (const side of [-1, 1] as const) {
    const candY = clamp(ship.y + side * MAX_AMPLITUDE, P.yMin, P.yMax);
    const clear = minClearance(ship, threats, candY);
    if (clear > bestClear) {
      bestClear = clear;
      bestSide = side;
    }
  }
  return { side: bestSide, amplitude: MAX_AMPLITUDE };
}

export class DefaultEvasionBehavior implements EvasionBehavior {
  private readonly plan: EvasionPlan = DEFAULT_EVASION_PLAN;

  decide(ship: Ship, threat: ThreatItem): EvasionPlan | null {
    const threats = collectThreats(ship);
    // 预测的弹道命中 Y，用于没有可脱离威胁时的兜底方向和平局判定
    const hitY = threat.p.y + threat.p.vy * threat.t;

    if (threats.length === 0) {
      return { ...this.plan, side: hitY > ship.y ? -1 : 1 };
    }

    const maneuver = chooseManeuver(ship, threats, hitY);

    // 最早来袭时刻决定横移速度：必须在它命中前走完 amplitude
    let earliest = Infinity;
    for (const th of threats) {
      if (th.t < earliest) earliest = th.t;
    }
    const travelTime = Math.max(0.25, earliest);
    const speedFactor = clamp(maneuver.amplitude / (P.moveSpeed * travelTime), MIN_SPEED_FACTOR, MAX_SPEED_FACTOR);

    return {
      side: maneuver.side,
      amplitude: maneuver.amplitude,
      speedFactor,
      duration: Math.max(EVASION_DURATION, travelTime),
    };
  }
}
