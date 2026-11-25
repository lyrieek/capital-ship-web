// 战斗结算积分计算与配色
// 基础分 1000，按命中/击杀/伤害/存活正向计分，被命中/死亡/低速死亡/误伤反向扣分。

export interface ScoreInput {
  kills: number;
  shellHitsDealt: number;
  torpHitsDealt: number;
  shellHitsTaken: number;
  torpHitsTaken: number;
  damageDealt: number;
  damageTaken: number;
  survivalTime: number;
  alive: boolean;
  deathSpeedFactor: number | null;
  friendlyFireHits: number;
  friendlyFireDamage: number;
  won: boolean;
}

/** 5 档配色：从高到低 */
// 金
// 绿
// 浅蓝
// 浅红
// 红
export const SCORE_COLORS: { min: number; color: string; grade: string }[] = [
  { min: 1100, color: "#fbbf24", grade: "S" },
  { min: 850, color: "#86efac", grade: "A" },
  { min: 650, color: "#d9ecfa", grade: "B" },
  { min: 450, color: "#fca5a5", grade: "C" },
  { min: -Infinity, color: "#f87171", grade: "D" },
];

export function scoreColor(score: number): string {
  for (const tier of SCORE_COLORS) {
    if (score >= tier.min) return tier.color;
  }
  // 兜底最低档
  return SCORE_COLORS.at(-1)!.color;
}

export function scoreGrade(score: number): string {
  for (const tier of SCORE_COLORS) {
    if (score >= tier.min) return tier.grade;
  }
  // 兜底最低档
  return SCORE_COLORS.at(-1)!.grade;
}

export function computeScore(input: ScoreInput): number {
  let score = 1000;

  // 基础分
  // 正向得分
  // 主炮命中 +20
  score += 20 * input.shellHitsDealt;
  // 鱼雷命中 +50
  score += 50 * input.torpHitsDealt;
  // 击杀 +200
  score += 200 * input.kills;
  // 造成伤害 +0.5/点
  score += 0.5 * input.damageDealt;
  // 存活 +1/秒，封顶300秒
  score += Math.min(input.survivalTime, 300);
  // 战斗结束尚存活 +100
  if (input.alive) score += 100;
  // 所在阵营胜利 +200
  if (input.won) score += 200;

  // 反向得分
  // 被主炮命中 -50
  score -= 50 * input.shellHitsTaken;
  // 被鱼雷命中 -200
  score -= 200 * input.torpHitsTaken;
  // 受总伤害 -0.5/点
  score -= 0.5 * input.damageTaken;
  // 死亡基础惩罚 -300
  if (!input.alive) score -= 300;

  // 低速死亡（按死亡瞬间 speedFactor 分段）
  // 高速机动，不扣分
  // 正常巡航 -100
  // 减速 -200（用户基准）
  // 近乎停船 -300
  if (input.deathSpeedFactor !== null) {
    const sf = input.deathSpeedFactor;
    if (sf >= 1.2) score -= 0;
    else if (sf >= 0.9) score -= 100;
    else if (sf >= 0.6) score -= 200;
    else score -= 300;
  }

  // 友军误击
  score -= 200 * input.friendlyFireHits + input.friendlyFireDamage;

  return Math.round(score);
}

export interface ScoreResult {
  score: number;
  color: string;
  grade: string;
  // "MVP" | "SVP" | ""
  label: string;
}

/** 按分数排序，给最高分标 MVP、第二高分标 SVP */
export function rankScores(scores: readonly number[]): ScoreResult[] {
  const sorted = [...scores].toSorted((a: number, b: number) => b - a);
  const max = sorted.at(0) ?? 0;
  const second = sorted.at(1) ?? -Infinity;

  return scores.map((s: number) => {
    let label = "";
    if (s === max && sorted.filter((x: number) => x === max).length === 1) label = "MVP";
    else if (s === second && sorted.filter((x: number) => x === second).length === 1) label = "SVP";
    return { score: s, color: scoreColor(s), grade: scoreGrade(s), label };
  });
}
