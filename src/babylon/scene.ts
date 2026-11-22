import { Color3, Color4, Engine, HemisphericLight, Scene, Vector3 } from "@babylonjs/core";
import { createOrthoCamera } from "./camera";

export interface BabylonSceneOptions {
  canvas: HTMLCanvasElement;
  clearColor?: [number, number, number, number];
  width?: number;
  height?: number;
  positionZ?: number;
  /** 保留绘制缓冲：只有需要截图 / readPixels 时才开启，默认关闭以省一次缓冲拷贝 */
  preserveDrawingBuffer?: boolean;
}

export interface BabylonScene {
  engine: Engine;
  scene: Scene;
  dispose(): void;
}

export function createBabylonScene(options: BabylonSceneOptions): BabylonScene {
  const { canvas, clearColor = [0.04, 0.17, 0.27, 1], width = 1600, height = 900, positionZ = -100, preserveDrawingBuffer = false } = options;
  const engine = new Engine(canvas, true, { preserveDrawingBuffer, stencil: true }, true);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(...clearColor);
  // 场景级光照：岛屿 / 礁石 / 船厂这些受光材质共用。
  // HemisphericLight 的 direction 指向光源：网格法线朝 -Z（相机一侧），所以光源也放在 -Z 一侧。
  const light = new HemisphericLight("sceneLight", new Vector3(-0.35, 0.45, -1).normalize(), scene);
  light.intensity = 0.95;
  light.diffuse = Color3.White();
  light.groundColor = Color3.FromHexString("#24404f");
  light.specular = Color3.Black();
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
