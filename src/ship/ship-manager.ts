import type { ShipConfig } from "./ship";
import { SHIP_CLASS_IDS, type ShipClassId } from "./ship-class";

const CLASS_BASE: Record<ShipClassId, { light: string; dark: string }> = {
  torpedoBoat: { light: "#7cc4ff", dark: "#1d5c9e" },
  frigate: { light: "#ffb86b", dark: "#b85c2a" },
};

// 按阵营的舰船亮/暗面颜色
const TEAM_COLORS: Record<"red" | "blue", { light: string; dark: string }> = {
  red: { light: "#ff7b6b", dark: "#b8322a" },
  blue: { light: "#7cc4ff", dark: "#1d5c9e" },
};

/** 颜色偏移上限：允许在舰种基色上做轻微色相调整，避免偏离阵营识别色 */
export const COLOR_OFFSET_LIMIT = 12;

/** 把任意输入收拢到 [-15°, 15°] 的整数偏移 */
export function clampColorOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-COLOR_OFFSET_LIMIT, Math.min(COLOR_OFFSET_LIMIT, Math.round(value)));
}

const NAME_POOL = [
  "中山",
  "永平",
  "致远",
  "经远",
  "肇和",
  "平远",
  "靖远",
  "来远",
  "通济",
  "济安",
  "安东",
  "鞍山",
  "长春",
  "太仓",
  "宜宾",
  "定远",
  "镇远",
  "广丙",
  "广乙",
  "济远",
  "康济",
  "庆安",
  "文和",
  "永安",
  "永昌",
  "剑南",
  "南平",
  "永宁",
  "宁远",
  "靖海",
  "建昌",
  "安庆",
  "扬州",
  "徐州",
  "青州",
];

/** 新对局默认舰船池：共 30 艘，其中护卫舰 10 艘排在前面，其余为鱼雷艇；红蓝各 15 艘 */
const DEFAULT_ROSTER: { shipClass: ShipClassId; team: "red" | "blue" }[] = [
  // 护卫舰（排在前面）
  { shipClass: "frigate", team: "red" },
  { shipClass: "frigate", team: "red" },
  { shipClass: "frigate", team: "red" },
  { shipClass: "frigate", team: "red" },
  { shipClass: "frigate", team: "red" },
  { shipClass: "frigate", team: "blue" },
  { shipClass: "frigate", team: "blue" },
  { shipClass: "frigate", team: "blue" },
  { shipClass: "frigate", team: "blue" },
  { shipClass: "frigate", team: "blue" },
  // 鱼雷艇
  { shipClass: "torpedoBoat", team: "red" },
  { shipClass: "torpedoBoat", team: "red" },
  { shipClass: "torpedoBoat", team: "red" },
  { shipClass: "torpedoBoat", team: "red" },
  { shipClass: "torpedoBoat", team: "red" },
  { shipClass: "torpedoBoat", team: "red" },
  { shipClass: "torpedoBoat", team: "red" },
  { shipClass: "torpedoBoat", team: "red" },
  { shipClass: "torpedoBoat", team: "red" },
  { shipClass: "torpedoBoat", team: "red" },
  { shipClass: "torpedoBoat", team: "blue" },
  { shipClass: "torpedoBoat", team: "blue" },
  { shipClass: "torpedoBoat", team: "blue" },
  { shipClass: "torpedoBoat", team: "blue" },
  { shipClass: "torpedoBoat", team: "blue" },
  { shipClass: "torpedoBoat", team: "blue" },
  { shipClass: "torpedoBoat", team: "blue" },
  { shipClass: "torpedoBoat", team: "blue" },
  { shipClass: "torpedoBoat", team: "blue" },
  { shipClass: "torpedoBoat", team: "blue" },
];

export interface ShipEntry {
  id: string;
  name: string;
  shipClass: ShipClassId;
  colorOffset: number;
  team?: "red" | "blue" | null;
  nameKey?: string;
}

export function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

function toHexByte(value: number): string {
  const n = Math.round(value);
  const clamped = Math.max(0, Math.min(255, n));
  const s = clamped.toString(16);
  return s.length === 1 ? `0${s}` : s;
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  let hue = 0;
  let saturation = 0;
  const lightness = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    saturation = lightness > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === red) {
      hue = (green - blue) / d + (green < blue ? 6 : 0);
    } else if (max === green) {
      hue = (blue - red) / d + 2;
    } else {
      hue = (red - green) / d + 4;
    }
    hue /= 6;
  }
  return { h: hue * 360, s: saturation * 100, l: lightness * 100 };
}

const hue2rgb = (p: number, q: number, t: number): number => {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
};

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hh = h / 360;
  const ss = s / 100;
  const ll = l / 100;
  let red = 0;
  let green = 0;
  let blue = 0;
  if (ss === 0) {
    red = ll;
    green = ll;
    blue = ll;
  } else {
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    const p = 2 * ll - q;
    red = hue2rgb(p, q, hh + 1 / 3);
    green = hue2rgb(p, q, hh);
    blue = hue2rgb(p, q, hh - 1 / 3);
  }
  return { r: Math.round(red * 255), g: Math.round(green * 255), b: Math.round(blue * 255) };
}

