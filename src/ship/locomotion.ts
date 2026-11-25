// 统一运动执行层：ActionMode 只输出「期望航向 + 相对巡航的速度倍率」，
// 这里负责转向、平滑加减速、地形预避让、限制区边界处理，并同步 vx/vy。
// 手动航行指令和舰船行动模式共用这一层，避免两套移动逻辑各写一遍。
import type { Ship } from "./ship";
import { angleDiff, approachAngle, approachValue, clamp, P } from "../game/utils";
import { getTerrainField, type TerrainField } from "../terrain";

// 避让时椭球半宽之外再留一点余量，避免贴到礁石才反应
const AVOID_MARGIN = 12;
// 边界前视距离：前方这个距离内会越界时先把航向折回来
export const BOUNDARY_LOOK_AHEAD = 240;

// ---- 转向疲劳（转动意愿） ----
// 实际转过 180° 时累计到 1，表示「刚完成一次大转向，暂时不想再转」。
// 疲劳越高，越小幅度的航向修正越容易被忽略；直线航行和减速会慢慢恢复意愿。
// 地形避让 / 边界折返 / 卡位脱困属于「必须转」，不受疲劳限制。
// 直线航行时每秒恢复
const TURN_FATIGUE_RECOVER_STRAIGHT = 0.45;
// 减速时额外每秒恢复
const TURN_FATIGUE_RECOVER_SLOW = 0.9;
// 疲劳满时忽略的最大航向偏差
const TURN_DEAD_ZONE_MAX = (30 * Math.PI) / 180;
// 实际转角小于该值就视为「这一帧没转」，可以开始恢复疲劳
const TURN_EPSILON = 1e-4;

// ---- 卡位检测与脱困 ----
// 每隔一段时间检查一次净位移；想走却几乎没挪动就累计卡位时间。
const STUCK_WINDOW = 1.5;
const STUCK_MIN_PROGRESS = 24;
const STUCK_PROGRESS_RATIO = 0.2;
const STUCK_LOG_INTERVAL = 2;
// 脱困时向四周试探的航向数量与前视距离
const ESCAPE_DIRECTIONS = 16;
const ESCAPE_LOOK_AHEAD = 200;
// 脱困时压到最低可航行速度，转弯半径更小，更容易蹭出来
const ESCAPE_SPEED_FACTOR = 0.7;

// ---- 边界贴边平行 ----
// 靠近边界时，如果转不到 30° 以内就能顺着边界走，就优先平行航行而不是掉头。
const BOUNDARY_PARALLEL_MAX_TURN = (30 * Math.PI) / 180;
// 转入平行后至少保持这么久，避免刚转平就被行动模式拉回去、在边缘来回抽头。
const BOUNDARY_PARALLEL_HOLD = 2.5;
// 连平行都转不到时只能减速掉头；减速期间额外恢复的转向意愿（每秒），
// 与 TURN_FATIGUE_RECOVER_SLOW 叠加。
const TURN_FATIGUE_RECOVER_BOUNDARY = 0.5;

// 「真的贴边了」的判定距离（px，船心到所贴边界的垂直距离）。
// 这个值同时决定两件事，调整时请一起评估：
//   1. 小于等于它才算贴边平行：持续额外恢复转向疲劳（TURN_FATIGUE_RECOVER_EDGE），
//      让船随时愿意离开边界、转回目标方向；
//   2. 大于它却仍在平行航向：说明只是前视提前触发了折返，此时不做死板的平行，
//      而是按距离把航向逐渐拉回行动模式的原始意图（索敌权重随距离上升）。
// 目前按小舰（len=100）估算约 1.2 个舰长；不同舰种 / 航速下可能需要精准调节。
const BOUNDARY_PARALLEL_NEAR = 120;
// 真正贴边平行时，每秒额外恢复的转向意愿（与直线恢复 TURN_FATIGUE_RECOVER_STRAIGHT 叠加）。
// 贴边期间船几乎不转向，如果疲劳不降，它会「赖」在边界上不愿再转回战场。
const TURN_FATIGUE_RECOVER_EDGE = 0.4;

