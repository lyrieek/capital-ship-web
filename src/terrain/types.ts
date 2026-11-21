// 地物（岛屿 / 礁石 / 船厂）的数据结构。
// 与 weapons/types.ts 同一思路：这里只描述「数据」，不依赖游戏层类型，
// 主场景、playground、小地图都能直接复用。
//
// 坐标：世界坐标，原点左上、Y 向下，1 世界单位 ≈ 1 屏幕像素。
// 场景坐标（居中、Y 向上）由 babylon/coords.ts 统一换算，这一层不出现。
//
// 高度：海平面是 XY 平面，相机在 -Z 一侧看向 +Z，
// 所以「高度」沿 -Z 抬升（越靠近相机越高）。地物是真实网格，不是贴图，
// 以后相机抬高 / 斜视时依然有体积和遮挡关系。
//
// 旋转：rotation 是绕 Z 轴（高度轴）旋转，也就是在海平面内打转。
// 船厂靠它决定「哪边朝陆、哪边朝海」，检测区也跟着一起转（见 shipyard-zone.ts）。

/** 地物类型：island-岛屿，reef-礁石，shipyard-船厂 */
export type TerrainKind = "island" | "reef" | "shipyard";

/** 全部地物类型（按渲染 / 图例展示顺序） */
export const TERRAIN_KINDS: TerrainKind[] = ["island", "reef", "shipyard"];

/** 单个地物的摆位与外观 */
export interface TerrainItem {
  /** 唯一 id：渲染层按它复用 Mesh，运行时状态（耐久 / 归属）也按它索引 */
  id: string;
  /** 地物类型 */
  kind: TerrainKind;
  /** 中心点世界坐标 X */
  x: number;
  /** 中心点世界坐标 Y */
  y: number;
  /** 尺寸缩放：1 = spec 的默认半径与高度 */
  scale?: number;
  /** 绕 Z 轴旋转（弧度）：船厂用它决定朝陆 / 朝海的方向 */
  rotation?: number;
  /** 形状种子：决定海岸线 / 岩体分布；缺省由 id 派生 */
  seed?: number;
}

/** 矩形范围（世界坐标），RestrictArea 与地物查询共用 */
export interface TerrainBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