export function shiftHue(hex: string, deg: number): string {
  const { r, g, b } = parseHex(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  let nh = h + deg;
  while (nh < 0) nh += 360;
  nh %= 360;
  const { r: nr, g: ng, b: nb } = hslToRgb(nh, s, l);
  return rgbToHex(nr, ng, nb);
}

export function getBaseColors(shipClass: ShipClassId): { light: string; dark: string } {
  return CLASS_BASE[shipClass];
}

/** 在舰种基色上应用颜色偏移，得到这艘船实际的亮面 / 暗面颜色 */
export function getShipColors(entry: ShipEntry): { light: string; dark: string } {
  const base = TEAM_COLORS[entry.team ?? "red"];
  return {
    light: shiftHue(base.light, entry.colorOffset),
    dark: shiftHue(base.dark, entry.colorOffset),
  };
}

/** 把编辑用的舰船条目转换成游戏建船配置；中立阵营在配置里按红方处理 */
export function toShipConfig(entry: ShipEntry): ShipConfig {
  const { light, dark } = getShipColors(entry);
  return {
    name: entry.name,
    nameKey: entry.nameKey,
    shipClass: entry.shipClass,
    light,
    dark,
    team: entry.team ?? "red",
  };
}

// ShipManager 只在内存中维护当前编辑的舰队，不做本地持久化；
// 需要保存时由页面导出 JSON。
export class ShipManager {
  ships: ShipEntry[] = [];
  private listeners: (() => void)[] = [];

  constructor() {
    const used = new Set<string>();
    for (const entry of DEFAULT_ROSTER) {
      const name = ShipManager.randomName(used);
      used.add(name);
      this.add({ name, ...entry });
    }
  }

  subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      const index = this.listeners.indexOf(cb);
      if (index !== -1) this.listeners.splice(index, 1);
    };
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  private static normalizeEntries(entries: unknown[]): ShipEntry[] {
    return entries
      .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
      .map((e) => ({
        id: typeof e.id === "string" && e.id ? e.id : crypto.randomUUID(),
        name: typeof e.name === "string" && e.name ? e.name : ShipManager.randomName(new Set()),
        shipClass: SHIP_CLASS_IDS.includes(e.shipClass as ShipClassId) ? (e.shipClass as ShipClassId) : "torpedoBoat",
        colorOffset: ShipManager.normalizeOffset(e.colorOffset),
        team: e.team === "red" || e.team === "blue" || e.team === null ? (e.team as "red" | "blue" | null) : undefined,
        nameKey: typeof e.nameKey === "string" ? e.nameKey : undefined,
      }));
  }

  private static normalizeOffset(value: unknown): number {
    return typeof value === "number" ? clampColorOffset(value) : 0;
  }

  export(): ShipEntry[] {
    return structuredClone(this.ships);
  }

  import(entries: unknown[], mode: "replace" | "merge" = "replace"): void {
    const normalized = ShipManager.normalizeEntries(entries);
    if (mode === "replace") {
      this.ships = normalized;
    } else {
      const byId = new Map<string, ShipEntry>();
      for (const entry of this.ships) byId.set(entry.id, entry);
      for (const entry of normalized) byId.set(entry.id, entry);
      this.ships = [...byId.values()];
    }
    this.notify();
  }

  add(entry?: Partial<ShipEntry>): ShipEntry {
    const used = new Set<string>();
    for (const s of this.ships) used.add(s.name);
    const ship: ShipEntry = {
      id: crypto.randomUUID(),
      name: entry?.name ?? ShipManager.randomName(used),
      shipClass: entry?.shipClass ?? "torpedoBoat",
      colorOffset: entry?.colorOffset === undefined ? ShipManager.randomColorOffset() : clampColorOffset(entry.colorOffset),
      team: entry?.team ?? null,
      nameKey: entry?.nameKey,
    };
    this.ships.push(ship);
    this.notify();
    return ship;
  }

  remove(id: string): void {
    this.ships = this.ships.filter((s) => s.id !== id);
    this.notify();
  }

  duplicate(id: string): ShipEntry | undefined {
    const index = this.ships.findIndex((s) => s.id === id);
    if (index === -1) return undefined;
    const source = this.ships[index];
    const used = new Set(this.ships.map((s) => s.name));
    const copy: ShipEntry = {
      id: crypto.randomUUID(),
      name: ShipManager.randomName(used),
      shipClass: source.shipClass,
      colorOffset: source.colorOffset,
      team: source.team ?? null,
      nameKey: source.nameKey,
    };
    this.ships.splice(index + 1, 0, copy);
    this.notify();
    return copy;
  }

  update(id: string, patch: Partial<ShipEntry>): void {
    const ship = this.ships.find((s) => s.id === id);
    if (!ship) return;
    Object.assign(ship, patch);
    if (patch.colorOffset !== undefined) ship.colorOffset = clampColorOffset(patch.colorOffset);
    this.notify();
  }

  move(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.ships.length) return;
    if (toIndex < 0 || toIndex >= this.ships.length) return;
    if (fromIndex === toIndex) return;
    const [removed] = this.ships.splice(fromIndex, 1);
    this.ships.splice(toIndex, 0, removed);
    this.notify();
  }

  clear(): void {
    this.ships = [];
    this.notify();
  }

  static randomName(exclude: Set<string> = new Set<string>()): string {
    const pool = NAME_POOL.filter((n) => !exclude.has(n));
    const source = pool.length > 0 ? pool : NAME_POOL;
    return source[Math.floor(Math.random() * source.length)];
  }

  static randomColorOffset(): number {
    return Math.floor(Math.random() * (COLOR_OFFSET_LIMIT * 2 + 1)) - COLOR_OFFSET_LIMIT;
  }

  randomizeAll(): void {
    const used = new Set<string>();
    for (const ship of this.ships) {
      const name = ShipManager.randomName(used);
      used.add(name);
      ship.name = name;
      ship.colorOffset = ShipManager.randomColorOffset();
    }
    this.notify();
  }

  get(index: number): ShipEntry | undefined {
    return this.ships[index];
  }

  all(): ShipEntry[] {
    return this.ships;
  }

  count(): number {
    return this.ships.length;
  }

  findById(id: string): ShipEntry | undefined {
    return this.ships.find((s) => s.id === id);
  }
}

export const shipManager = new ShipManager();
