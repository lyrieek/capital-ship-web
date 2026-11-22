// 表现事件队列：玩法层只描述「在哪发生了什么」，具体粒子由渲染层用 SolidParticleSystem 播放。
// 刻意不 import Babylon，保证模拟逻辑和渲染解耦（固定步长 / 回放时粒子不进模拟状态）。
export type FxKind = "burst" | "smoke";

export interface FxEvent {
  kind: FxKind;
  /** 世界坐标（原点左上、Y 向下） */
  x: number;
  y: number;
  /** burst 的粒子数；smoke 固定为 3 */
  count: number;
  /** 粒子颜色（六位十六进制）；smoke 由渲染层从烟色表里随机 */
  color: string;
}

const queue: FxEvent[] = [];

/** 爆炸 / 命中 / 水花：在世界坐标 (x, y) 迸发 count 个指定颜色的粒子 */
export function emitBurst(x: number, y: number, count: number, color: string): void {
  if (count <= 0) return;
  queue.push({ kind: "burst", x, y, count, color });
}

/** 受损冒烟：在世界坐标 (x, y) 生成一缕烟 */
export function emitSmoke(x: number, y: number): void {
  queue.push({ kind: "smoke", x, y, count: 3, color: "" });
}

/** 取走本帧累积的事件；渲染层每帧调用一次 */
export function drainFxEvents(): FxEvent[] {
  if (queue.length === 0) return [];
  return queue.splice(0);
}
