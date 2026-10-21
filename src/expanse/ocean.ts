// 海洋（海浪）绘制模块
// 从游戏渲染层抽离成独立模块：主场景直接使用，playground 里也能单独调试。
// 绘制沿用 Canvas 2D 矢量笔触，输出到 Babylon 的 DynamicTexture。
import { Color3, DynamicTexture, MeshBuilder, type Scene, StandardMaterial } from "@babylonjs/core";

const TAU = Math.PI * 2;

/** 海域种类：浅海 / 深海 */
export type OceanKind = "shallow" | "deep";

/** 游戏默认海域（浅海）。不做设置界面，改这一处即可切换。 */
export const DEFAULT_OCEAN_KIND: OceanKind = "shallow";

/** 单个海域的绘制参数 */
export interface OceanPreset {
  kind: OceanKind;
  /** 竖直渐变色：顶部 / 中部 / 底部 */
  gradient: readonly [string, string, string];
  /** 波纹线条颜色 */
  waveStroke: string;
  /** 波纹行数 */
  waveRows: number;
  /** 波峰振幅（相对画面高度） */
  waveAmplitude: number;
  /** 横向整屏周期数 */
  waveFrequency: number;
  /** 波动速度（相位/秒） */
  waveSpeed: number;
  /** 单条波纹的采样分段数 */
  waveSegments: number;
  /** 波纹线宽 */
  lineWidth: number;
  /** 浅海：波峰白沫 */
  foam: boolean;
  /** 浅海：透光焦散 */
  caustics: boolean;
  /** 深海：四周压暗 */
  vignette: boolean;
  /** 深海：浮游微光 */
  sparkle: boolean;
}

/** 海域参数表 */
export const OCEAN_PRESETS: Record<OceanKind, OceanPreset> = {
  shallow: {
    kind: "shallow",
    gradient: ["#0d4a5e", "#1a87a3", "#0d4a5e"],
    waveStroke: "rgba(170,240,255,.16)",
    waveRows: 14,
    waveAmplitude: 0.01,
    waveFrequency: 3,
    waveSpeed: 1.9,
    waveSegments: 60,
    lineWidth: 1.6,
    foam: true,
    caustics: true,
    vignette: false,
    sparkle: false,
  },
  deep: {
    kind: "deep",
    gradient: ["#0a2c44", "#0d3c5c", "#0a2c44"],
    waveStroke: "rgba(120,200,255,.075)",
    waveRows: 10,
    waveAmplitude: 0.012,
    waveFrequency: 2,
    waveSpeed: 1.6,
    waveSegments: 40,
    lineWidth: 2,
    foam: false,
    caustics: false,
    vignette: true,
    sparkle: true,
  },
};

// 稳定伪随机：保证浮游微光等装饰每帧位置一致，不会闪烁
function pseudoRandom(seed: number): number {
  const v = Math.sin(seed * 12.9898) * 43_758.5453;
  return v - Math.floor(v);
}

