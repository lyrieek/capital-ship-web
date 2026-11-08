import { Camera, FreeCamera, Vector3, type Scene } from "@babylonjs/core";

export interface OrthoCameraOptions {
  width: number;
  height: number;
  positionZ?: number;
  minZ?: number;
  maxZ?: number;
}

export function createOrthoCamera(scene: Scene, options: OrthoCameraOptions): FreeCamera {
  const camera = new FreeCamera("camera", new Vector3(0, 0, options.positionZ ?? -100), scene);
  camera.setTarget(Vector3.Zero());
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -options.width / 2;
  camera.orthoRight = options.width / 2;
  camera.orthoTop = options.height / 2;
  camera.orthoBottom = -options.height / 2;
  camera.minZ = options.minZ ?? 0.1;
  camera.maxZ = options.maxZ ?? 1000;
  scene.activeCamera = camera;
  return camera;
}
