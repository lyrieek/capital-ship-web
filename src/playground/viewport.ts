// 调试页共用视口：按预览容器的实际尺寸动态计算画布大小，窗口变化后自动跟进。
// 与主游戏的 fitViewport 不同，这里不做 16:9 约束和最小尺寸限制，直接铺满可用区域。
import { useEffect, useState, type RefObject } from "react";
import { Vector3, type Engine, type FreeCamera, type Scene } from "@babylonjs/core";
import { applyZoomToCamera, setCameraBaseSize } from "../babylon";

export interface PlaygroundViewport {
  /** 可用宽度（CSS 像素） */
  width: number;
  /** 可用高度（CSS 像素） */
  height: number;
}

/** 相机可见的世界范围。默认与画布 1:1；给定基准尺寸时会看到更大的区域。 */
export interface PlaygroundWorldView {
  /** 可见世界宽度（世界单位） */
  width: number;
  /** 可见世界高度（世界单位） */
  height: number;
}

/** 需要至少看到的世界范围（舰船测试页用来保证地图中心的内容不被裁掉） */
export interface PlaygroundMinWorld {
  width: number;
  height: number;
}

// 连续拖动窗口时等尺寸稳定再更新，避免每帧重建 Babylon 场景。
const RESIZE_DEBOUNCE_MS = 120;

/** 监听预览容器尺寸，返回当前可用的画布视口 */
export function usePlaygroundViewport(ref: RefObject<HTMLElement | null>): PlaygroundViewport | null {
  const [viewport, setViewport] = useState<PlaygroundViewport | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let timer = 0;
    const measure = () => {
      const width = Math.max(1, Math.floor(element.clientWidth));
      const height = Math.max(1, Math.floor(element.clientHeight));
      setViewport((prev) => (prev?.width === width && prev?.height === height ? prev : { width, height }));
    };

    // 首帧立即测量，后续窗口拖动做防抖
    measure();
    const observer = new ResizeObserver(() => {
      globalThis.clearTimeout(timer);
      timer = globalThis.setTimeout(measure, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      globalThis.clearTimeout(timer);
    };
  }, [ref]);

  return viewport;
}

/**
 * 把画布视口换算成相机可见世界范围。
 * 不传 minWorld 时世界单位与 CSS 像素 1:1（整个画布铺满，画面不缩放）；
 * 传入后按最小缩放保证至少看到 minWorld 这么大的世界区域，多出来的方向继续显示海面，
 * 因此画布依然铺满、不会出现黑边，也不会因窗口变小而裁掉核心内容。
 */
export function playgroundWorldView(viewport: PlaygroundViewport, minWorld?: PlaygroundMinWorld): PlaygroundWorldView {
  if (!minWorld || minWorld.width <= 0 || minWorld.height <= 0) {
    return { width: viewport.width, height: viewport.height };
  }
  const scale = Math.min(viewport.width / minWorld.width, viewport.height / minWorld.height);
  return { width: viewport.width / scale, height: viewport.height / scale };
}

/** 视口变化后同步正交相机的基准尺寸与 backbuffer */
export function resizePlaygroundScene(
  engine: Engine,
  scene: Scene,
  viewport: PlaygroundViewport,
  minWorld?: PlaygroundMinWorld,
): PlaygroundWorldView {
  const world = playgroundWorldView(viewport, minWorld);
  setCameraBaseSize(world.width, world.height);
  const camera = scene.activeCamera as FreeCamera | null;
  if (camera) applyZoomToCamera(camera);
  engine.resize();
  return world;
}

/** 调试页局部世界坐标（左上原点、Y 向下）→ 场景坐标（居中、Y 向上） */
export function playgroundToScene(x: number, y: number, viewport: PlaygroundViewport, z = 0): Vector3 {
  return new Vector3(x - viewport.width / 2, viewport.height / 2 - y, z);
}
