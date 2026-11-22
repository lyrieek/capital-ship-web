import type { Layer, Scene } from "@babylonjs/core";
import type { AdvancedDynamicTexture } from "@babylonjs/gui";

// GUI 图层角色：数值越小越先渲染（越靠下）。
export type GuiLayerRole = "shipHud" | "hud" | "modal";

const BASE_ORDER: Record<GuiLayerRole, number> = {
  shipHud: 0,
  hud: 1,
  modal: 2,
};

interface Entry {
  adt: AdvancedDynamicTexture;
  order: number;
  seq: number;
}

// 每个场景一份登记表。顺序由 order + 注册顺序决定，不再靠 layer 名字猜。
const registry = new WeakMap<Scene, Entry[]>();
let nextSeq = 0;

function applyOrder(scene: Scene): void {
  const entries = registry.get(scene);
  if (!entries) return;

  // 清掉已经销毁的 ADT
  for (let i = entries.length - 1; i >= 0; i--) {
    if (!entries[i].adt.layer) entries.splice(i, 1);
  }
  if (entries.length === 0) return;

  const ours = new Set<Layer>();
  for (const entry of entries) {
    const layer = entry.adt.layer;
    if (layer) ours.add(layer);
  }

  const layers = scene.layers;
  for (let i = layers.length - 1; i >= 0; i--) {
    if (ours.has(layers[i])) layers.splice(i, 1);
  }

  // 插入排序：GUI 图层数量很少，避免依赖 Array#toSorted
  const sorted: Entry[] = [];
  for (const entry of entries) {
    let index = sorted.length;
    while (index > 0) {
      const previous = sorted[index - 1];
      if (previous.order < entry.order || (previous.order === entry.order && previous.seq < entry.seq)) break;
      index -= 1;
    }
    sorted.splice(index, 0, entry);
  }

  for (const entry of sorted) {
    const layer = entry.adt.layer;
    if (layer) layers.push(layer);
  }
}

/** 登记一个全屏 GUI 图层，并按角色重排。 */
export function registerGuiLayer(adt: AdvancedDynamicTexture, role: GuiLayerRole): void {
  const scene = adt.getScene();
  if (!scene) return;

  let entries = registry.get(scene);
  if (!entries) {
    entries = [];
    registry.set(scene, entries);
  }

  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].adt === adt) entries.splice(i, 1);
  }
  entries.push({ adt, order: BASE_ORDER[role], seq: nextSeq++ });
  applyOrder(scene);
}

/** 注销 GUI 图层；应在 root.dispose() 之前调用。 */
export function unregisterGuiLayer(adt: AdvancedDynamicTexture): void {
  const scene = adt.getScene();
  if (!scene) return;

  const entries = registry.get(scene);
  if (!entries) return;

  const index = entries.findIndex((entry) => entry.adt === adt);
  if (index === -1) return;

  entries.splice(index, 1);
  applyOrder(scene);
}
