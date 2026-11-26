// 舰船模块入口：对外只暴露类型、建船工厂和具体舰种类。
// 实现在 ShipImpl.ts，舰种参数在 ship-class.ts，具体舰种类在 classes/。
export { ShipImpl } from "./ShipImpl";
export type { Ship, ShipConfig, SailOrder, ThreatItem, ShipClassId, TorpedoVolley, Bounds, SpawnableShip } from "./ship";
export { createShip, getTeamColors } from "./create-ship";
export { shipBounds } from "./bounds";
export { TorpedoBoat } from "./classes/TorpedoBoat";
export { Frigate } from "./classes/Frigate";
export { SHIP_CLASS_IDS, SHIP_CLASS_SPECS, getShipClassSpec } from "./ship-class";
export type { ShipClassSpec, ShipTurretSpec } from "./ship-class";
