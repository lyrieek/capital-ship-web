import { Vector3 } from "@babylonjs/core";
import { WORLD_H, WORLD_W } from "../game/world";

// 世界坐标（原点左上、Y 向下）→ 场景坐标（原点居中、Y 向上）
export function worldToScene(x: number, y: number, z = 0): Vector3 {
  return new Vector3(x - WORLD_W / 2, WORLD_H / 2 - y, z);
}
