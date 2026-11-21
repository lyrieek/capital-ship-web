// 地物查询：位置是否被陆地占用、圆形刚体怎么被陆地推开、船厂检测、舰船避让。
//
// 这一层刻意不 import 任何 Babylon 类型：
// 摆船（RestrictArea）、舰船碰撞（Game.resolveCollisions）、舰船避让（ship/index.ts、movement.ts）、
// 炮弹落点（weapons）都只依赖它。
// 以后换渲染方式（网格 / 贴图 / 分块加载）时，玩法代码一行都不用动。
//
// 两套碰撞的分工：
//   - 航行时贴岸：Babylon 内置碰撞（mesh.moveWithCollisions），见 game/render.ts；
//   - 这里负责「提前拐弯」（avoidAngle / avoidSide）和「插进去以后捞出来」（pushOut）。
//     Babylon 碰撞只会把车挡住，不会让车自己找路，所以避让必须在撞上去之前就发生。
import { getTerrainSpec } from "./spec";
import { isInShipyardZone } from "./shipyard-zone";
import type { TerrainBounds, TerrainItem } from "./types";

/** 自动摆位时的默认尝试次数 */
const DEFAULT_TRIES = 24;

/** 靠陆判定：船离最近岸线的距离上限（世界单位） */
export const QUAY_RANGE = 150;

/** 避让前视距离（世界单位）：约 2.8 秒航程，足够在撞上礁石前转完一个弯 */
export const TERRAIN_AVOID_LOOK_AHEAD = 170;

// 避让时依次尝试的偏航角（度）：0 / 左右 25 / 50 / 75 / 100
const AVOID_ANGLES = [0, 25, -25, 50, -50, 75, -75, 100, -100].map((deg) => (deg * Math.PI) / 180);

/** 船厂检测结果 */
export interface ShipyardCheck {
  /** 在船坞检测区里 */
  inZone: boolean;
  /** 靠海：船在可航行水域（没有压在岛礁上） */
  onWater: boolean;
  /** 靠陆：离最近的岸线足够近 */
  nearLand: boolean;
  /** 三项同时成立才算「进厂」——缺一个都不行 */
  docked: boolean;
}

/** 单个地物的碰撞半径（世界单位）；不参与碰撞的类型返回 0 */
export function terrainRadius(item: TerrainItem): number {
  const spec = getTerrainSpec(item.kind);
  if (!spec.solid) return 0;
  return spec.collisionRadius * (item.scale ?? 1);
}

export class TerrainField {
  /** 全部地物（只读） */
  readonly items: readonly TerrainItem[];
  /** 额外安全边距（世界单位）：船与岸线之间留一点余量 */
  private readonly padding: number;

  constructor(items: readonly TerrainItem[], padding = 0) {
    this.items = items;
    this.padding = padding;
  }

