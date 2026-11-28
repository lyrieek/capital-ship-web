// 椰子树：只在面积较大的岛屿上生成，全部共享一份几何 + 一份 thin instance 缓冲，
// 一次绘制完成所有岛屿的椰子树（二次渲染）。
import { Color3, Mesh, MeshBuilder, Matrix, Quaternion, type Scene, StandardMaterial, Vector3, VertexBuffer } from "@babylonjs/core";
import type { TerrainItem } from "./types";

// 只有 scale >= 1 的岛屿才种椰子树（面积较大的岛屿）
const PALM_MIN_SCALE = 1;
// 单座岛屿棕榈数量上限，避免大岛刷太多影响性能
const MAX_PALMS_PER_ISLAND = 12;
// 每座岛的棕榈基数 + 随 scale 递增
const PALMS_PER_SCALE = 3;

// 椰子树尺寸（世界单位，场景坐标：-Z 向上，岛屿表面 z 为负）
const PALM_TRUNK_HEIGHT = 26;
const PALM_TRUNK_DIAMETER = 1.8;
const PALM_FROND_LENGTH = 12;
const PALM_FROND_WIDTH = 2;
const PALM_FROND_COUNT = 6;

// 椰子树在岛上的放置半径占岛半径的比例（留白边缘，避免长在海里）
const PALM_PLANT_RATIO = 0.72;

// 颜色（顶点色烘进几何，一份材质即可）
const TRUNK_COLOR = Color3.FromHexString("#8b6e4c");
const FROND_COLOR = Color3.FromHexString("#3a7d44");

/** 单棵椰子树的实例变换（场景坐标，z 为岛表面高度） */
export interface PalmInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  angle: number;
}

// 乘余随机数（MINSTD，不使用位运算），按 seed 决定，同一布局每次生成的棕榈位置完全一致
function mulberry32(seed: number): () => number {
  let s = seed === 0 ? 1 : seed;
  return () => {
    s *= 16_807;
    s %= 2_147_483_647;
    return s / 2_147_483_647;
  };
}

function paintVertices(mesh: Mesh, color: Color3): void {
  const count = mesh.getTotalVertices();
  const colors = Array.from({ length: count }, () => [color.r, color.g, color.b, 1]).flat();
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  mesh.useVertexColors = true;
}

/** 建一棵椰子树的原型网格（树干沿 -Z 竖直，叶片在水平面辐射），供 thin instance 复用 */
function createPalmPrototype(name: string, scene: Scene): Mesh {
  const parts: Mesh[] = [];
  const h = PALM_TRUNK_HEIGHT;

  // 树干：CreateCylinder 默认高度沿 Y，绕 X 轴 -PI/2 后高度沿 -Z（竖直向上）。
  // position.z = -h/2 让树干底部在局部 z=0，顶部在局部 z=-h，合并后烘进顶点。
  const trunk = MeshBuilder.CreateCylinder(
    `${name}_trunk`,
    {
      diameter: PALM_TRUNK_DIAMETER,
      height: h,
      tessellation: 8,
    },
    scene,
  );
  trunk.rotation.x = -Math.PI / 2;
  trunk.position.z = -h / 2;
  paintVertices(trunk, TRUNK_COLOR);
  parts.push(trunk);

  // 叶片：CreatePlane 默认在 XY 平面（法线 +Z，水平）。position.z = -h 放在树顶，
  // rotation.z 按角度辐射分布，避免叶片重叠。合并后烘进顶点。
  for (let i = 0; i < PALM_FROND_COUNT; i++) {
    const angle = (i / PALM_FROND_COUNT) * Math.PI * 2;
    const frond = MeshBuilder.CreatePlane(
      `${name}_frond${i}`,
      {
        width: PALM_FROND_WIDTH,
        height: PALM_FROND_LENGTH,
      },
      scene,
    );
    frond.position.z = -h;
    frond.rotation.z = angle;
    paintVertices(frond, FROND_COLOR);
    parts.push(frond);
  }

  const palm = Mesh.MergeMeshes(parts, true, true);
  if (!palm) throw new Error(`[terrain] 椰子树网格合并失败: ${name}`);
  palm.name = name;
  palm.useVertexColors = true;
  return palm;
}

/** 在岛上随机放置棕榈（岛屿局部坐标，世界单位；y 向下） */
export function placePalms(item: TerrainItem, islandRadius: number): PalmInstance[] {
  const scale = item.scale ?? 1;
  if (scale < PALM_MIN_SCALE) return [];

  const count = Math.min(MAX_PALMS_PER_ISLAND, Math.max(1, Math.floor(2 + scale * PALMS_PER_SCALE)));

  const seed = item.seed ?? 0;
  const random = mulberry32(seed);
  const plantRadius = islandRadius * scale * PALM_PLANT_RATIO;
  const minSpacing = plantRadius * 0.28;

  const instances: PalmInstance[] = [];
  const tries = count * 6;

  for (let attempt = 0; attempt < tries && instances.length < count; attempt++) {
    const r = Math.sqrt(random()) * plantRadius;
    const theta = random() * Math.PI * 2;
    const x = Math.cos(theta) * r;
    const y = Math.sin(theta) * r;

    let tooClose = false;
    for (const existing of instances) {
      const dx = x - existing.x;
      const dy = y - existing.y;
      if (dx * dx + dy * dy < minSpacing * minSpacing) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    instances.push({
      x,
      y,
      z: 0,
      scale: 0.85 + random() * 0.3,
      angle: random() * Math.PI * 2,
    });
  }

  return instances;
}

/** 建一棵棕榈林（所有岛屿的棕榈共享同一份 thin instance 网格，一次绘制） */
export function createPalmForest(name: string, scene: Scene, renderingGroupId: number, instances: readonly PalmInstance[]): Mesh | null {
  if (instances.length === 0) return null;

  const prototype = createPalmPrototype(`${name}_proto`, scene);
  // 注意：不能把原型设成 isVisible = false —— Babylon 在渲染前会直接跳过不可见网格，
  // thin instance 也会一起消失。原型本身不会额外画一次，开启 thin instance 后只渲染实例。
  prototype.renderingGroupId = renderingGroupId;
  prototype.isPickable = false;

  const material = new StandardMaterial(`${name}_mat`, scene);
  material.diffuseColor = Color3.White();
  material.specularColor = Color3.Black();
  material.emissiveColor = Color3.Black();
  material.backFaceCulling = false;
  material.freeze();
  prototype.material = material;

  const matrixBuffer = new Float32Array(instances.length * 16);
  const tmpPosition = new Vector3();
  const tmpScale = new Vector3();
  const tmpRotation = new Quaternion();
  const tmpMatrix = new Matrix();

  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    tmpPosition.set(inst.x, inst.y, inst.z);
    tmpScale.set(inst.scale, inst.scale, inst.scale);
    // 只绕 Z 轴旋转：prototype 中树干已沿 -Z 竖直，叶片已水平，此处只让整棵树在水平面内朝向
    Quaternion.RotationYawPitchRollToRef(0, 0, inst.angle, tmpRotation);
    Matrix.ComposeToRef(tmpScale, tmpRotation, tmpPosition, tmpMatrix);
    tmpMatrix.copyToArray(matrixBuffer, i * 16);
  }

  prototype.thinInstanceSetBuffer("matrix", matrixBuffer, 16, false);
  prototype.thinInstanceCount = instances.length;
  return prototype;
}
