// 相机视口控制：大地图只显示一块 1600 x 900 的窗口，相机焦点跟随战场，
// 也支持从 minimap / 调试页直接跳转到世界坐标。
import { Matrix, Plane, Vector3, type FreeCamera, type Scene } from "@babylonjs/core";
import type { Ship } from "../ship/ship";
import { clamp } from "./utils";
import { VIEW_H, VIEW_W, WORLD_H, WORLD_W } from "./world";

export interface CameraFocus {
  x: number;
  y: number;
}

// 当前焦点（世界坐标）。手动跳转后保持一段时间，避免立刻被跟随逻辑拉走。
let focus: CameraFocus = { x: WORLD_W / 2, y: WORLD_H / 2 };
let manualHold = 0;

// 手动跳转 / 视口平移后，自动跟随暂停的时长（秒）
const MANUAL_HOLD = 6;

export function getCameraFocus(): CameraFocus {
  return focus;
}

function clampFocusAxis(value: number, viewSize: number, worldSize: number): number {
  if (worldSize <= viewSize) return worldSize / 2;
  return clamp(value, viewSize / 2, worldSize - viewSize / 2);
}

// 把焦点限制在视口完全位于地图内的范围；地图小于视口时固定居中。
function clampFocus(x: number, y: number): CameraFocus {
  return {
    x: clampFocusAxis(x, VIEW_W, WORLD_W),
    y: clampFocusAxis(y, VIEW_H, WORLD_H),
  };
}

// 立即设置相机焦点（下一帧渲染生效），hold 秒内不被自动跟随覆盖。
export function setCameraFocus(x: number, y: number, hold = 0): void {
  focus = clampFocus(x, y);
  if (hold > 0) manualHold = Math.max(manualHold, hold);
}

// 从 minimap 等 UI 跳转相机：默认保持 6 秒手动视角。
export function focusCameraAt(x: number, y: number, hold = MANUAL_HOLD): void {
  setCameraFocus(x, y, hold);
}

// 按世界坐标增量平移视口（键盘 WASD / 方向键），始终限制在地图范围内。
export function panCameraBy(dx: number, dy: number, hold = MANUAL_HOLD): void {
  const next = clampFocus(focus.x + dx, focus.y + dy);
  focus = next;
  manualHold = Math.max(manualHold, hold);
}

export function resetCameraFocus(): void {
  focus = { x: WORLD_W / 2, y: WORLD_H / 2 };
  manualHold = 0;
}

// 海平面：世界单位里 z = 0 的平面。所有玩法坐标都落在这里。
const SEA_PLANE = new Plane(0, 0, 1, 0);

/**
 * 画布坐标（相对 canvas 左上、CSS 像素）→ 世界坐标。
 * 用射线与海平面求交，而不是按相机焦点手算投影：相机倾斜/摆动时也准确。
 * 返回 null 表示射线与海平面平行（正常俯视/斜视不会发生）。
 */
export function scenePointToWorld(scene: Scene, x: number, y: number): CameraFocus | null {
  const camera = scene.activeCamera;
  if (!camera) return null;

  const ray = scene.createPickingRay(x, y, Matrix.Identity(), camera);
  const distance = ray.intersectsPlane(SEA_PLANE);
  if (distance === null) return null;

  const point = ray.direction.scaleToRef(distance, new Vector3()).addInPlace(ray.origin);
  return {
    x: clamp(point.x + WORLD_W / 2, 0, WORLD_W),
    y: clamp(WORLD_H / 2 - point.y, 0, WORLD_H),
  };
}

/**
 * 屏幕（client）坐标 → 世界坐标。
 * 这是 UI 事件的首选入口；只有场景/相机还没就绪时才回退到焦点换算。
 */
export function screenToWorld(scene: Scene, clientX: number, clientY: number, rect: DOMRect): CameraFocus {
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const point = scenePointToWorld(scene, localX, localY);
  if (point) return point;

  const u = rect.width > 0 ? localX / rect.width : 0.5;
  const v = rect.height > 0 ? localY / rect.height : 0.5;
  return {
    x: clamp(focus.x + (u - 0.5) * VIEW_W, 0, WORLD_W),
    y: clamp(focus.y + (v - 0.5) * VIEW_H, 0, WORLD_H),
  };
}

function centroid(ships: readonly Ship[]): CameraFocus | null {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const ship of ships) {
    if (!ship.alive) continue;
    x += ship.x;
    y += ship.y;
    count += 1;
  }
  return count > 0 ? { x: x / count, y: y / count } : null;
}

// 跟随目标：优先选中舰船；否则取红蓝双方质心的中点，让交战双方尽量同屏。
function followTarget(ships: readonly Ship[], selected: readonly Ship[]): CameraFocus {
  const selectedCenter = centroid(selected);
  if (selectedCenter) return selectedCenter;

  const redShips: Ship[] = [];
  const blueShips: Ship[] = [];
  for (const ship of ships) {
    if (!ship.alive) continue;
    (ship.team === "red" ? redShips : blueShips).push(ship);
  }
  const red = centroid(redShips);
  const blue = centroid(blueShips);
  if (red && blue) return { x: (red.x + blue.x) / 2, y: (red.y + blue.y) / 2 };

  return centroid(ships) ?? { x: WORLD_W / 2, y: WORLD_H / 2 };
}

function applyCamera(scene: Scene): void {
  const camera = scene.activeCamera as FreeCamera | null;
  if (!camera) return;
  const sceneX = focus.x - WORLD_W / 2;
  const sceneY = WORLD_H / 2 - focus.y;
  camera.position.x = sceneX;
  camera.position.y = sceneY;
  camera.setTarget(new Vector3(sceneX, sceneY, 0));
}

// 每帧调用：手动保持期结束后平滑跟随战场，然后把焦点写入相机。
export function updateCameraFocus(scene: Scene, ships: readonly Ship[], selected: readonly Ship[], dt: number): void {
  // 手动操作（minimap 拖动 / 键盘平移）期间暂停自动跟随
  if (manualHold > 0) {
    manualHold = Math.max(0, manualHold - dt);
  } else {
    const next = followTarget(ships, selected);
    const target = clampFocus(next.x, next.y);
    // 指数平滑，帧率无关
    const k = 1 - Math.exp(-3 * Math.max(0, dt));
    focus = {
      x: focus.x + (target.x - focus.x) * k,
      y: focus.y + (target.y - focus.y) * k,
    };
  }
  applyCamera(scene);
}
