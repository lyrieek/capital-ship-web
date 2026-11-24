// 海岸线几何：只包含纯数学，不依赖 Babylon。
// 3D 岛屿网格、小地图、船厂落位校验都引用同一份函数，保证岸线形状完全一致。
import type { TerrainSpec } from "./spec";

// 岸线：几个不同频率的正弦叠加当「伪噪声」。
// 不引噪声库是因为形状必须可复现——同一个 seed 每次生成的岛屿完全一致，
// 摆位表、碰撞半径、小地图、船厂校验才能对得上。
export function coastlineScale(angle: number, seed: number): number {
  const phase = seed * 1.7;
  return 1 + 0.12 * Math.sin(angle * 3 + phase) + 0.07 * Math.sin(angle * 7 + phase * 2.3) + 0.04 * Math.sin(angle * 13 + phase * 4.1);
}

/**
 * 岸线在指定角度上的半径（世界单位，未乘 item.scale）
 * 渲染、小地图、船厂落位校验共用同一个函数。
 */
export function islandRadiusAt(angle: number, spec: TerrainSpec, seed: number): number {
  return spec.radius * coastlineScale(angle, seed);
}
