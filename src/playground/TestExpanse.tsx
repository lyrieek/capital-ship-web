import { useEffect, useRef, useState } from "react";
import { Camera, Color4, Engine, FreeCamera, Scene, Vector3 } from "@babylonjs/core";
import { useTranslation } from "react-i18next";
import { createOceanSurface, OCEAN_PRESETS, type OceanKind, type OceanSurface } from "../expanse";

const TEXTURE_SIZES = [256, 512, 1024];

interface ExpanseState {
  kind: OceanKind;
  paused: boolean;
  timeScale: number;
  textureSize: number;
  showStats: boolean;
  fps: number;
}

interface ExpanseActions {
  onKindChange: (kind: OceanKind) => void;
  onTogglePaused: () => void;
  onScaleChange: (value: number) => void;
  onTextureSizeChange: (value: number) => void;
  onToggleStats: (value: boolean) => void;
  onReset: () => void;
}

// 左侧 HTML 控件面板：切换海域、调整动画参数、查看当前预设
function ExpanseControls({ state, actions }: { state: ExpanseState; actions: ExpanseActions }) {
  const { t } = useTranslation();
  const preset = OCEAN_PRESETS[state.kind];

  return (
    <section className="playground-controls">
      <h2>{t("expanse.controls")}</h2>
      <fieldset>
        <legend>{t("expanse.oceanKind")}</legend>
        <label>
          <input type="radio" name="oceanKind" checked={state.kind === "shallow"} onChange={() => actions.onKindChange("shallow")} />
          {t("expanse.shallow")}
        </label>
        <label>
          <input type="radio" name="oceanKind" checked={state.kind === "deep"} onChange={() => actions.onKindChange("deep")} />
          {t("expanse.deep")}
        </label>
      </fieldset>
      <fieldset>
        <legend>{t("expanse.animation")}</legend>
        <button type="button" onClick={actions.onTogglePaused}>
          {state.paused ? t("expanse.resume") : t("expanse.pause")}
        </button>
        <label className="playground-field">
          <span>{t("expanse.timeScale")}</span>
          <input type="range" min={0} max={3} step={0.1} value={state.timeScale} onChange={(e) => actions.onScaleChange(Number(e.target.value))} />
          <span className="playground-value">{state.timeScale.toFixed(1)}x</span>
        </label>
        <label className="playground-field">
          <span>{t("expanse.textureSize")}</span>
          <select value={state.textureSize} onChange={(e) => actions.onTextureSizeChange(Number(e.target.value))}>
            {TEXTURE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <label>
        <input type="checkbox" checked={state.showStats} onChange={(e) => actions.onToggleStats(e.target.checked)} />
        {t("expanse.showStats")}
      </label>
      <button type="button" onClick={actions.onReset}>
        {t("expanse.reset")}
      </button>
      {state.showStats ? (
        <dl className="expanse-stats">
          <dt>{t("expanse.fps")}</dt>
          <dd>{state.fps}</dd>
          <dt>{t("expanse.waveRows")}</dt>
          <dd>{preset.waveRows}</dd>
          <dt>{t("expanse.waveAmplitude")}</dt>
          <dd>{preset.waveAmplitude.toFixed(3)}</dd>
          <dt>{t("expanse.waveFrequency")}</dt>
          <dd>{preset.waveFrequency}</dd>
          <dt>{t("expanse.waveSpeed")}</dt>
          <dd>{preset.waveSpeed.toFixed(2)}</dd>
        </dl>
      ) : null}
    </section>
  );
}

// 海洋调试页：只渲染海浪贴图，配合 HTML 控件切换海域、调整动画参数，
// 便于在不启动游戏对战的情况下单独调试海浪表现。
export default function TestExpanse() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<OceanSurface | null>(null);
  // 渲染循环里的可变参数走 ref，避免每次改动都重建 Babylon 场景
  const kindRef = useRef<OceanKind>("shallow");
  const pausedRef = useRef(false);
  const scaleRef = useRef(1);
  const timeRef = useRef(0);

  const [kind, setKind] = useState<OceanKind>("shallow");
  const [paused, setPaused] = useState(false);
  const [timeScale, setTimeScale] = useState(1);
  const [textureSize, setTextureSize] = useState(512);
  const [showStats, setShowStats] = useState(true);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
    const thisScene = new Scene(engine);
    thisScene.clearColor = new Color4(0.02, 0.06, 0.1, 1);

    const camera = new FreeCamera("camera", new Vector3(0, 0, -100), thisScene);
    camera.setTarget(Vector3.Zero());
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoLeft = -800;
    camera.orthoRight = 800;
    camera.orthoTop = 450;
    camera.orthoBottom = -450;
    thisScene.activeCamera = camera;

    const surface = createOceanSurface({
      scene: thisScene,
      kind: kindRef.current,
      worldWidth: 1600,
      worldHeight: 900,
      textureWidth: textureSize,
      textureHeight: Math.round((textureSize * 900) / 1600),
    });
    surfaceRef.current = surface;

    // 等布局确定后再 resize，避免 canvas 尺寸为 0
    engine.resize();

    let last = performance.now();
    let frames = 0;
    engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!pausedRef.current) timeRef.current += dt * scaleRef.current;
      surface.refresh(timeRef.current);
      thisScene.render();
      frames += 1;
      // 帧率统计限流，避免每帧触发 React 重渲染
      if (frames % 15 === 0) setFps(Math.round(engine.getFps()));
    });

    const observer = new ResizeObserver(() => engine.resize());
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      engine.stopRenderLoop();
      surface.dispose();
      surfaceRef.current = null;
      engine.dispose();
    };
  }, [textureSize]);

  const changeKind = (next: OceanKind) => {
    kindRef.current = next;
    surfaceRef.current?.setKind(next);
    setKind(next);
  };

  const togglePaused = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };

  const changeScale = (value: number) => {
    scaleRef.current = value;
    setTimeScale(value);
  };

  const reset = () => {
    changeKind("shallow");
    pausedRef.current = false;
    setPaused(false);
    scaleRef.current = 1;
    setTimeScale(1);
    setTextureSize(512);
  };

  return (
    <div className="playground">
      <div className="playground-body">
        <ExpanseControls
          state={{ kind, paused, timeScale, textureSize, showStats, fps }}
          actions={{
            onKindChange: changeKind,
            onTogglePaused: togglePaused,
            onScaleChange: changeScale,
            onTextureSizeChange: setTextureSize,
            onToggleStats: setShowStats,
            onReset: reset,
          }}
        />
        <section className="playground-preview">
          <canvas ref={canvasRef} className="playground-canvas" width={1600} height={900} />
        </section>
      </div>
    </div>
  );
}
