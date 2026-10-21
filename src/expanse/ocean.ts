// 海洋（海浪）模块
// 全部由着色器程序化生成：主体涌浪 + 细浪法线 + 焦散 + 白沫 + 浮游闪烁 + 动态高光。
// 运行时只在 CPU 侧更新一个 uTime，Canvas 2D 那套每帧重绘贴图的开销被彻底去掉。
import { Color3, Mesh, type Scene, ShaderMaterial, Vector3, VertexData } from "@babylonjs/core";
import { OCEAN_FRAGMENT_SHADER, OCEAN_VERTEX_SHADER } from "./ocean-shader";

/** 海域种类：浅海 / 深海 */
export type OceanKind = "shallow" | "deep";

/** 游戏默认海域（浅海）。不做设置界面，改这一处即可切换。 */
export const DEFAULT_OCEAN_KIND: OceanKind = "shallow";

/** 单个海域的着色参数 */
export interface OceanPreset {
  kind: OceanKind;
  /** 画面上下边缘的底色 */
  colorEdge: Color3;
  /** 画面中部的底色 */
  colorCenter: Color3;
  /** 天空反射色（坡度大时混入） */
  skyColor: Color3;
  /** 白沫强度 */
  foam: number;
  /** 焦散强度 */
  caustic: number;
  /** 浮游闪烁强度 */
  sparkle: number;
  /** 高光锐度（指数越大越集中） */
  specPower: number;
  /** 高光强度 */
  specStrength: number;
  /** 波高倍率 */
  amplitude: number;
}

/** 海域参数表 */
export const OCEAN_PRESETS: Record<OceanKind, OceanPreset> = {
  shallow: {
    kind: "shallow",
    colorEdge: Color3.FromHexString("#0b4254"),
    colorCenter: Color3.FromHexString("#177d96"),
    skyColor: Color3.FromHexString("#cfeef8"),
    foam: 0.3,
    caustic: 0.45,
    sparkle: 0,
    specPower: 32,
    specStrength: 0.32,
    amplitude: 1,
  },
  deep: {
    kind: "deep",
    colorEdge: Color3.FromHexString("#0a2c44"),
    colorCenter: Color3.FromHexString("#0d3c5c"),
    skyColor: Color3.FromHexString("#7fb6d6"),
    foam: 0,
    caustic: 0,
    sparkle: 1,
    specPower: 64,
    specStrength: 0.5,
    amplitude: 1.15,
  },
};

/** 默认光照：方位角 135°、高度角 45°（0° = 正上方，指向相机的 -Z 侧） */
export const DEFAULT_LIGHT_AZIMUTH = 135;
export const DEFAULT_LIGHT_ELEVATION = 45;

/** 由方位角/高度角算出指向光源的方向 */
export function lightDirection(azimuthDeg: number, elevationDeg: number): Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const horizontal = Math.cos(el);
  return new Vector3(horizontal * Math.sin(az), horizontal * Math.cos(az), -Math.sin(el));
}

