// 鱼雷艇：小型高速舰，两门火炮，鱼雷齐射 3~5 枚。
import { ShipImpl } from "../ShipImpl";
import type { ShipConfig } from "../ship";

export class TorpedoBoat extends ShipImpl {
  constructor(cfg: ShipConfig) {
    super({ ...cfg, shipClass: "torpedoBoat" });
  }
}
