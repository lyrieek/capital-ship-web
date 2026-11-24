// 地物摆位：海图上「哪有什么、放在哪」。
// 摆位使用归一化坐标（u/v），与具体世界尺寸解耦；每张地图引用其中一份布局。
import type { TerrainItem, TerrainKind } from "./types";

/** 归一化摆位：u/v 是相对世界宽高的比例（0..1） */
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

// 船厂的本地 +X 指向水面（船坞），-X 指向陆地（码头）。

/**
 * 默认海图：左右各有一座船厂岛，中央留出东西向主航道。
 * 摆位时注意三件事：
 *   1. 别压住出生带与限制区中线（game/RestrictAreaImpl 的 SPAWN_BAND_X / SPAWN_BAND_Y），
 *      否则摆船会反复重试甚至找不到空位；
 *   2. 中央要留出可通行的主航道，避免双方开局就顶在岛上；
 *   3. 岛屿沿上下边缘铺，礁石零散撒在浅水区，船厂贴着岛的水线放。
 */
export const DEFAULT_TERRAIN_LAYOUT: TerrainPlacement[] = [
  { kind: "island", u: 0.14, v: 0.18, scale: 1.25 },
  { kind: "island", u: 0.43, v: 0.82, scale: 1.0 },
  { kind: "island", u: 0.73, v: 0.16, scale: 1.1 },
  { kind: "island", u: 0.89, v: 0.74, scale: 0.9 },
  { kind: "reef", u: 0.3, v: 0.52 },
  { kind: "reef", u: 0.56, v: 0.26 },
  { kind: "reef", u: 0.63, v: 0.64 },
  { kind: "reef", u: 0.24, v: 0.88, scale: 0.8 },
  // 船厂贴在岛 A / 岛 C 靠地图中心的一侧水线上。
  // 位置算法：岛心 + 「从岛指向地图中心」的单位向量 * 175，
  // 175 ≈ 岛的水下坡外缘，这样码头刚好压在岸线上，船坞朝外（水面）。
  { kind: "shipyard", u: 0.15599, v: 0.24326, rotation: 1.1484 },
  { kind: "shipyard", u: 0.7025, v: 0.19019, rotation: 2.5884 },
];

/**
 * 中央海峡：上下两条断续岛链沿东西方向延伸，把整张海图压成一条中央水道。
 * 舰队从左右两端进入海峡，接敌距离更短，也更难绕开对方的正面。
 */
export const STRAIT_TERRAIN_LAYOUT: TerrainPlacement[] = [
  // 北岸岛链
  { kind: "island", u: 0.08, v: 0.29, scale: 1.2 },
  { kind: "island", u: 0.25, v: 0.29, scale: 1.35 },
  { kind: "island", u: 0.42, v: 0.29, scale: 1.15 },
  { kind: "island", u: 0.58, v: 0.29, scale: 1.25 },
  { kind: "island", u: 0.75, v: 0.29, scale: 1.35 },
  { kind: "island", u: 0.92, v: 0.29, scale: 1.15 },
  // 南岸岛链
  { kind: "island", u: 0.16, v: 0.71, scale: 1.15 },
  { kind: "island", u: 0.33, v: 0.71, scale: 1.3 },
  { kind: "island", u: 0.5, v: 0.71, scale: 1.2 },
  { kind: "island", u: 0.67, v: 0.71, scale: 1.35 },
  { kind: "island", u: 0.84, v: 0.71, scale: 1.15 },
  // 海峡内的零散礁石：增加走位压力，但不封死主航道
  { kind: "reef", u: 0.18, v: 0.46 },
  { kind: "reef", u: 0.36, v: 0.56 },
  { kind: "reef", u: 0.5, v: 0.44 },
  { kind: "reef", u: 0.64, v: 0.56 },
  { kind: "reef", u: 0.82, v: 0.46 },
  // 船厂分别贴住西北、东南岸线，船坞朝向海峡中心
  { kind: "shipyard", u: 0.09412, v: 0.35064, rotation: 1.1784 },
  { kind: "shipyard", u: 0.80567, v: 0.71447, rotation: 3.0684 },
];

/**
 * 群岛浅滩：多座中小岛错落分布，航路被切成数条弯曲水道。
 * 中央仍保留一条主通道，但两侧需要更多绕行。
 */
export const ARCHIPELAGO_TERRAIN_LAYOUT: TerrainPlacement[] = [
  { kind: "island", u: 0.18, v: 0.16, scale: 1.1 },
  { kind: "island", u: 0.28, v: 0.8, scale: 0.9 },
  { kind: "island", u: 0.47, v: 0.3, scale: 0.7 },
  { kind: "island", u: 0.52, v: 0.56, scale: 0.65 },
  { kind: "island", u: 0.55, v: 0.74, scale: 0.8 },
  { kind: "island", u: 0.72, v: 0.14, scale: 1.0 },
  { kind: "island", u: 0.78, v: 0.62, scale: 0.85 },
  { kind: "island", u: 0.9, v: 0.84, scale: 0.7 },
  { kind: "reef", u: 0.24, v: 0.36 },
  { kind: "reef", u: 0.38, v: 0.52 },
  { kind: "reef", u: 0.6, v: 0.42 },
  { kind: "reef", u: 0.68, v: 0.83 },
  { kind: "reef", u: 0.72, v: 0.44 },
  { kind: "reef", u: 0.12, v: 0.58 },
  { kind: "reef", u: 0.85, v: 0.34 },
  { kind: "reef", u: 0.5, v: 0.18 },
  { kind: "reef", u: 0.44, v: 0.84 },
  // 船厂贴住左下红岛与中右蓝岛
  { kind: "shipyard", u: 0.19236, v: 0.2131, rotation: 1.1784 },
  { kind: "shipyard", u: 0.78707, v: 0.5855, rotation: -1.2216 },
];

/** 归一化摆位 → 世界坐标（供地图定义船厂出生地时复用同一份数据） */
export function placementToWorld(placement: TerrainPlacement, worldWidth: number, worldHeight: number): { x: number; y: number } {
  return { x: placement.u * worldWidth, y: placement.v * worldHeight };
}

// 单条摆位 → 世界坐标的地物
function toTerrainItem(placement: TerrainPlacement, index: number, worldWidth: number, worldHeight: number): TerrainItem {
  const point = placementToWorld(placement, worldWidth, worldHeight);
  return {
    id: `${placement.kind}_${index}`,
    kind: placement.kind,
    x: point.x,
    y: point.y,
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