// 海面网格：XY 平面上的细分网格，顶点着色器再把它推成波浪
function createWaveMesh(scene: Scene, width: number, height: number, segmentsX: number, segmentsY: number): Mesh {
  const vertexCount = (segmentsX + 1) * (segmentsY + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(segmentsX * segmentsY * 6);

  let vertex = 0;
  for (let y = 0; y <= segmentsY; y++) {
    const v = y / segmentsY;
    const py = (v - 0.5) * height;
    for (let x = 0; x <= segmentsX; x++) {
      const u = x / segmentsX;
      positions[vertex * 3] = (u - 0.5) * width;
      positions[vertex * 3 + 1] = py;
      positions[vertex * 3 + 2] = 0;
      normals[vertex * 3] = 0;
      normals[vertex * 3 + 1] = 0;
      normals[vertex * 3 + 2] = -1;
      uvs[vertex * 2] = u;
      uvs[vertex * 2 + 1] = v;
      vertex++;
    }
  }

  let index = 0;
  for (let y = 0; y < segmentsY; y++) {
    for (let x = 0; x < segmentsX; x++) {
      const i = y * (segmentsX + 1) + x;
      indices[index] = i;
      indices[index + 1] = i + 1;
      indices[index + 2] = i + segmentsX + 1;
      indices[index + 3] = i + 1;
      indices[index + 4] = i + segmentsX + 2;
      indices[index + 5] = i + segmentsX + 1;
      index += 6;
    }
  }

  const mesh = new Mesh("ocean", scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh, false);
  return mesh;
}

// 把海域参数写进着色器 uniform
function applyPreset(surface: OceanSurface, kind: OceanKind): void {
  const preset = OCEAN_PRESETS[kind];
  const material = surface.material;
  material.setColor3("uColorEdge", preset.colorEdge);
  material.setColor3("uColorCenter", preset.colorCenter);
  material.setColor3("uSkyColor", preset.skyColor);
  material.setFloat("uSpecPower", preset.specPower);
  material.setFloat("uSpecStrength", preset.specStrength);
  material.setFloat("uFoamAmount", preset.foam);
  material.setFloat("uCausticAmount", preset.caustic);
  material.setFloat("uSparkleAmount", preset.sparkle);
  material.setFloat("uAmplitude", preset.amplitude);
}

/** 铺在场景里的海面（网格 + 着色器材质） */
export interface OceanSurface {
  mesh: Mesh;
  material: ShaderMaterial;
  kind: OceanKind;
  segmentsX: number;
  segmentsY: number;
  /** 切换海域种类，下一帧生效 */
  setKind(kind: OceanKind): void;
  /** 设置光照方向 */
  setLight(azimuthDeg: number, elevationDeg: number): void;
  /** 推进动画时间（秒） */
  refresh(time: number): void;
  dispose(): void;
}

export interface OceanSurfaceOptions {
  scene: Scene;
  kind?: OceanKind;
  /** 海面在世界坐标中的宽度/高度 */
  worldWidth: number;
  worldHeight: number;
  /** 网格细分数（默认 200 x 112） */
  segmentsX?: number;
  segmentsY?: number;
  /** 渲染分组（决定层叠顺序） */
  renderingGroupId?: number;
}

/** 创建海面；海面以原点为中心 */
export function createOceanSurface(options: OceanSurfaceOptions): OceanSurface {
  const { scene, worldWidth, worldHeight } = options;
  const kind = options.kind ?? DEFAULT_OCEAN_KIND;
  const segmentsX = options.segmentsX ?? 200;
  const segmentsY = options.segmentsY ?? 112;

  const mesh = createWaveMesh(scene, worldWidth, worldHeight, segmentsX, segmentsY);
  if (typeof options.renderingGroupId === "number") mesh.renderingGroupId = options.renderingGroupId;
  mesh.isPickable = false;

  const material = new ShaderMaterial(
    "oceanMaterial",
    scene,
    { vertexSource: OCEAN_VERTEX_SHADER, fragmentSource: OCEAN_FRAGMENT_SHADER },
    {
      attributes: ["position"],
      uniforms: [
        "worldViewProjection",
        "uTime",
        "uAmplitude",
        "uHalfHeight",
        "uColorEdge",
        "uColorCenter",
        "uSkyColor",
        "uLightDir",
        "uSpecPower",
        "uSpecStrength",
        "uFoamAmount",
        "uCausticAmount",
        "uSparkleAmount",
      ],
      needAlphaBlending: false,
    },
  );
  material.backFaceCulling = false;
  mesh.material = material;

  const surface: OceanSurface = {
    mesh,
    material,
    kind,
    segmentsX,
    segmentsY,
    setKind(next: OceanKind) {
      surface.kind = next;
      applyPreset(surface, next);
    },
    setLight(azimuthDeg: number, elevationDeg: number) {
      material.setVector3("uLightDir", lightDirection(azimuthDeg, elevationDeg));
    },
    refresh(time: number) {
      material.setFloat("uTime", time);
    },
    dispose() {
      mesh.dispose();
      material.dispose();
    },
  };

  applyPreset(surface, kind);
  surface.setLight(DEFAULT_LIGHT_AZIMUTH, DEFAULT_LIGHT_ELEVATION);
  material.setFloat("uHalfHeight", worldHeight / 2);
  material.setFloat("uTime", 0);
  return surface;
}
