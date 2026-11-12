// 舰船选择、选中圈与手动攻击：主游戏和 playground 共用
import { ActionManager, Color3, ExecuteCodeAction, KeyboardEventTypes, MeshBuilder, StandardMaterial, type Mesh, type Scene } from "@babylonjs/core";
import type { Ship } from "../ship/ship";
import { H, W } from "./utils";

export interface AttackOrder {
  ship: Ship;
  target: Ship;
}

export interface ShipInteractionOptions {
  // 右键落点（世界像素坐标）；不传则不启用右键指令
  onMove?: (x: number, y: number) => void;
}

export interface SelectionRing {
  mesh: Mesh;
  dispose(): void;
}

// 选中状态：只维护舰船列表，通过 onChange 同步外部 UI
export class ShipSelection {
  private ships: Ship[] = [];
  private readonly onChange?: (ships: readonly Ship[]) => void;

  constructor(onChange?: (ships: readonly Ship[]) => void) {
    this.onChange = onChange;
  }

  get list(): readonly Ship[] {
    return this.ships;
  }

  get count(): number {
    return this.ships.length;
  }

  has(ship: Ship): boolean {
    return this.ships.includes(ship);
  }

  select(ship: Ship, additive = false): void {
    if (!ship.alive) return;
    if (!additive) {
      this.set([ship]);
      return;
    }
    this.set(this.has(ship) ? this.ships.filter((item) => item !== ship) : [...this.ships, ship]);
  }

  clear(): void {
    this.set([]);
  }

  // 清理已死亡或已不在战场上的舰船（重开一局后旧对象会全部失效）
  retain(ships: readonly Ship[]): void {
    const next = this.ships.filter((ship) => ship.alive && ships.includes(ship));
    if (next.length !== this.ships.length) this.set(next);
  }

  private set(ships: Ship[]): void {
    this.ships = ships;
    this.onChange?.(ships);
  }
}

// 每艘选中舰船各自寻找最近的存活敌舰
export function nearestEnemyOrders(ships: readonly Ship[], selected: readonly Ship[]): AttackOrder[] {
  const orders: AttackOrder[] = [];
  for (const ship of selected) {
    if (!ship.alive) continue;

    let target: Ship | null = null;
    let nearest = Number.POSITIVE_INFINITY;
    for (const candidate of ships) {
      if (!candidate.alive || candidate.team === ship.team) continue;
      const distance = (candidate.x - ship.x) ** 2 + (candidate.y - ship.y) ** 2;
      if (distance < nearest) {
        nearest = distance;
        target = candidate;
      }
    }

    if (target) orders.push({ ship, target });
  }
  return orders;
}

// 创建贴在海面、舰船下方的选中圈：使用 Babylon 原生 Torus 网格，作为舰船下方的绿色椭圆环
// 默认 Torus 立于 XZ 平面，rotation.x = PI/2 将其躺平到 XY 平面面对正交相机；
// X 轴保持完整直径（宽，对应舰船长度方向），Y 轴按舰船宽度缩放（窄），形成“宽长高窄”的椭圆；
// 单面朝相机 + 轻微透明，保持完整不闪烁，不做任何动画。
export function createSelectionRing(scene: Scene, ship: Ship, renderingGroupId: number): SelectionRing {
  const diameter = ship.len * 1.3;
  const mesh = MeshBuilder.CreateTorus(
    `shipRing_${ship.name}`,
    {
      diameter,
      thickness: 4,
      tessellation: 64,
    },
    scene,
  );
  // 躺平到 XY 平面面对相机；X 轴完整，Y 轴按宽度压扁
  mesh.rotation.x = Math.PI / 2;
  mesh.scaling.set(1, (ship.wid * 2) / diameter, 1);
  mesh.renderingGroupId = renderingGroupId;
  mesh.isPickable = false;

  const material = new StandardMaterial(`shipRingMaterial_${ship.name}`, scene);
  material.diffuseColor = Color3.FromHexString("#4ade80");
  material.emissiveColor = Color3.FromHexString("#4ade80");
  material.alpha = 0.6;
  // 单面朝相机，避免正反面透明叠加在薄环上产生深度闪烁
  // separateCullingPass：先渲染背面再渲染正面，修复单网格内自透明导致的三角形排序瑕疵
  // disableDepthWrite：选中圈不写入深度缓冲，不遮挡其上的舰船与血条
  material.separateCullingPass = true;
  material.disableDepthWrite = true;
  mesh.material = material;
  mesh.setEnabled(false);

  return {
    mesh,
    dispose: () => {
      mesh.dispose();
      material.dispose();
    },
  };
}

function pickWorldPoint(scene: Scene, pointerX: number, pointerY: number): { x: number; y: number } | null {
  const picked = scene.pick(pointerX, pointerY)?.pickedPoint;
  if (!picked) return null;
  return { x: picked.x + W / 2, y: H / 2 - picked.y };
}

// 舰船点击：左键选择（Shift 多选）、可选右键移动、悬停光标
export function bindShipSelection(scene: Scene, mesh: Mesh, ship: Ship, selection: ShipSelection, options: ShipInteractionOptions = {}): void {
  const manager = new ActionManager(scene);
  mesh.actionManager = manager;

  manager.registerAction(
    new ExecuteCodeAction(ActionManager.OnPickTrigger, (event) => {
      const source = event.sourceEvent as PointerEvent | undefined;
      if (source && source.button !== 0) return;
      selection.select(ship, source?.shiftKey ?? false);
    }),
  );

  // 两次点击间隔很短时 Babylon 会判为双击、不再触发 OnPickTrigger；
  // 这里补一个双击触发，避免快速 Shift 多选时第二次点击被吞掉。
  manager.registerAction(
    new ExecuteCodeAction(ActionManager.OnDoublePickTrigger, (event) => {
      const source = event.sourceEvent as PointerEvent | undefined;
      if (source && source.button !== 0) return;
      selection.select(ship, source?.shiftKey ?? false);
    }),
  );

  if (options.onMove) {
    manager.registerAction(
      new ExecuteCodeAction(ActionManager.OnRightPickTrigger, (event) => {
        const point = pickWorldPoint(scene, event.pointerX, event.pointerY);
        if (point) options.onMove?.(point.x, point.y);
      }),
    );
  }

  manager.registerAction(
    new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
      scene.hoverCursor = "pointer";
    }),
  );

  manager.registerAction(
    new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
      scene.hoverCursor = "default";
    }),
  );
}

// 海面点击：左键清除选择，可选右键下达移动指令
export function bindOceanSelection(scene: Scene, mesh: Mesh, selection: ShipSelection, options: ShipInteractionOptions = {}): void {
  // 海面本身默认不参与拾取，这里需要它来接住空白处的点击
  mesh.isPickable = true;

  const manager = new ActionManager(scene);
  mesh.actionManager = manager;

  manager.registerAction(new ExecuteCodeAction(ActionManager.OnLeftPickTrigger, () => selection.clear()));

  if (options.onMove) {
    manager.registerAction(
      new ExecuteCodeAction(ActionManager.OnRightPickTrigger, (event) => {
        const point = pickWorldPoint(scene, event.pointerX, event.pointerY);
        if (point) options.onMove?.(point.x, point.y);
      }),
    );
  }
}

// F 键：对当前选择执行一次攻击指令
export function bindAttackKey(scene: Scene, attack: () => void): void {
  scene.onKeyboardObservable.add((info) => {
    if (info.type !== KeyboardEventTypes.KEYDOWN) return;
    if (info.event.repeat || info.event.key.toLowerCase() !== "f") return;

    info.event.preventDefault();
    attack();
  });
}
