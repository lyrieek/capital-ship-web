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
  // 击杀 +300
  score += 300 * input.kills;
  // 造成伤害 +2/点
  score += 2 * input.damageDealt;
  // 存活 +5/秒，封顶300秒
  score += Math.min(input.survivalTime * 5, 300);
  // 战斗结束尚存活 +200
  if (input.alive) score += 200;
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

/** 找出指定下标集合里唯一最高分的下标；并列第一或集合为空时返回 null */
function uniqueTopIndex(scores: readonly number[], indices: readonly number[]): number | null {
  let best = -Infinity;
  let bestIndex: number | null = null;
  let tied = false;

  for (const index of indices) {
    const score = scores[index];
    if (score > best) {
      best = score;
      bestIndex = index;
      tied = false;
    } else if (score === best) {
      tied = true;
    }
  }

  return bestIndex === null || tied ? null : bestIndex;
}

/**
 * 按分数与阵营生成结算标签：
 * - MVP：获胜方最高分（同分队内并列时不标）；
 * - SVP：战败方最高分；
 * - 平局（双方全灭）时，MVP 取全场最高分，SVP 取另一阵营的最高分。
 * 队伍信息用于避免把 SVP 错发给胜利方的第二名。
 */
export function rankScores(scores: readonly number[], teams: readonly ("red" | "blue")[], winnerTeam: "red" | "blue" | null): ScoreResult[] {
  const results: ScoreResult[] = scores.map((score) => ({ score, color: scoreColor(score), grade: scoreGrade(score), label: "" }));
  const redIndices = teams.map((team, index) => (team === "red" ? index : -1)).filter((index) => index >= 0);
  const blueIndices = teams.map((team, index) => (team === "blue" ? index : -1)).filter((index) => index >= 0);

  let mvpIndex: number | null = null;
  let svpIndex: number | null = null;

  if (winnerTeam === null) {
    // 平局：没有明确的胜败方，按全场最高分 / 另一阵营最高分标注
    mvpIndex = uniqueTopIndex(
      scores,
      scores.map((_, index) => index),
    );
    if (mvpIndex === null) {
      svpIndex = null;
    } else {
      const otherIndices = teams[mvpIndex] === "red" ? blueIndices : redIndices;
      svpIndex = uniqueTopIndex(scores, otherIndices);
    }
  } else {
    const winnerIndices = winnerTeam === "red" ? redIndices : blueIndices;
    const loserIndices = winnerTeam === "red" ? blueIndices : redIndices;
    mvpIndex = uniqueTopIndex(scores, winnerIndices);
    svpIndex = uniqueTopIndex(scores, loserIndices);
  }

  if (mvpIndex !== null) results[mvpIndex].label = "MVP";
  if (svpIndex !== null) results[svpIndex].label = "SVP";
  return results;
}
