import type { AdvancedDynamicTexture } from "@babylonjs/gui";

export function sendGuiLayerToBack(adt: AdvancedDynamicTexture): void {
  const layer = adt.layer;
  const scene = adt.getScene();
  if (!layer || !scene) return;
  const layers = scene.layers;
  const index = layers.indexOf(layer);
  if (index === -1) return;
  layers.splice(index, 1);
  layers.unshift(layer);
}

export function sendGuiLayerToFront(adt: AdvancedDynamicTexture): void {
  const layer = adt.layer;
  const scene = adt.getScene();
  if (!layer || !scene) return;
  const layers = scene.layers;
  const index = layers.indexOf(layer);
  if (index === -1) return;
  layers.splice(index, 1);
  layers.push(layer);
}

export function insertGuiLayerBeforeModels(adt: AdvancedDynamicTexture): void {
  const layer = adt.layer;
  const scene = adt.getScene();
  if (!layer || !scene) return;
  const layers = scene.layers;
  const index = layers.indexOf(layer);
  if (index !== -1) layers.splice(index, 1);
  const modelIndex = layers.findIndex((item) => item.name.startsWith("model"));
  if (modelIndex === -1) {
    layers.push(layer);
    return;
  }
  layers.splice(modelIndex, 0, layer);
}
