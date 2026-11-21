// 地物参数表：几何半径、高度、碰撞半径、占位配色
// 数值集中在这里（对齐 weapons/spec.ts 的 WEAPON_SPECS），主场景和 playground 共用同一份配置。
//
// 这里刻意没有「贴图尺寸」：地物是 Babylon 网格 + 顶点色，不走 Canvas 贴图。
// 原因见 island.ts 顶部说明（正交俯视看不出问题，斜视角贴图会变成纸片）。
import type { TerrainKind } from "./types";

/** 单个地物的完整参数 */
export interface TerrainSpec {
  /** 地物类型 */
  kind: TerrainKind;
  /** 基准半径（世界单位）：岛屿是海岸线平均半径，礁石是整片范围，船厂是码头进深 */
  radius: number;
  /** 最高点相对海平面的高度（世界单位，沿 -Z 抬升） */
  height: number;
  /** 是否参与碰撞（船不能驶入 / 炮弹会被挡下） */
  solid: boolean;
  /**
   * 碰撞半径（世界单位）。
   * 这里刻意比 radius 大一点：几何是程序生成的不规则形状，圆碰撞只能取「最大外缘」，
   * 半径小了船就会插进沙滩里（穿模）。舰船自身的椭球在 ship/render-visual.ts 里定义。
   * TODO: 换成沿形状的碰撞多边形后，这个值可以收回 radius 附近。
   */
  collisionRadius: number;
  /** 小地图 / 图例用的顶面颜色 */
  color: string;
}

/** 地物参数表 */
export const TERRAIN_SPECS: Record<TerrainKind, TerrainSpec> = {
  // 岛屿：海图上的主要地标，尺寸最大
  // radius 210 是平均岸线半径，实际岸线在 0.81~1.19 倍之间抖动；
  // 水下的沙滩环（约占半径的 18%）不算陆地，所以碰撞半径取 215 而不是最大外缘 250。
  island: {
    kind: "island",
    radius: 210,
    height: 34,
    solid: true,
    collisionRadius: 215,
    color: "#4f7d52",
  },
  // 礁石：小、可以密集成群，主要作用是卡航道和制造浅水区
  // 岩块最远伸到 0.42 + 0.46 ≈ 0.88 倍 radius，取 52 覆盖。
  reef: {
    kind: "reef",
    radius: 55,
    height: 12,
    solid: true,
    collisionRadius: 52,
    color: "#5b6b70",
  },
  // 船厂：一半在岸上（码头 / 船台 / 吊车），一半在水里（船坞）。
  // solid = false 是有意的：岸的那一半本来就压在岛的碰撞里，而水的那一半是船坞，
  // 必须让船能开进去，否则「进厂检测」永远不可能成立。
  shipyard: {
    kind: "shipyard",
    radius: 90,
    height: 40,
    solid: false,
    collisionRadius: 0,
    color: "#8a8f98",
  },
};

/** 取地物参数 */
export function getTerrainSpec(kind: TerrainKind): TerrainSpec {
  return TERRAIN_SPECS[kind];
}
