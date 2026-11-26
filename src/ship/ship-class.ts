// 舰种（舰级）数据表：尺寸、生命值、炮塔布局与鱼雷齐射数量集中在这里。
// 具体舰船类（TorpedoBoat / Frigate）只负责声明自己使用哪一份配置，
// 数值平衡、调试页展示和后续主游戏刷新都读同一张表。
import { P } from "../game/utils";

/** 已实现的舰种 */
export type ShipClassId = "torpedoBoat" | "frigate";

/** 单个炮塔在舰体上的安装位置 */
export interface ShipTurretSpec {
  /** 沿舰体本地 X 轴的位置比例：+ 舰首，- 舰尾；实际偏移 = 比例 × 舰长 */
  offsetRatio: number;
  /** 相对主炮塔的缩放 */
  scale: number;
  /** 非交战时的停靠朝向：缺省朝舰首；舰尾炮通常朝后 */
  facing?: "forward" | "aft";
}

/** 一种舰船的完整参数 */
export interface ShipClassSpec {
  /** 舰种标识 */
  id: ShipClassId;
  /** 舰种名称的 i18n key */
  nameKey: string;
  /** 舰长（世界像素） */
  len: number;
  /** 舰宽（世界像素） */
  wid: number;
  /** 最大生命值 */
  maxHp: number;
  /** 巡航速度系数（相对 P.moveSpeed） */
  cruiseFactor: number;
  /** 炮塔布局；数量即火炮数量 */
  turrets: readonly ShipTurretSpec[];
  /** 鱼雷单轮齐射数量下限 */
  torpedoSalvoMin: number;
  /** 鱼雷单轮齐射数量上限 */
  torpedoSalvoMax: number;
}

/** 舰种参数表 */
export const SHIP_CLASS_SPECS: Record<ShipClassId, ShipClassSpec> = {
  // 鱼雷艇：现有舰船的默认形态，体积小、速度快，两门炮（舰首主炮 + 舰尾副炮）
  torpedoBoat: {
    id: "torpedoBoat",
    nameKey: "ship.class.torpedoBoat",
    len: 100,
    wid: 30,
    maxHp: 150,
    cruiseFactor: P.normalFactor,
    turrets: [
      { offsetRatio: 0.186, scale: 1 },
      { offsetRatio: -0.1945, scale: 0.72, facing: "aft" },
    ],
    torpedoSalvoMin: 3,
    torpedoSalvoMax: 5,
  },
  // 护卫舰：舰体更大、更耐打，三门炮（舰首 / 舰体中部 / 舰尾），鱼雷数量与鱼雷艇一致
  frigate: {
    id: "frigate",
    nameKey: "ship.class.frigate",
    len: 150,
    wid: 42,
    maxHp: 360,
    cruiseFactor: P.normalFactor * 0.9,
    turrets: [
      { offsetRatio: 0.3, scale: 1 },
      { offsetRatio: 0.02, scale: 0.9 },
      { offsetRatio: -0.3, scale: 0.85, facing: "aft" },
    ],
    torpedoSalvoMin: 3,
    torpedoSalvoMax: 5,
  },
};

/** 取舰种参数；未知舰种由调用方保证不会传入 */
export function getShipClassSpec(id: ShipClassId): ShipClassSpec {
  return SHIP_CLASS_SPECS[id];
}

/** 全部舰种（按展示顺序） */
export const SHIP_CLASS_IDS: ShipClassId[] = ["torpedoBoat", "frigate"];
