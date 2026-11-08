import { Engine, Scene, Color4 } from "@babylonjs/core";
import { createOrthoCamera } from "./camera";

export interface BabylonSceneOptions {
  canvas: HTMLCanvasElement;
  clearColor?: [number, number, number, number];
  width?: number;
  height?: number;
  positionZ?: number;
}

export interface BabylonScene {
  engine: Engine;
  scene: Scene;
  dispose(): void;
}

export function createBabylonScene(options: BabylonSceneOptions): BabylonScene {
  const { canvas, clearColor = [0.04, 0.17, 0.27, 1], width = 1600, height = 900, positionZ = -100 } = options;
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(...clearColor);
  createOrthoCamera(scene, { width, height, positionZ });
  engine.resize();

  const observer = new ResizeObserver(() => engine.resize());
  observer.observe(canvas);

  return {
    engine,
    scene,
    dispose() {
      observer.disconnect();
      engine.stopRenderLoop();
      engine.dispose();
    },
  };
}