  /**
   * 圆形范围是否与陆地重叠（含安全边距）
   * radius 传 0 就是「点是否在陆地上」。
   * 摆船时传舰船半长，保证船身（不只是船心）也在水面上。
   */
  isBlockedCircle(x: number, y: number, radius: number): boolean {
    for (const item of this.items) {
      const r = terrainRadius(item) + radius + this.padding;
      if (r <= 0) continue;
      const dx = x - item.x;
      const dy = y - item.y;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  }

  /** 点是否落在陆地上（含安全边距） */
  isBlocked(x: number, y: number): boolean {
    return this.isBlockedCircle(x, y, 0);
  }

  /** 到最近岸线的距离（世界单位）；附近没有陆地时返回 Infinity */
  distanceToLand(x: number, y: number): number {
    let best = Infinity;
    for (const item of this.items) {
      const r = terrainRadius(item);
      if (r <= 0) continue;
      const d = Math.hypot(x - item.x, y - item.y) - r;
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * 船厂检测：必须同时靠海 + 靠陆，缺一个都不算进厂。
   * 检测区的范围在 shipyard-zone.ts 里定义，和 shipyard.ts 画出来的框是同一个矩形。
   */
  checkShipyard(x: number, y: number): ShipyardCheck {
    let inZone = false;
    const spec = getTerrainSpec("shipyard");
    for (const item of this.items) {
      if (item.kind !== "shipyard") continue;
      if (isInShipyardZone(item, spec.radius, x, y)) {
        inZone = true;
        break;
      }
    }
    // 靠海：船心必须在水面上（船厂本身 solid = false，不会把船坞挡掉）
    const onWater = !this.isBlockedCircle(x, y, 0);
    // 靠陆：离最近的岸线要足够近
    const nearLand = this.distanceToLand(x, y) <= QUAY_RANGE;
    return { inZone, onWater, nearLand, docked: inZone && onWater && nearLand };
  }

  /**
   * 圆形刚体与陆地重叠时，把它沿径向推到岸外
   * 推两轮：相邻两座岛之间可能一次推不干净。
   * 仅用于「船心已经插进岛里」的兜底救援，正常航行交给 Babylon 碰撞。
   */
  pushOut(x: number, y: number, radius: number): { x: number; y: number } {
    let px = x;
    let py = y;
    for (let pass = 0; pass < 2; pass++) {
      for (const item of this.items) {
        const r = terrainRadius(item) + radius;
        if (r <= 0) continue;
        let dx = px - item.x;
        let dy = py - item.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= r) continue;
        // 正好落在圆心：任取一个方向推出，避免除零
        if (distance < 0.001) {
          dx = 1;
          dy = 0;
          distance = 1;
        }
        px = item.x + (dx / distance) * r;
        py = item.y + (dy / distance) * r;
      }
    }
    return { x: px, y: py };
  }

  /** 在矩形范围内随机找一个不被陆地占用的点；尝试 tries 次仍找不到则返回 null */
  randomFreePoint(bounds: TerrainBounds, tries = DEFAULT_TRIES): { x: number; y: number } | null {
    for (let i = 0; i < tries; i++) {
      const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
      const y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
      if (!this.isBlocked(x, y)) return { x, y };
    }
    return null;
  }

  /**
   * 沿 angle 方向的前方会不会撞到陆地
   * 分 0.45 / 0.75 / 1.0 三个距离采样：
   * 只探一个点的话，礁石正好落在采样点和船之间时会被漏掉。
   */
  isPathBlocked(x: number, y: number, angle: number, lookAhead: number, radius: number): boolean {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const ratio of [0.45, 0.75, 1]) {
      const px = x + cos * lookAhead * ratio;
      const py = y + sin * lookAhead * ratio;
      if (this.isBlockedCircle(px, py, radius)) return true;
    }
    return false;
  }

  /**
   * 提前避让：从期望角度开始，依次尝试 0 / ±25° / ±50° / ±75° / ±100°，
   * 返回第一个前方通畅的角度。
   * 全被挡住时返回期望角度，交给 Babylon 碰撞兜底（至少不会卡在原地不动）。
   */
  avoidAngle(x: number, y: number, desired: number, radius: number, lookAhead = TERRAIN_AVOID_LOOK_AHEAD): number {
    for (const offset of AVOID_ANGLES) {
      const angle = desired + offset;
      if (!this.isPathBlocked(x, y, angle, lookAhead, radius)) return angle;
    }
    return desired;
  }

  /**
   * 正常巡航时的横向避让：返回 -1 / 0 / 1，表示该往 Y 的哪一侧绕。
   * 舰船在 normal 状态只沿 X 走，所以「拐弯」只能体现为提前横移换一条水道。
   */
  avoidSide(x: number, y: number, dir: number, radius: number, lookAhead: number, minY: number, maxY: number): -1 | 0 | 1 {
    const forward = dir > 0 ? 0 : Math.PI;
    if (!this.isPathBlocked(x, y, forward, lookAhead, radius)) return 0;

    const probeX = x + dir * lookAhead * 0.6;
    const step = lookAhead * 0.55;
    const upY = y - step;
    const downY = y + step;
    // 哪边能过就往哪边走；两边都空就选离边界更远的一侧，避免来回横跳
    const up = upY >= minY && !this.isBlockedCircle(probeX, upY, radius);
    const down = downY <= maxY && !this.isBlockedCircle(probeX, downY, radius);
    if (up && !down) return -1;
    if (down && !up) return 1;
    if (up && down) return y > (minY + maxY) / 2 ? -1 : 1;
    return 0;
  }
}

// 主场景的地物表单例：RestrictArea 摆船、Game 碰撞、ship 避让、render 层共用同一份数据。
// 用模块级单例而不是层层传参，是因为 RestrictArea 在 Game.ts 模块加载时就创建了，
// 那时还没有场景；而摆船发生在 initializeGame() 里，正好在这之后。
let current: TerrainField | null = null;

/** 设置当前地物表（主场景初始化时调用一次；传 null 表示清空） */
export function setTerrainField(next: TerrainField | null): void {
  current = next;
}

/** 取当前地物表；主场景之外（如 playground）可能为 null */
export function getTerrainField(): TerrainField | null {
  return current;
}
