import { Vector3 } from "@babylonjs/core";

export const W = 1600;
export const H = 900;

export function worldToScene(x: number, y: number, z = 0): Vector3 {
  return new Vector3(x - W / 2, H / 2 - y, z);
}
