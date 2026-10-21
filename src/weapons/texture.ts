// 贴图辅助：把 Babylon 的 DynamicTexture 上下文当作标准 Canvas 2D 使用
import { Color3, type DynamicTexture, type Scene, StandardMaterial } from "@babylonjs/core";

// Babylon 的 ICanvasRenderingContext 未声明完整 Canvas2D API，运行时就是标准 2D 上下文
export function toCanvas2D(texture: DynamicTexture): CanvasRenderingContext2D {
  return texture.getContext() as unknown as CanvasRenderingContext2D;
}

/**
 * 通用的「自发光贴图」材质：忽略光照，颜色直接来自贴图，支持透明
 * @param name 材质名
 * @param texture 贴图
 * @param scene Babylon 场景
 */
export function createSpriteMaterial(name: string, texture: DynamicTexture, scene: Scene): StandardMaterial {
  // DynamicTexture.hasAlpha 默认 false，必须显式开启，否则透明区域会被当成不透明
  texture.hasAlpha = true;
  const material = new StandardMaterial(name, scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.emissiveColor = Color3.White();
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.useAlphaFromDiffuseTexture = true;
  material.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  return material;
}
