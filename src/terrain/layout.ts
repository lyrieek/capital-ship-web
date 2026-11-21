// 地物摆位：海图上「哪有什么、放在哪」
// 现在是「归一化坐标 + 固定表」的占位实现；后续可换成手绘关卡数据，或按种子随机生成。
import type { TerrainItem, TerrainKind } from "./types";

/** 归一化摆位：u/v 是相对世界宽高的比例（0..1），与具体地图尺寸解耦 */
export interface TerrainPlacement {
  /** 地物类型 */
  kind: TerrainKind;
  /** 水平位置比例（0 = 左边缘，1 = 右边缘） */
  u: number;
  /** 垂直位置比例（0 = 上边缘，1 = 下边缘） */
  v: number;
  /** 尺寸缩放，缺省 1 */
  scale?: number;
  /** 形状种子，缺省按出现顺序派生 */
  seed?: number;
  /** 绕 Z 轴旋转（弧度）。船厂靠它决定哪边朝陆、哪边朝海 */
  rotation?: number;
}

// 船厂的朝向：本地 +X 指向水面（船坞），-X 指向陆地（码头）。
// 所以 rotation 就是「从岛指向海」的方向角，摆放时按最近的海岸线法线给。
// 岛 A 在 (0.14, 0.18)，朝地图中心（右下）
const SHIPYARD_RED_ROTATION = 0.4634;
// 岛 C 在 (0.73, 0.16)，朝地图中心（左下）
const SHIPYARD_BLUE_ROTATION = 2.448;

/** 默认摆位表 */
export const DEFAULT_TERRAIN_LAYOUT: TerrainPlacement[] = [
  // TODO: 换成正式关卡数据。摆位时注意三件事：
  //   1. 别压住出生带与限制区中线（RestrictArea 的 SPAWN_BAND_X / SPAWN_BAND_Y、TEAM_BOUNDS），
  //      否则船会出生在岛上（createShip 会重试，但会浪费尝试次数甚至找不到空位）
  //   2. 中央留出东西向航道，否则双方舰队开局就顶在岛上
  //   3. 岛屿沿上下边缘铺，礁石零散撒在浅水区，船厂贴着岛的水线放
  { kind: "island", u: 0.14, v: 0.18, scale: 1.25 },
  { kind: "island", u: 0.43, v: 0.82, scale: 1.0 },
  { kind: "island", u: 0.73, v: 0.16, scale: 1.1 },
  { kind: "island", u: 0.89, v: 0.74, scale: 0.9 },
  { kind: "reef", u: 0.3, v: 0.52 },
  { kind: "reef", u: 0.56, v: 0.26 },
  { kind: "reef", u: 0.63, v: 0.64 },
  { kind: "reef", u: 0.24, v: 0.88, scale: 0.8 },
  // 船厂：贴在岛 A / 岛 C 靠地图中心的那一侧水线上。
  // 位置算法：岛心 + 「从岛指向地图中心」的单位向量 * 175，
  // 175 ≈ 岛的水下坡外缘，这样码头刚好压在岸线上，船坞朝外（水面）。
  { kind: "shipyard", u: 0.1706, v: 0.2071, rotation: SHIPYARD_RED_ROTATION },
  { kind: "shipyard", u: 0.7038, v: 0.1986, rotation: SHIPYARD_BLUE_ROTATION },
];

// 单条摆位 → 世界坐标的地物
function toTerrainItem(placement: TerrainPlacement, index: number, worldWidth: number, worldHeight: number): TerrainItem {
  return {
    id: `${placement.kind}_${index}`,
    kind: placement.kind,
    x: placement.u * worldWidth,
    y: placement.v * worldHeight,
    scale: placement.scale ?? 1,
    seed: placement.seed ?? index * 97 + 13,
    rotation: placement.rotation ?? 0,
  };
}

/**
 * 把归一化摆位表展开成世界坐标的地物列表
 * @param worldWidth 战场宽度（世界单位）
 * @param worldHeight 战场高度（世界单位）
 * @param layout 摆位表，缺省用 DEFAULT_TERRAIN_LAYOUT
 */
export function createTerrainItems(
  worldWidth: number,
  worldHeight: number,
  layout: readonly TerrainPlacement[] = DEFAULT_TERRAIN_LAYOUT,
): TerrainItem[] {
  return layout.map((placement, index) => toTerrainItem(placement, index, worldWidth, worldHeight));
}
