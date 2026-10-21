// 主炮（炮弹）的绘制
// 贴图用 Canvas 2D 矢量笔触画好，再交给 Babylon 的 DynamicTexture 使用。
import { DynamicTexture, type Scene } from "@babylonjs/core";
import { getWeaponSpec } from "./spec";
import { toCanvas2D } from "./texture";

const TAU = Math.PI * 2;

/**
 * 绘制炮弹贴图
 * @param ctx 2D 上下文
 * @param width 贴图宽度
 * @param height 贴图高度
 */
export function paintCannon(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;

  // 外圈光晕
  ctx.beginPath();
  ctx.arc(cx, cy, width * 0.25, 0, TAU);
  ctx.fillStyle = "rgba(255,210,100,.22)";
  ctx.fill();

  // 弹体
  ctx.beginPath();
  ctx.arc(cx, cy, width * 0.12, 0, TAU);
  ctx.fillStyle = "#ffe08a";
  ctx.fill();

  // 高光
  ctx.beginPath();
  ctx.arc(cx - width * 0.04, cy - width * 0.04, width * 0.05, 0, TAU);
  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.fill();
}

/**
 * 创建炮弹贴图
 * @param scene Babylon 场景
 */
export function createCannonTexture(scene: Scene): DynamicTexture {
  const spec = getWeaponSpec("shell");
  const texture = new DynamicTexture("cannonTexture", { width: spec.textureWidth, height: spec.textureHeight }, scene, true);
  paintCannon(toCanvas2D(texture), spec.textureWidth, spec.textureHeight);
  texture.update();
  return texture;
}
