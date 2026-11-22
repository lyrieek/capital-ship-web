// 粒子表现层：用一个 SolidParticleSystem 承载全部爆炸 / 烟雾 / 水花。
// 所有粒子共享一份材质和一个 Mesh，只更新顶点数据，不再给每个粒子建 Plane + Material。
import { Color4, DynamicTexture, MeshBuilder, ShaderMaterial, SolidParticleSystem, type Scene, type SolidParticle } from "@babylonjs/core";
import { toCanvas2D } from "../babylon";
import { paintParticle } from "./textures";
import { drainFxEvents, type FxEvent } from "./fx";
import { H, W } from "./utils";

// 粒子池容量：一局最多同时存在的粒子数，超出后新事件会被丢弃
const CAPACITY = 512;
const TEXTURE_SIZE = 32;
// 与旧版手写粒子一致的阻尼系数
const DRAG = 2.5;
const TAU = Math.PI * 2;

// 烟雾颜色表：与旧版 createSmoke 保持一致
const SMOKE_COLORS = ["#475569", "#64748b", "#94a3b8"];

// 逐粒子自定义状态：世界坐标、速度、生命。位置换算到场景坐标在 updateParticle 里做。
interface FxParticleProps {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

// 不受光照影响的自发光精灵：贴图负责形状，顶点色负责颜色和淡出。
// 用 ShaderMaterial 而不是 StandardMaterial，是因为 StandardMaterial 的 emissive 不乘顶点色，
// 逐粒子颜色会被吃掉；这里直接 tex.rgb * vColor.rgb。
const FX_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;
attribute vec4 color;

uniform mat4 worldViewProjection;

varying vec2 vUV;
varying vec4 vColor;

void main(void) {
  vUV = uv;
  vColor = color;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FX_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUV;
varying vec4 vColor;

uniform sampler2D particleTexture;

void main(void) {
  vec4 tex = texture2D(particleTexture, vUV);
  gl_FragColor = vec4(tex.rgb * vColor.rgb, tex.a * vColor.a);
}
`;

export interface ParticleFx {
  /** 推进一帧：先把本帧事件转成粒子，再让 SPS 更新几何 */
  sync(dt: number): void;
  /** 清空全部粒子（重开一局时用，行为对齐旧版 reset） */
  clear(): void;
  dispose(): void;
}

// SPS 的 particle.color 在初始化前为 null，这里统一兜底
function ensureColor(particle: SolidParticle): Color4 {
  if (!particle.color) particle.color = new Color4(1, 1, 1, 0);
  return particle.color;
}

// 激活一个池内粒子：写入世界坐标状态，并换算到场景坐标
function activate(particle: SolidParticle, x: number, y: number, vx: number, vy: number, life: number, size: number, tint: Color4): void {
  particle.props = { x, y, vx, vy, life, maxLife: life, size } satisfies FxParticleProps;
  const color = ensureColor(particle);
  color.r = tint.r;
  color.g = tint.g;
  color.b = tint.b;
  color.a = 1;
  particle.position.x = x - W / 2;
  particle.position.y = H / 2 - y;
  particle.position.z = 0;
  particle.scaling.setAll(size * 2);
  particle.isVisible = true;
}

function createFxMaterial(scene: Scene, texture: DynamicTexture): ShaderMaterial {
  const material = new ShaderMaterial(
    "particleFxMaterial",
    scene,
    { vertexSource: FX_VERTEX_SHADER, fragmentSource: FX_FRAGMENT_SHADER },
    {
      attributes: ["position", "uv", "color"],
      uniforms: ["worldViewProjection"],
      samplers: ["particleTexture"],
      needAlphaBlending: true,
    },
  );
  material.setTexture("particleTexture", texture);
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  return material;
}

/**
 * 创建粒子系统
 * @param scene Babylon 场景
 * @param renderingGroupId 渲染分组（与弹药同组，压在海面和舰船之上）
 */
export function createParticleFx(scene: Scene, renderingGroupId: number): ParticleFx {
  const texture = new DynamicTexture("particleTexture", { width: TEXTURE_SIZE, height: TEXTURE_SIZE }, scene, false);
  paintParticle(toCanvas2D(texture), TEXTURE_SIZE, TEXTURE_SIZE);
  texture.update();

  const material = createFxMaterial(scene, texture);

  const model = MeshBuilder.CreatePlane("particleModel", { size: 1 }, scene);
  model.material = material;
  model.isPickable = false;

  // updatable 必须为 true：setParticles() 每帧要直接更新顶点缓冲
  const sps = new SolidParticleSystem("particleFx", scene, { updatable: true });
  sps.addShape(model, CAPACITY);
  model.dispose();

  // updateParticle 只收 particle，dt 通过闭包由 sync() 写入（与 gameSpeed 同一份时间）
  let dt = 0;
  let cursor = 0;
  const colorCache = new Map<string, Color4>();

  const tintOf = (hex: string): Color4 => {
    const cached = colorCache.get(hex);
    if (cached) return cached;
    const tint = Color4.FromHexString(hex);
    colorCache.set(hex, tint);
    return tint;
  };

  const acquire = (): SolidParticle | null => {
    const particles = sps.particles;
    for (let i = 0; i < particles.length; i++) {
      const particle = particles[(cursor + i) % particles.length];
      if (!particle.isVisible) {
        cursor = (cursor + i + 1) % particles.length;
        return particle;
      }
    }
    return null;
  };

  const spawnBurst = (event: FxEvent): void => {
    const tint = tintOf(event.color);
    for (let i = 0; i < event.count; i++) {
      const particle = acquire();
      if (!particle) return;
      const angle = Math.random() * TAU;
      const speed = Math.random() * 190 + 30;
      const life = Math.random() * 0.55 + 0.25;
      activate(particle, event.x, event.y, Math.cos(angle) * speed, Math.sin(angle) * speed, life, Math.random() * 3 + 1.5, tint);
    }
  };

  const spawnSmoke = (event: FxEvent): void => {
    for (let i = 0; i < event.count; i++) {
      const particle = acquire();
      if (!particle) return;
      const life = Math.random() * 0.6 + 1;
      const color = SMOKE_COLORS[Math.floor(Math.random() * SMOKE_COLORS.length)];
      activate(
        particle,
        event.x + Math.random() * 18 - 9,
        event.y + Math.random() * 12 - 6,
        Math.random() * 20 - 10,
        -(Math.random() * 22 + 12),
        life,
        Math.random() * 5 + 7,
        tintOf(color),
      );
    }
  };

  sps.initParticles = () => {
    for (const particle of sps.particles) {
      particle.props = { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1 } satisfies FxParticleProps;
      particle.color = new Color4(0, 0, 0, 0);
      particle.scaling.setAll(0);
      particle.isVisible = false;
    }
  };

  sps.updateParticle = (particle) => {
    if (!particle.isVisible) return particle;

    const props = particle.props as FxParticleProps | null;
    if (!props) return particle;
    props.x += props.vx * dt;
    props.y += props.vy * dt;
    props.vx *= 1 - DRAG * dt;
    props.vy *= 1 - DRAG * dt;
    props.life -= dt;

    if (props.life <= 0) {
      particle.isVisible = false;
      ensureColor(particle).a = 0;
      particle.scaling.setAll(0);
      return particle;
    }

    const ratio = Math.max(0, props.life / props.maxLife);
    particle.position.x = props.x - W / 2;
    particle.position.y = H / 2 - props.y;
    particle.position.z = 0;
    particle.scaling.setAll(props.size * 2 * ratio);
    ensureColor(particle).a = ratio;
    return particle;
  };

  const mesh = sps.buildMesh();
  mesh.material = material;
  mesh.renderingGroupId = renderingGroupId;
  mesh.isPickable = false;
  // 同组内排在弹药下面（弹药 alphaIndex = 1）
  mesh.alphaIndex = 0;
  mesh.hasVertexAlpha = true;
  // 粒子位置每帧变化，关闭视锥裁剪，避免包围盒判断把整批粒子剔掉
  mesh.alwaysSelectAsActiveMesh = true;
  // 注意：SPS 的 buildMesh() 不会调用 initParticles()（只有 start() 会），这里必须手动调一次，
  // 否则 particle.props 还是 null，setParticles() 里的 updateParticle 会直接空指针。
  sps.initParticles();
  sps.setParticles();

  return {
    sync(frameDt: number) {
      dt = frameDt;
      for (const event of drainFxEvents()) {
        if (event.kind === "burst") spawnBurst(event);
        else spawnSmoke(event);
      }
      sps.setParticles();
    },
    clear() {
      drainFxEvents();
      for (const particle of sps.particles) {
        particle.isVisible = false;
        ensureColor(particle).a = 0;
        particle.scaling.setAll(0);
      }
      sps.setParticles();
    },
    dispose() {
      mesh.dispose();
      material.dispose();
      texture.dispose();
      colorCache.clear();
    },
  };
}
