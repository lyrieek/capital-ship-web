// 行动模式入口：按舰种选择默认行为。
// 控制优先级：玩家手动指令 > 鱼雷规避 > ActionMode > 默认巡航。
import type { ShipClassId } from "../ship";
import type { ActionMode } from "./ActionMode";
import { SmallShipAction } from "./SmallShipAction";

export { ActionMode } from "./ActionMode";
export type { ActionIntent } from "./ActionMode";
export { SmallShipAction } from "./SmallShipAction";

/**
 * 按舰种创建默认行动模式。
 *
 * 目前鱼雷艇和护卫舰都使用同一套环绕炮战逻辑；
 * 后续如果护卫舰需要「停船炮战 / 更慢转向 / 更远射界」等差异，
 * 在这里按舰种返回专门的 ActionMode 即可。
 */
export function createDefaultActionMode(_shipClass: ShipClassId): ActionMode {
  // TODO(舰种差异): 按 shipClass 分支，给护卫舰单独的行动模式。
  return new SmallShipAction();
}
