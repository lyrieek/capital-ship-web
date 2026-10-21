// 鱼雷的绘制
// 贴图用 Canvas 2D 矢量笔触画好，再交给 Babylon 的 DynamicTexture 使用。
import { DynamicTexture, type Scene } from "@babylonjs/core";
import { getWeaponSpec } from "./spec";
import { toCanvas2D } from "./texture";

const TAU = Math.PI * 2;

/**
 * 绘制鱼雷贴图
 * @param ctx 2D 上下文
 * @param width 贴图宽度
 * @param height 贴图高度
 */
export function paintTorpedo(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);

  // 尾翼
  ctx.fillStyle = "rgba(142,231,255,.55)";
  ctx.beginPath();
  ctx.moveTo(-width * 0.3, 0);
  ctx.lineTo(-width * 0.42, -height * 0.34);
  ctx.lineTo(-width * 0.42, height * 0.34);
  ctx.closePath();
  ctx.fill();

  // 弹体
  ctx.fillStyle = "#8ee7ff";
  ctx.beginPath();
  ctx.ellipse(0, 0, width * 0.35, height * 0.32, 0, 0, TAU);
  ctx.fill();

  // 弹头高光
  ctx.fillStyle = "#e6fbff";
  ctx.beginPath();
  ctx.arc(width * 0.22, 0, height * 0.16, 0, TAU);
  ctx.fill();

  ctx.restore();
}

/**
 * 创建鱼雷贴图
 * @param scene Babylon 场景
 */
export function createTorpedoTexture(scene: Scene): DynamicTexture {
  const spec = getWeaponSpec("torp");
  const texture = new DynamicTexture("torpedoTexture", { width: spec.textureWidth, height: spec.textureHeight }, scene, true);
  paintTorpedo(toCanvas2D(texture), spec.textureWidth, spec.textureHeight);
  texture.update();
  return texture;
}