export interface DriveOptions {
  /** 撞到 minX/maxX / y 边界时反弹（AI 环绕用）；手动指令只做 clamp */
  bounce?: boolean;
  /** 航向未对准时按 cos 衰减速度（保留手动指令原来的手感） */
  alignSpeed?: boolean;
  /** 是否做地形预避让，默认 true */
  avoidTerrain?: boolean;
  /** 是否应用转向疲劳（AI 用；手动指令保持直接响应），默认 false */
  useTurnFatigue?: boolean;
}

interface DriveMemory {
  // 卡位检测的基准位置与计时
  anchorX: number;
  anchorY: number;
  anchorT: number;
  // console.error 节流计时
  logT: number;
  // 贴边平行：保持剩余时间、要维持的平行航向，以及这条边界是哪一侧
  parallelT: number;
  parallelHeading: number;
  parallelAxis: "x" | "y";
  parallelSide: 1 | -1;
  // 连平行都摆不到时必须减速：标记会一直保持到降到最低速
  brake: boolean;
}

// 卡位检测是运动层的内部状态，不塞进 Ship，避免污染存档 / 网络同步字段
const driveMemory = new WeakMap<Ship, DriveMemory>();

function getDriveMemory(ship: Ship): DriveMemory {
  let memory = driveMemory.get(ship);
  if (!memory) {
    memory = {
      anchorX: ship.x,
      anchorY: ship.y,
      anchorT: 0,
      logT: 0,
      parallelT: 0,
      parallelHeading: ship.angle,
      parallelAxis: "x",
      parallelSide: 1,
      brake: false,
    };
    driveMemory.set(ship, memory);
  }
  return memory;
}

/** 清掉运动层内部状态：玩家手动接管时调用，避免沿用之前的贴边 / 减速判定 */
export function resetDriveMemory(ship: Ship): void {
  driveMemory.delete(ship);
}

/** 沿 heading 前视 lookAhead，是否会越过限制区/地图边界 */
export function isHeadingOutOfBounds(ship: Ship, heading: number, lookAhead = BOUNDARY_LOOK_AHEAD): boolean {
  const x = ship.x + Math.cos(heading) * lookAhead;
  const y = ship.y + Math.sin(heading) * lookAhead;
  return x < ship.minX || x > ship.maxX || y < P.yMin || y > P.yMax;
}

/**
 * 把期望航向折回边界内：左右边界关于竖轴镜像，上下边界关于横轴镜像。
 * 只做 2 次，足够处理角落同时越界的情况。
 */
export function reflectHeadingInsideBounds(ship: Ship, heading: number, lookAhead = BOUNDARY_LOOK_AHEAD): number {
  let result = heading;
  for (let i = 0; i < 2; i++) {
    const x = ship.x + Math.cos(result) * lookAhead;
    const y = ship.y + Math.sin(result) * lookAhead;
    if (x < ship.minX || x > ship.maxX) {
      result = Math.PI - result;
      continue;
    }
    if (y < P.yMin || y > P.yMax) {
      result = -result;
      continue;
    }
    break;
  }
  return result;
}

/** 一条贴边平行方案：航向 + 跟随的是哪条边（x=左右竖边，y=上下横边，side=max 侧 / min 侧） */
interface BoundaryParallel {
  heading: number;
  axis: "x" | "y";
  side: 1 | -1;
}

/**
 * 找一条「转过去不超过 maxTurn 就能贴着边界平行走」的航向。
 * 只考虑当前越界方向对应的两条平行航向（左右边界是竖线 → ±90°，上下边界是横线 → 0 / 180°），
 * 并排除本身又会撞到相邻边界的候选；找不到就返回 null，由调用方减速掉头。
 */
function findBoundaryParallelHeading(ship: Ship, heading: number, maxTurn = BOUNDARY_PARALLEL_MAX_TURN): BoundaryParallel | null {
  const x = ship.x + Math.cos(heading) * BOUNDARY_LOOK_AHEAD;
  const y = ship.y + Math.sin(heading) * BOUNDARY_LOOK_AHEAD;
  const outX = x < ship.minX || x > ship.maxX;
  const outY = y < P.yMin || y > P.yMax;
  if (!outX && !outY) return null;

  const candidates: BoundaryParallel[] = [];
  if (outX) {
    const side: 1 | -1 = x > ship.maxX ? 1 : -1;
    candidates.push({ heading: Math.PI / 2, axis: "x", side }, { heading: -Math.PI / 2, axis: "x", side });
  }
  if (outY) {
    const side: 1 | -1 = y > P.yMax ? 1 : -1;
    candidates.push({ heading: 0, axis: "y", side }, { heading: Math.PI, axis: "y", side });
  }

  let best: BoundaryParallel | null = null;
  let bestTurn = maxTurn;
  for (const candidate of candidates) {
    // 「不到 30°」是严格小于；转向代价相同时按候选顺序取第一个
    const turn = Math.abs(angleDiff(ship.angle, candidate.heading));
    if (turn >= bestTurn) continue;
    // 平行航向本身可能马上就撞到另一条边（角落），这种候选不能用
    if (isHeadingOutOfBounds(ship, candidate.heading)) continue;
    best = candidate;
    bestTurn = turn;
  }
  return best;
}