// 底层波纹：横向正弦曲线，按行错开相位
function paintWaves(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, preset: OceanPreset): void {
  ctx.strokeStyle = preset.waveStroke;
  ctx.lineWidth = preset.lineWidth;
  const step = width / preset.waveSegments;
  const amplitude = height * preset.waveAmplitude;
  for (let i = 0; i < preset.waveRows; i++) {
    const baseY = ((i + 1) / (preset.waveRows + 1)) * height;
    const phase = time * preset.waveSpeed + i;
    ctx.beginPath();
    for (let x = 0; x <= width; x += step) {
      const y = baseY + Math.sin((x / width) * TAU * preset.waveFrequency + phase) * amplitude;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// 浅海焦散：几道大而慢的透光波纹，制造浅水折射的抖动感
function paintCaustics(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
  ctx.save();
  ctx.strokeStyle = "rgba(190,255,255,.055)";
  ctx.lineWidth = 3;
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const baseY = ((i + 0.5) / bands) * height;
    const phase = time * 0.42 + i * 1.3;
    ctx.beginPath();
    for (let x = 0; x <= width; x += width / 24) {
      const y = baseY + Math.sin((x / width) * TAU * 0.75 + phase) * height * 0.022;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// 浅海白沫：在波峰（相位 π/2 + 2πn）上点出一小段亮线
function paintFoam(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, preset: OceanPreset): void {
  ctx.save();
  ctx.strokeStyle = "rgba(235,255,255,.3)";
  ctx.lineWidth = 1.3;
  const amplitude = height * preset.waveAmplitude;
  const spacing = width / preset.waveFrequency;
  for (let i = 0; i < preset.waveRows; i++) {
    const baseY = ((i + 1) / (preset.waveRows + 1)) * height;
    const phase = time * preset.waveSpeed + i;
    const firstX = ((Math.PI / 2 - phase) / (TAU * preset.waveFrequency)) * width;
    const from = Math.ceil((-spacing * 0.25 - firstX) / spacing);
    const to = Math.floor((width + spacing * 0.25 - firstX) / spacing);
    for (let k = from; k <= to; k++) {
      const center = firstX + k * spacing;
      const half = spacing * 0.09;
      ctx.beginPath();
      for (let x = center - half; x <= center + half; x += half / 3) {
        const y = baseY + Math.sin((x / width) * TAU * preset.waveFrequency + phase) * amplitude;
        if (x === center - half) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// 深海压暗：四周渐暗，强化纵深
function paintVignette(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.2,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.72,
  );
  gradient.addColorStop(0, "rgba(0,6,14,0)");
  gradient.addColorStop(1, "rgba(0,6,14,.55)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

// 深海浮游微光：固定位置、按时间明暗闪烁
function paintSparkle(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
  ctx.save();
  ctx.fillStyle = "#cfe9ff";
  for (let i = 0; i < 36; i++) {
    const x = pseudoRandom(i * 3 + 1) * width;
    const y = pseudoRandom(i * 7 + 5) * height;
    const twinkle = 0.5 + 0.5 * Math.sin(time * 1.6 + i * 2.1);
    ctx.globalAlpha = 0.04 + twinkle * 0.1;
    ctx.beginPath();
    ctx.arc(x, y, 1.2, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 绘制整片海洋（time 用于波浪相位动画）
 * @param kind 海域种类，决定颜色和波浪参数
 */
export function paintOcean(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, kind: OceanKind = DEFAULT_OCEAN_KIND): void {
  const preset = OCEAN_PRESETS[kind];

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, preset.gradient[0]);
  gradient.addColorStop(0.5, preset.gradient[1]);
  gradient.addColorStop(1, preset.gradient[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  if (preset.caustics) paintCaustics(ctx, width, height, time);
  paintWaves(ctx, width, height, time, preset);
  if (preset.foam) paintFoam(ctx, width, height, time, preset);
  if (preset.vignette) paintVignette(ctx, width, height);
  if (preset.sparkle) paintSparkle(ctx, width, height, time);
}

/**
 * 重绘并上传海洋贴图（每帧调用以播放波浪动画）
 */
export function refreshOcean(texture: DynamicTexture, width: number, height: number, time: number, kind: OceanKind = DEFAULT_OCEAN_KIND): void {
  // Babylon 的 ICanvasRenderingContext 未声明完整 Canvas2D API，运行时就是标准 2D 上下文
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  paintOcean(ctx, width, height, time, kind);
  texture.update();
}

/**
 * 创建海洋贴图并绘制首帧
 */
export function createOceanTexture(scene: Scene, kind: OceanKind, width: number, height: number): DynamicTexture {
  const texture = new DynamicTexture(`oceanTexture_${kind}`, { width, height }, scene, true);
  refreshOcean(texture, width, height, 0, kind);
  return texture;
}

// 海洋材质：忽略光照，颜色直接来自贴图（与舰船贴图同一套自发光做法）
function createOceanMaterial(scene: Scene, texture: DynamicTexture): StandardMaterial {
  texture.hasAlpha = true;
  const material = new StandardMaterial("oceanMaterial", scene);
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

/** 铺在场景里的海面（贴图 + 材质 + 平面） */
export interface OceanSurface {
  mesh: ReturnType<typeof MeshBuilder.CreatePlane>;
  material: StandardMaterial;
  texture: DynamicTexture;
  kind: OceanKind;
  textureWidth: number;
  textureHeight: number;
  /** 切换海域种类，下一帧生效 */
  setKind(kind: OceanKind): void;
  /** 重绘海面（传入动画时间，秒） */
  refresh(time: number): void;
  dispose(): void;
}

export interface OceanSurfaceOptions {
  scene: Scene;
  kind?: OceanKind;
  /** 海面在世界坐标中的宽度/高度 */
  worldWidth: number;
  worldHeight: number;
  /** 贴图分辨率（默认 512x288） */
  textureWidth?: number;
  textureHeight?: number;
  /** 渲染分组（决定层叠顺序） */
  renderingGroupId?: number;
}

/** 创建海面；海面以原点为中心 */
export function createOceanSurface(options: OceanSurfaceOptions): OceanSurface {
  const { scene, worldWidth, worldHeight } = options;
  const kind = options.kind ?? DEFAULT_OCEAN_KIND;
  const textureWidth = options.textureWidth ?? 512;
  const textureHeight = options.textureHeight ?? 288;

  const texture = createOceanTexture(scene, kind, textureWidth, textureHeight);
  const material = createOceanMaterial(scene, texture);
  const mesh = MeshBuilder.CreatePlane("ocean", { width: worldWidth, height: worldHeight }, scene);
  mesh.material = material;
  mesh.isPickable = false;
  if (typeof options.renderingGroupId === "number") mesh.renderingGroupId = options.renderingGroupId;

  const surface: OceanSurface = {
    mesh,
    material,
    texture,
    kind,
    textureWidth,
    textureHeight,
    setKind(next: OceanKind) {
      surface.kind = next;
    },
    refresh(time: number) {
      refreshOcean(texture, textureWidth, textureHeight, time, surface.kind);
    },
    dispose() {
      mesh.dispose();
      material.dispose();
      texture.dispose();
    },
  };
  return surface;
}
