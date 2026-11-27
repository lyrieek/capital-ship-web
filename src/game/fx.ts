// 表现事件队列：玩法层只描述「在哪发生了什么」，具体粒子由渲染层用 SolidParticleSystem 播放。
// 刻意不 import Babylon，保证模拟逻辑和渲染解耦（固定步长 / 回放时粒子不进模拟状态）。
export type FxKind = "burst" | "smoke" | "splash" | "wake";

export interface FxEvent {
  kind: FxKind;
  /** 世界坐标（原点左上、Y 向下） */
  x: number;
  y: number;
  /** burst / splash 的粒子数；smoke 固定为 3 */
  count: number;
  /** 粒子颜色（六位十六进制）；smoke / splash 由渲染层按类型选色 */
  color: string;
  /** 船航向（弧度），wake 专用 */
  angle?: number;
  /** 航速 px/s，wake 专用，决定尾流长度与发射密度 */
  speed?: number;
}

const queue: FxEvent[] = [];

/** 爆炸 / 命中 / 陆地撞击：在世界坐标 (x, y) 迸发 count 个指定颜色的粒子 */
export function emitBurst(x: number, y: number, count: number, color: string): void {
  if (count <= 0) return;
  queue.push({ kind: "burst", x, y, count, color });
}

/** 受损冒烟：在世界坐标 (x, y) 生成一缕烟 */
export function emitSmoke(x: number, y: number): void {
  queue.push({ kind: "smoke", x, y, count: 3, color: "" });
}

/** 弹药落海：在世界坐标 (x, y) 生成向上喷起并受重力回落的水花 */
export function emitSplash(x: number, y: number): void {
  queue.push({ kind: "splash", x, y, count: 18, color: "#e6f8ff" });
}

/** 船尾迹：在世界坐标 (x, y) 沿船尾反方向生成半透明尾迹粒子。
 * 粒子数随航速递增（越快越密，拼成连续淡带），颜色与海面同色系，透明度低，避免喧宾夺主。
 * 调用方在 render 层按船航向与位置计算船尾点，并每帧重复发送，船停/沉后不再发送；
 * 已在屏上的粒子按各自生命自然逐帧淡至 0，稳定消失、无残留。
 */
export function emitWake(x: number, y: number, angle: number, speed: number): void {
  // 每次发射 2~3 颗即可连成泡沫带；发射频率由调用方按航迹距离控制，不再逐帧刷粒子
  const count = Math.max(2, Math.min(4, Math.round(speed / 40)));
  queue.push({ kind: "wake", x, y, count, color: "#d6eaf8", angle, speed });
}

/** 取走本帧累积的事件；渲染层每帧调用一次 */
export function drainFxEvents(): FxEvent[] {
  if (queue.length === 0) return [];
  return queue.splice(0);
}
