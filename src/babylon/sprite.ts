import { MeshBuilder, type DynamicTexture, type Scene, type StandardMaterial } from "@babylonjs/core";
import { createSpriteMaterial as weaponSpriteMaterial, toCanvas2D as weaponToCanvas2D } from "../weapons/texture";

export function createPlane(name: string, width: number, height: number, scene: Scene, group?: number) {
  const mesh = MeshBuilder.CreatePlane(name, { width, height }, scene);
  if (typeof group === "number") mesh.renderingGroupId = group;
  mesh.isPickable = false;
  return mesh;
}

export function createSpriteMaterial(name: string, texture: DynamicTexture, scene: Scene): StandardMaterial {
  return weaponSpriteMaterial(name, texture, scene);
}

export function toCanvas2D(texture: DynamicTexture): CanvasRenderingContext2D {
  return weaponToCanvas2D(texture);
}
