import { Camera, FreeCamera, Vector3, type Scene } from "@babylonjs/core";
import { MIN_VIEW_H, MIN_VIEW_W } from "../game/world";

export interface OrthoCameraOptions {
  width: number;
  height: number;
  positionZ?: number;
  minZ?: number;
  maxZ?: number;
}

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;

let zoom = 1;
let baseWidth = MIN_VIEW_W;
let baseHeight = MIN_VIEW_H;

export function getZoom(): number {
  return zoom;
}

/** 更新正交相机的基准视口（CSS 像素，未除 zoom）；窗口尺寸变化后调用。 */
export function setCameraBaseSize(width: number, height: number): void {
  if (width <= 0 || height <= 0) return;
  baseWidth = width;
  baseHeight = height;
}

export function getViewWidth(): number {
  return baseWidth / zoom;
}

export function getViewHeight(): number {
  return baseHeight / zoom;
}

export function setZoom(value: number): number {
  zoom = value < MIN_ZOOM ? MIN_ZOOM : value > MAX_ZOOM ? MAX_ZOOM : value;
  return zoom;
}

export function zoomBy(factor: number): number {
  return setZoom(zoom * factor);
}

export function applyZoomToCamera(camera: FreeCamera): void {
  const w = getViewWidth();
  const h = getViewHeight();
  camera.orthoLeft = -w / 2;
  camera.orthoRight = w / 2;
  camera.orthoTop = h / 2;
  camera.orthoBottom = -h / 2;
}

/** 相机轻微倾斜与摆动效果（可选项，默认关闭） */
export interface CameraEffect {
  /** 是否开启倾斜摆动 */
  enabled: boolean;
  /** 基础倾斜角度（度），绕 X 轴，使画面稍微俯仰 */
  tiltAngle: number;
  /** 摆动角度幅度（度） */
  swayAngle: number;
  /** 摆动速度（弧度/秒） */
  swaySpeed: number;
}

/** 默认：关闭，20° 倾斜，25° 上下摆动幅度，2.5 弧度/秒上下摆动速度；左右摆动更轻微、更缓慢 */
export const DEFAULT_CAMERA_EFFECT: CameraEffect = {
  enabled: false,
  tiltAngle: 20,
  swayAngle: 25,
  swaySpeed: 2.5,
};

// 全局相机效果状态（与 expanse/ocean-state 同风格：模块级单例，供任意页面读写）。
// 对象仅被替换，从不原地改写，故可安全持有 DEFAULT_CAMERA_EFFECT 的引用。
let cameraEffect: CameraEffect = DEFAULT_CAMERA_EFFECT;

export function getCameraEffect(): CameraEffect {
  return cameraEffect;
}

export function setCameraEffect(patch: Partial<CameraEffect>): void {
  cameraEffect = {
    enabled: patch.enabled ?? cameraEffect.enabled,
    tiltAngle: patch.tiltAngle ?? cameraEffect.tiltAngle,
    swayAngle: patch.swayAngle ?? cameraEffect.swayAngle,
    swaySpeed: patch.swaySpeed ?? cameraEffect.swaySpeed,
  };
}

export function resetCameraEffect(): void {
  cameraEffect = DEFAULT_CAMERA_EFFECT;
}

export function createOrthoCamera(scene: Scene, options: OrthoCameraOptions): FreeCamera {
  const camera = new FreeCamera("camera", new Vector3(0, 0, options.positionZ ?? -100), scene);
  camera.setTarget(Vector3.Zero());
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  baseWidth = options.width;
  baseHeight = options.height;
  applyZoomToCamera(camera);
  // 正交俯视只用到相机到场景的一小段深度：收紧 near/far 能显著提高深度精度。
  // 相机在 positionZ（默认 -100），场景对象大概在 z = [-34, 0]，所以 [1, 200] 足够。
  camera.minZ = options.minZ ?? 1;
  camera.maxZ = options.maxZ ?? 200;
  scene.activeCamera = camera;
  return camera;
}

/** 每帧调用：根据时间给相机施加轻微倾斜与摆动；enabled 为 false 时保持正交俯视。 */
export function updateCameraEffect(camera: FreeCamera | null, time: number): void {
  if (!camera) return;
  const eff = cameraEffect;
  if (!eff.enabled) {
    camera.rotation.x = 0;
    camera.rotation.z = 0;
    return;
  }
  const tilt = (eff.tiltAngle * Math.PI) / 180;
  // 上下（X 轴）：速度保持，幅度稍大
  const pitch = Math.sin(time * eff.swaySpeed) * ((eff.swayAngle * Math.PI) / 180);
  // 左右（Z 轴）：速度减半、幅度缩小，更轻微缓慢
  const yaw = Math.sin(time * eff.swaySpeed * 0.5) * ((eff.swayAngle * 0.35 * Math.PI) / 180);
  camera.rotation.x = tilt + pitch;
  camera.rotation.z = yaw;
}