/** 船心到所贴边界的垂直距离（px） */
function boundaryDistance(ship: Ship, axis: "x" | "y", side: 1 | -1): number {
  if (axis === "x") return side > 0 ? ship.maxX - ship.x : ship.x - ship.minX;
  return side > 0 ? P.yMax - ship.y : ship.y - P.yMin;
}

/** 按权重在两段航向之间取中间值（权重 0 = 完全用 from，1 = 完全用 to） */
function blendHeading(from: number, to: number, weight: number): number {
  return from + angleDiff(from, to) * clamp(weight, 0, 1);
}

/**
 * 贴边期间的航向分配：
 *   - 真正贴边（distance <= BOUNDARY_PARALLEL_NEAR）→ 纯平行；
 *   - 还离得远 → 按距离把航向逐渐拉回行动模式的原始意图（提高索敌权重），
 *     避免在离边界很远的地方也死板地平行巡边。
 */
function followEdgeHeading(ship: Ship, plan: BoundaryParallel, intentHeading: number): { heading: number; distance: number } {
  const distance = boundaryDistance(ship, plan.axis, plan.side);
  const seek = clamp((distance - BOUNDARY_PARALLEL_NEAR) / (BOUNDARY_LOOK_AHEAD - BOUNDARY_PARALLEL_NEAR), 0, 1);
  return { heading: blendHeading(plan.heading, intentHeading, seek), distance };
}

/**
 * 卡位统计：按固定时间窗比较净位移。
 * 逐帧位移看起来正常、但被地形反复推回原位时，只有净位移能发现。
 */
function updateStuck(ship: Ship, memory: DriveMemory, dt: number): void {
  memory.logT = Math.max(0, memory.logT - dt);
  memory.anchorT += dt;
  if (memory.anchorT < STUCK_WINDOW) return;

  const progress = Math.hypot(ship.x - memory.anchorX, ship.y - memory.anchorY);
  const expected = P.moveSpeed * ship.cruiseFactor * ship.speedFactor * STUCK_WINDOW;
  const wantsToMove = ship.speedFactor > 0.2;
  if (wantsToMove && progress < Math.max(STUCK_MIN_PROGRESS, expected * STUCK_PROGRESS_RATIO)) {
    ship.stuckT += memory.anchorT;
  } else {
    ship.stuckT = Math.max(0, ship.stuckT - memory.anchorT * 2);
  }

  memory.anchorX = ship.x;
  memory.anchorY = ship.y;
  memory.anchorT = 0;

  if (ship.stuckT >= STUCK_WINDOW && memory.logT <= 0) {
    // 卡位属于异常状态，需要在控制台暴露出来，方便定位地形/边界问题
    // eslint-disable-next-line no-console
    console.error(`[ship] ${ship.name} 疑似卡位：pos=(${ship.x.toFixed(1)}, ${ship.y.toFixed(1)}) fatigue=${ship.turnFatigue.toFixed(2)}`);
    memory.logT = STUCK_LOG_INTERVAL;
  }
}

