// 护卫舰：舰体更大、更耐打，三门火炮；鱼雷数量与鱼雷艇一致（3~5 枚）。
import { ShipImpl } from "../ShipImpl";
import type { ShipConfig } from "../ship";

export class Frigate extends ShipImpl {
  constructor(cfg: ShipConfig) {
    super({ ...cfg, shipClass: "frigate" });
  }
}
