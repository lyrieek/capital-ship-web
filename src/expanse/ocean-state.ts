// 海洋状态：全局唯一的海域设置，游戏主场景读取这里的状态。
// 默认浅海；不做设置界面，改 DEFAULT_OCEAN_KIND 或调用 setOceanKind 即可切换。
import { DEFAULT_OCEAN_KIND, type OceanKind } from "./ocean";

let currentKind: OceanKind = DEFAULT_OCEAN_KIND;

/** 当前海域 */
export function getOceanKind(): OceanKind {
  return currentKind;
}

/** 切换当前海域 */
export function setOceanKind(kind: OceanKind): void {
  currentKind = kind;
}

/** 恢复默认海域 */
export function resetOceanKind(): void {
  currentKind = DEFAULT_OCEAN_KIND;
}