/** 卡位脱困：挑一个前方通畅、尽量远离边界、且不要突然掉头的方向 */
function findEscapeHeading(ship: Ship, field: TerrainField | null): number {
  const radius = ship.wid / 2 + AVOID_MARGIN;
  let best = ship.angle;
  let bestScore = -Infinity;
  for (let i = 0; i < ESCAPE_DIRECTIONS; i++) {
    const heading = (i * Math.PI * 2) / ESCAPE_DIRECTIONS;
    // 优先保持当前航向，避免脱困时又来回甩头
    let score = -Math.abs(angleDiff(ship.angle, heading)) * 0.4;
    if (!field || !field.isPathBlocked(ship.x, ship.y, heading, ESCAPE_LOOK_AHEAD, radius)) score += 3;
    const px = ship.x + Math.cos(heading) * ESCAPE_LOOK_AHEAD;
    const py = ship.y + Math.sin(heading) * ESCAPE_LOOK_AHEAD;
    if (px < ship.minX || px > ship.maxX || py < P.yMin || py > P.yMax) score -= 4;
    if (score > bestScore) {
      bestScore = score;
      best = heading;
    }
  }
  return best;
}

/**
 * 按意图推动舰船一帧。
 * @param heading 期望航向（弧度）
 * @param speedFactor 相对本舰巡航速度的倍率，会在 speedMin/speedMax 内平滑逼近
 */
