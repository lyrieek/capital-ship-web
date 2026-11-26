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

// 水花颜色表：从白色到浅蓝，模拟浪花与飞沫
const SPLASH_COLORS = ["#ffffff", "#e6f8ff", "#bde9ff"];

// 逐粒子自定义状态：世界坐标、速度、生命。位置换算到场景坐标在 updateParticle 里做。
interface FxParticleProps {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  /** 重力加速度（世界像素/秒²，正值向下）；爆炸 / 烟雾为 0 */
  gravity: number;
  /** 阻尼系数（每秒）：水花用较小的阻尼，让飞沫能自然回落 */
  drag: number;
  /** 透明度倍率：水花外围的涟漪使用较低透明度 */
  alpha: number;
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

// 可选运动参数：爆炸 / 烟雾保持旧默认值，水花按需覆盖
interface ParticleMotion {
  gravity?: number;
  drag?: number;
  alpha?: number;
}

// 激活一个池内粒子：写入世界坐标状态，并换算到场景坐标
function activate(
  particle: SolidParticle,
  x: number,
  y: number,
  vx: number,
  vy: number,
  life: number,
  size: number,
  tint: Color4,
  motion: ParticleMotion = {},
): void {
  const { gravity = 0, drag = DRAG, alpha = 1 } = motion;
  particle.props = { x, y, vx, vy, life, maxLife: life, size, gravity, drag, alpha } satisfies FxParticleProps;
  const color = ensureColor(particle);
  color.r = tint.r;
  color.g = tint.g;
  color.b = tint.b;
  color.a = alpha;
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

// 落海水花：中间一束水柱 + 外围飞沫 + 贴水面的扩散涟漪，
// 与陆地爆炸的径向迸发区分开。
function createSplashSpawner(acquire: () => SolidParticle | null, tintOf: (hex: string) => Color4): (event: FxEvent) => void {
  return (event: FxEvent): void => {
    // 1) 中央水柱：少量较大的水团垂直向上喷起，再由重力拉回
    for (let i = 0; i < 4; i++) {
      const particle = acquire();
      if (!particle) return;
      activate(
        particle,
        event.x + Math.random() * 6 - 3,
        event.y + Math.random() * 3 - 1.5,
        Math.random() * 24 - 12,
        -(240 + Math.random() * 160),
        Math.random() * 0.35 + 0.55,
        Math.random() * 2.2 + 3.2,
        tintOf(event.color),
        { gravity: 520, drag: 0.6 },
      );
    }

    // 2) 外围飞沫：向斜上方散开，颜色在白色和浅蓝之间随机
    for (let i = 0; i < event.count; i++) {
      const particle = acquire();
      if (!particle) return;
      const angle = Math.random() * TAU;
      const outward = 35 + Math.random() * 95;
      const color = SPLASH_COLORS[Math.floor(Math.random() * SPLASH_COLORS.length)];
      activate(
        particle,
        event.x + Math.cos(angle) * 3,
        event.y + Math.sin(angle) * 2,
        Math.cos(angle) * outward,
        -(60 + Math.random() * 140),
        Math.random() * 0.45 + 0.4,
        Math.random() * 1.8 + 1.2,
        tintOf(color),
        { gravity: 480, drag: 0.9 },
      );
    }

    // 3) 水面涟漪：沿水面快速向外扩散、低透明度淡出
    const ripples = 10;
    for (let i = 0; i < ripples; i++) {
      const particle = acquire();
      if (!particle) return;
      const angle = (i / ripples) * TAU + Math.random() * 0.2;
      const speed = 55 + Math.random() * 35;
      activate(
        particle,
        event.x + Math.cos(angle) * 6,
        event.y + Math.sin(angle) * 4,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed * 0.55,
        Math.random() * 0.2 + 0.45,
        2.4,
        tintOf("#9fdcff"),
        { drag: 3.2, alpha: 0.45 },
      );
    }
  };
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

  const spawnSplash = createSplashSpawner(acquire, tintOf);

  sps.initParticles = () => {
    for (const particle of sps.particles) {
      particle.props = { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1, gravity: 0, drag: DRAG, alpha: 1 } satisfies FxParticleProps;
      particle.color = new Color4(0, 0, 0, 0);
      particle.scaling.setAll(0);
      particle.isVisible = false;
    }
  };

  sps.updateParticle = (particle) => {
    if (!particle.isVisible) return particle;

    const props = particle.props as FxParticleProps | null;
    if (!props) return particle;
    // 先施加重力，再按各自阻尼衰减；爆炸 / 烟雾的 gravity 为 0，行为与旧版一致
    props.vy += props.gravity * dt;
    props.x += props.vx * dt;
    props.y += props.vy * dt;
    const damping = Math.max(0, 1 - props.drag * dt);
    props.vx *= damping;
    props.vy *= damping;
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
    ensureColor(particle).a = props.alpha * ratio;
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
        else if (event.kind === "splash") spawnSplash(event);
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
