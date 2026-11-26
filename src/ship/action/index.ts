// 行动模式入口：按舰种选择默认行为。
// 控制优先级：玩家手动指令 > 鱼雷规避 > ActionMode > 默认巡航。
import type { ShipClassId } from "../ship";
import type { ActionMode } from "./ActionMode";
import { FrigateAction } from "./FrigateAction";
import { TorpedoBoatAction } from "./TorpedoBoatAction";

export { ActionMode } from "./ActionMode";
export type { ActionIntent } from "./ActionMode";
export { FrigateAction } from "./FrigateAction";
export { SmallShipAction } from "./SmallShipAction";
export { TorpedoBoatAction } from "./TorpedoBoatAction";

/**
 * 按舰种创建默认行动模式：
 * - 鱼雷艇：环绕炮战 + 局部以少打多时「甩雷后撤」；
 * - 护卫舰：更远距离的保守炮战，保持友舰间距，对远处目标有概率观望。
 */
export function createDefaultActionMode(shipClass: ShipClassId): ActionMode {
  return shipClass === "frigate" ? new FrigateAction() : new TorpedoBoatAction();
}
