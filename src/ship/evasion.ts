// 规避行为抽象（原 Dodge，改称 Evasion）：不同舰船可使用不同规避逻辑
// （未来如驱逐舰为战列舰主动挡雷）。
// 当前所有舰船缺省使用 DefaultEvasionBehavior。
//
// TODO(鱼雷规避): 现在仍是固定幅度横移。后续改为候选机动评分：
//   枚举 左/右横移、加速、减速、加速+横移、减速+横移，
//   按与全部来袭鱼雷的最近接近余量 + 地形/边界/脱离交战代价选最优，
//   并锁定 0.4~0.8 秒，避免每帧来回切换加速/减速。
import type { Ship, ThreatItem } from "./ship";
import { clamp, P } from "../game/utils";
import { getWeaponSpec } from "../weapons";
import { getGameInstance } from "../game/Game";

export interface EvasionPlan {
  // 规避方向：1-向上，-1-向下
  side: 1 | -1;
  // 规避阶段的速度系数（相对基础航速），用于限制机动幅度
  speedFactor: number;
  // 规避阶段持续时间（秒），到期进入回正
  duration: number;
  // 最大横向偏移距离（像素），保持机动幅度小，避免过猛反而撞上鱼雷
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

export const DEFAULT_EVASION_PLAN: EvasionPlan = {
  side: 1,
  // 规避时仅略快于正常巡航（正常 0.5，规避 0.65），避免机动过猛
  speedFactor: 0.65,
  duration: 0.85,
  // 最大横向偏移，保持机动幅度小
  amplitude: 42,
};

// 查点 q 到静止点 (px, py) 的最近接近时刻与距离（只评估未来 2.2 秒内）
function closestApproachToPoint(q: { x: number; y: number; vx: number; vy: number }, px: number, py: number): { dist: number } {
  const rx = q.x - px,
    ry = q.y - py;
  const vv = q.vx * q.vx + q.vy * q.vy;
  if (vv < 1e-6) return { dist: Math.hypot(rx, ry) };
  let t = -(rx * q.vx + ry * q.vy) / vv;
  if (t < 0) t = 0;
  if (t > 2.2) t = 2.2;
  const cx = q.x + q.vx * t,
    cy = q.y + q.vy * t;
  return { dist: Math.hypot(cx - px, cy - py) };
}

export class DefaultEvasionBehavior implements EvasionBehavior {
  private readonly plan: EvasionPlan = DEFAULT_EVASION_PLAN;

  decide(ship: Ship, threat: ThreatItem): EvasionPlan | null {
    const p = threat.p;
    // 预测的弹道击中 Y 坐标，用于平局时的兜底方向（远离冲击点）
    const hitY = p.y + p.vy * threat.t;

    const game = getGameInstance();
    const torpedoes = game ? game.projectiles.filter((q) => q.type === "torp" && q.owner !== ship && !q.dead) : [];

    const amp = this.plan.amplitude;
    const halfW = ship.wid / 2;
    const yMax = P.yMax;
    const yMin = P.yMin;

    let bestSide: 1 | -1 = hitY > ship.y ? -1 : 1;
    let bestScore = -Infinity;

    // 评估向上 / 向下两个候选躲避位置，取对全部来袭鱼雷最坏情况也最安全的一侧
    for (const side of [-1, 1] as const) {
      const candY = clamp(ship.y + side * amp, yMin, yMax);
      let minClear = Infinity;
      for (const q of torpedoes) {
        const { dist } = closestApproachToPoint(q, ship.x, candY);
        const clear = dist - getWeaponSpec(q.type).dangerRadius - halfW;
        if (clear < minClear) minClear = clear;
      }
      const score = torpedoes.length > 0 ? minClear : Math.abs(candY - hitY);
      if (score > bestScore) {
        bestScore = score;
        bestSide = side;
      }
    }

    return { ...this.plan, side: bestSide };
  }
}
