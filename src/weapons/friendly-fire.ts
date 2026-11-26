// 友军火力安全：发射前检查弹道是否会扫到友舰，避免自动交战把炮弹 / 鱼雷打到队友身上。
//
// 友军规则按武器区分：
//   - 主炮曲射：出膛后近处一段弹道已从友舰上方越过，不把近处友舰算作挡线；
//     目标本身也在近处时炮弹来不及爬升，仍会误伤；远处的友舰照常可能被击中。
//   - 鱼雷：命中不看距离，碰到任何友舰都会误击；但发射前只检查近处航线，
//     更远的友舰会在鱼雷接近时收到预警自行规避。
//
// 检查方式：
//   1. 沿弹药的直线航路按固定步长采样；
//   2. 每个采样点对应弹药到达该处的时间，按当前速度预测友舰届时位置；
//   3. 用「胶囊 + 半舰宽」近似友舰轮廓，计算采样点到舰体的净空；
//   4. 净空不足（弹体半径 + 安全余量 + 散布 / 弧线偏移）就判定为危险。
//
// 炮弹有随机散布和贝塞尔弧线，鱼雷只有散布，两者都作为「随航程增长的横向偏移」计入：
//   - 散布：落点偏移沿航线线性增长，航程比例 f 处最多偏移 scatter * f；
//   - 曲射：控制点偏移 bend * 弦长，曲线相对弦线在 f 处偏移 2f(1-f) * bend * 弦长。
// 这里只做纯计算，不创建弹药；真正的发射仍由 fireWeapon 统一处理。
import { shipCapsuleClearance } from "../game/utils";

/** 主炮炮弹出膛后这段距离内视为「已越过近处舰船」：曲射弹道不判定近处友舰挡线。
 *  如果射击目标本身也在近处（shotDistance 不超过该值），炮弹来不及爬升，仍按全弹道判定。 */
export const SHELL_ARC_CLEARANCE = 220;

/** 鱼雷发射前的友军检查距离：只看这段近距离内的友舰，更远的友舰有足够时间自行规避。 */
export const TORPEDO_NEAR_FRIENDLY_DISTANCE = 480;

/** 友军火力检查需要的最小舰船信息（Ship 结构天然满足） */
export interface ScreeningShip {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  len: number;
  wid: number;
  team: "red" | "blue";
  alive: boolean;
}

export interface FriendlyFireCheck {
  /** 发射舰船 */
  shooter: ScreeningShip;
  /** 战场上的全部舰船，用于找出同阵营友舰 */
  ships: readonly ScreeningShip[];
  /** 弹道起点（炮口 / 船心） */
  from: { x: number; y: number };
  /** 瞄准点 */
  to: { x: number; y: number };
  /** 弹速（像素 / 秒），用于预测友舰位置 */
  speed: number;
  /** 弹体碰撞半径 */
  projectileRadius: number;
  /** 额外的安全余量（像素），缺省 18 */
  safetyMargin?: number;
  /** 落点随机散布半径（像素） */
  spread?: number;
  /**
   * 散布半径对应的航程；缺省等于 from→to 的距离。
   * 检查鱼雷整段射程时，to 会延伸到射程边缘，这里要传真实瞄准距离，
   * 否则远端的散布偏移会被低估。
   */
  spreadDistance?: number;
  /** 曲射弯曲度（相对弦长），0 表示直线 */
  bend?: number;
  /**
   * 曲射武器的「爬升净空距离」：从弹道起点出发的前 N 像素内，
   * 炮弹已越过近处舰船，不把这段内的友舰算作挡线。
   * 射击距离本身不超过该值时，炮弹没有爬升空间，仍然从头检查。
   */
  arcClearance?: number;
  /**
   * 只检查航道范围内的友舰：沿航道方向已经明显越过 to 的友舰直接忽略。
   * 用于鱼雷的近距离检查——远处友舰会自行规避，不该拖累发射舰。
   */
  ignoreBeyondPath?: boolean;
}

const DEFAULT_SAFETY_MARGIN = 18;
// 沿航路的采样步长（像素）：越小越精确，40 已经能覆盖 1100~1600 的射程
const SAMPLE_STEP = 40;

/** 弹道是否会扫到友舰 */
export function isFriendlyFireRisk(check: FriendlyFireCheck): boolean {
  const { shooter, ships, from, to, speed, projectileRadius } = check;
  const margin = check.safetyMargin ?? DEFAULT_SAFETY_MARGIN;
  const spread = check.spread ?? 0;
  const bend = check.bend ?? 0;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return false;
  const spreadDistance = check.spreadDistance ?? distance;
  // 散布偏移随「从炮口出发的航程」线性增长：实际瞄准距离之外会继续放大
  const spreadScale = spreadDistance > 0 ? 1 / spreadDistance : 0;
  // 曲射爬升段：远距离射击时，出膛后这段内的友舰已经从炮弹下方通过
  const arcClearance = check.arcClearance ?? 0;
  const skipMuzzleSpan = arcClearance > 0 && distance > arcClearance;

  const steps = Math.max(1, Math.ceil(distance / SAMPLE_STEP));
  const travelTime = distance / speed;

  for (const friend of ships) {
    // 只检查仍在场上的同阵营友舰；发射舰自身不参与（owner 不会命中自己）
    if (friend === shooter || !friend.alive || friend.team !== shooter.team) continue;

    // 曲射爬升段：开火时就在身边的友舰已经从炮弹下方通过，整艘跳过。
    // 只有目标本身也在近处（skipMuzzleSpan=false）时才会把近处友舰算进来。
    if (skipMuzzleSpan && shipCapsuleClearance(from.x, from.y, friend) <= arcClearance) continue;

    // 近距离检查：沿航道方向已经越出 to 的友舰不再参与（远处友舰自行规避）
    if (check.ignoreBeyondPath) {
      const projection = ((friend.x - from.x) * dx + (friend.y - from.y) * dy) / distance;
      const endMargin = friend.len / 2 + projectileRadius + margin;
      if (projection > distance + endMargin || projection < -endMargin) continue;
    }

    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const along = distance * f;
      // 炮弹已爬升越过近处：近距离的航路段不参与判定
      if (skipMuzzleSpan && along < arcClearance) continue;

      const t = travelTime * f;
      // 弹药在 f 处的位置（名义直线航路）
      const px = from.x + dx * f;
      const py = from.y + dy * f;
      // 友舰在弹药到达时刻的预测位置；转向较慢，这里沿用当前航向
      const fx = friend.x + friend.vx * t;
      const fy = friend.y + friend.vy * t;
      const clearance = shipCapsuleClearance(px, py, { x: fx, y: fy, len: friend.len, wid: friend.wid, angle: friend.angle });
      const deviation = spread * distance * f * spreadScale + 2 * f * (1 - f) * bend * distance;
      if (clearance <= projectileRadius + margin + deviation) return true;
    }
  }

  return false;
}
