// 行动模式入口：按舰种选择默认行为。
// 控制优先级：玩家手动指令 > 鱼雷规避 > ActionMode > 默认巡航。
import type { ShipKind } from "../ship";
import type { ActionMode } from "./ActionMode";
import { SmallShipAction } from "./SmallShipAction";

export { ActionMode } from "./ActionMode";
export type { ActionIntent } from "./ActionMode";
export { SmallShipAction } from "./SmallShipAction";

/**
 * 按舰种创建默认行动模式。
 *
 * TODO(大型舰): 大型舰模式（可停船炮战、更慢转向、更远射界）尚未实现，
 * 目前 "capital" 也暂时使用 SmallShipAction 占位；
 * ShipKind / CapitalShipTraits 已在 ship.d.ts 预留类型。
 */
export function createDefaultActionMode(_kind: ShipKind): ActionMode {
  // 小型舰 / 大型舰目前都走同一套环绕炮战；大型舰的差异留给后续实现。
  // TODO(大型舰): 按 kind 分支，capital 返回专门的行动模式。
  return new SmallShipAction();
}