// oxlint-disable-next-line max-statements complexity
export function driveShip(ship: Ship, heading: number, speedFactor: number, dt: number, options: DriveOptions = {}): void {
  const prevX = ship.x;
  const prevY = ship.y;

  // 先根据上一帧的净位移判断是否卡位，再决定本帧是否脱困
  const memory = getDriveMemory(ship);
  updateStuck(ship, memory, dt);
  const escaping = options.bounce === true && ship.stuckT >= STUCK_WINDOW;
  const field = getTerrainField();
  const terrainRadius = ship.wid / 2 + AVOID_MARGIN;
  const avoidTerrain = options.avoidTerrain !== false && field !== null;

  let desired = heading;
  // forced = 地形 / 边界 / 脱困要求「必须转」，不受转向疲劳限制
  let forced = false;
  if (avoidTerrain) {
    const avoided = field.avoidAngle(ship.x, ship.y, desired, terrainRadius);
    if (Math.abs(angleDiff(avoided, desired)) > 1e-3) forced = true;
    desired = avoided;
  }
  // 行动模式的原始意图（已做地形避让）：贴边但离边界还远时，用它作为「索敌」方向把航向拉回来
  const intentHeading = desired;

  // 边界处理：优先浅浅转成贴边平行；实在转不到平行才减速掉头。
  // 只有 AI 行动模式需要提前处理；手动指令允许一直开到限制区边界再 clamp。
  let boundarySlow = false;
  // 是否真正贴着边界在平行（决定下面是否持续恢复转向疲劳）
  let edgeHugging = false;
  if (options.bounce && !escaping) {
    // 0. 摆不到平行时已经开始减速：一直减到最低速，避免刚掉一点头又恢复巡航
    if (memory.brake) {
      boundarySlow = true;
      if (ship.speedFactor <= ship.speedMin + 1e-3) memory.brake = false;
    }

    // 1. 还在平行保持期：继续沿边界走，直到计时结束或前方又要撞到相邻边界
    if (memory.parallelT > 0) {
      memory.parallelT = Math.max(0, memory.parallelT - dt);
      if (memory.parallelT > 0 && !isHeadingOutOfBounds(ship, memory.parallelHeading)) {
        const plan: BoundaryParallel = { heading: memory.parallelHeading, axis: memory.parallelAxis, side: memory.parallelSide };
        const follow = followEdgeHeading(ship, plan, intentHeading);
        edgeHugging = follow.distance <= BOUNDARY_PARALLEL_NEAR;
        desired = avoidTerrain ? field.avoidAngle(ship.x, ship.y, follow.heading, terrainRadius) : follow.heading;
        forced = true;
      } else {
        memory.parallelT = 0;
      }
    }

    // 2. 期望航向会越界：先看能不能在 30° 内摆成平行
    if (memory.parallelT <= 0 && isHeadingOutOfBounds(ship, desired)) {
      const parallel = findBoundaryParallelHeading(ship, desired);
      if (parallel === null) {
        // 需要超过 30° 的转向：压到最低航速换更小的转弯半径
        boundarySlow = true;
        memory.brake = true;
        desired = reflectHeadingInsideBounds(ship, desired);
      } else {
        // 浅转即可贴边：保持速度；贴得够近就纯平行，离得远则按距离偏向索敌意图
        memory.parallelHeading = parallel.heading;
        memory.parallelAxis = parallel.axis;
        memory.parallelSide = parallel.side;
        memory.parallelT = BOUNDARY_PARALLEL_HOLD;
        const follow = followEdgeHeading(ship, parallel, intentHeading);
        edgeHugging = follow.distance <= BOUNDARY_PARALLEL_NEAR;
        desired = avoidTerrain ? field.avoidAngle(ship.x, ship.y, follow.heading, terrainRadius) : follow.heading;
      }
      forced = true;
    }
  }
  if (escaping) {
    desired = findEscapeHeading(ship, field);
    forced = true;
  }

  // 平滑加减速：不要瞬间从 0.7 跳到 1.6；脱困 / 边界大转向时压到最低航速方便转弯
  let targetSpeed = clamp(speedFactor, ship.speedMin, ship.speedMax);
  if (escaping) targetSpeed = clamp(ESCAPE_SPEED_FACTOR, ship.speedMin, ship.speedMax);
  else if (boundarySlow) targetSpeed = ship.speedMin;
  const slowing = targetSpeed < ship.speedFactor - 1e-3;
  ship.speedFactor = approachValue(ship.speedFactor, targetSpeed, ship.accelRate * dt);

  // 转向疲劳只压「可转可不转」的小幅修正：疲劳满时最多忽略 30° 偏差，
  // 这样 AI 不会每帧追着径向误差来回摆，但大角度转向仍然正常执行。
  const error = angleDiff(ship.angle, desired);
  let turnStep = P.turnRate * dt;
  if (options.useTurnFatigue && !forced && Math.abs(error) < ship.turnFatigue * TURN_DEAD_ZONE_MAX) turnStep = 0;

  const prevAngle = ship.angle;
  if (turnStep > 0) ship.angle = approachAngle(ship.angle, desired, turnStep);
  const turned = Math.abs(angleDiff(prevAngle, ship.angle));

  if (options.useTurnFatigue) {
    // 实际转过 180° 累计到 1
    ship.turnFatigue = clamp(ship.turnFatigue + turned / Math.PI, 0, 1);
    // 这一帧没怎么转 = 在走直线，恢复转动意愿；减速时恢复更快
    if (turned < TURN_EPSILON) ship.turnFatigue = Math.max(0, ship.turnFatigue - TURN_FATIGUE_RECOVER_STRAIGHT * dt);
    if (slowing) {
      ship.turnFatigue = Math.max(0, ship.turnFatigue - TURN_FATIGUE_RECOVER_SLOW * dt);
      // 边界掉头这种被动的减速，除了减速本身的恢复，再额外降一点疲劳
      if (boundarySlow) ship.turnFatigue = Math.max(0, ship.turnFatigue - TURN_FATIGUE_RECOVER_BOUNDARY * dt);
    }
    // 真正贴着边界平行时持续恢复：长时间巡边会让它越来越愿意转回目标方向
    if (edgeHugging) ship.turnFatigue = Math.max(0, ship.turnFatigue - TURN_FATIGUE_RECOVER_EDGE * dt);
  }

  // 手动航行保留「航向偏得多就慢一点」的旧手感；行动模式则始终按船头速度前进
  const alignment = options.alignSpeed ? Math.max(0, Math.cos(angleDiff(ship.angle, desired))) : 1;
  const speed = P.moveSpeed * ship.cruiseFactor * ship.speedFactor * alignment;

  let nextX = ship.x + Math.cos(ship.angle) * speed * dt;
  let nextY = ship.y + Math.sin(ship.angle) * speed * dt;

  if (options.bounce) {
    if (nextX < ship.minX || nextX > ship.maxX) {
      nextX = clamp(nextX, ship.minX, ship.maxX);
      ship.angle = Math.PI - ship.angle;
    }
    if (nextY < P.yMin || nextY > P.yMax) {
      nextY = clamp(nextY, P.yMin, P.yMax);
      ship.angle = -ship.angle;
    }
  }

  ship.x = clamp(nextX, ship.minX, ship.maxX);
  ship.y = clamp(nextY, P.yMin, P.yMax);

  // 用实际位移反推速度，保证预判瞄准 / 鱼雷威胁计算读到的是真实速度
  if (dt > 0) {
    ship.vx = (ship.x - prevX) / dt;
    ship.vy = (ship.y - prevY) / dt;
  }
  if (Math.abs(ship.vx) > 1) ship.dir = ship.vx > 0 ? 1 : -1;
}
