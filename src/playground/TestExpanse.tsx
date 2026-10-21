import { useEffect, useRef, useState, type RefObject } from "react";
import { Camera, Color4, Engine, FreeCamera, Scene, Vector3 } from "@babylonjs/core";
import { useTranslation } from "react-i18next";
import { createOceanSurface, DEFAULT_LIGHT_AZIMUTH, DEFAULT_LIGHT_ELEVATION, OCEAN_PRESETS, type OceanKind, type OceanSurface } from "../expanse";
import "./playground.css";
import "./TestExpanse.css";

const SEGMENT_OPTIONS = [64, 128, 200, 256];

// 角度符号（避免源码里直接出现非 ASCII 字符）
const DEG = "\u00B0";

// 海面外观参数：海域、波高、高光、光照
interface OceanLook {
  kind: OceanKind;
  amplitude: number;
  specStrength: number;
  specPower: number;
  azimuth: number;
  elevation: number;
}

// 由海域预设生成外观参数，保证调试页与主场景表现一致
function lookFromPreset(kind: OceanKind, azimuth: number, elevation: number): OceanLook {
  const preset = OCEAN_PRESETS[kind];
  return {
    kind,
    amplitude: preset.amplitude,
    specStrength: preset.specStrength,
    specPower: preset.specPower,
    azimuth,
    elevation,
  };
}

// 支持用 ?kind=deep 直接打开某个海域
function initialKind(): OceanKind {
  return new URLSearchParams(globalThis.location.search).get("kind") === "deep" ? "deep" : "shallow";
}

const DEFAULT_LOOK = lookFromPreset(initialKind(), DEFAULT_LIGHT_AZIMUTH, DEFAULT_LIGHT_ELEVATION);

// 合并外观参数（逐字段取值，返回新对象）
function mergeLook(current: OceanLook, patch: Partial<OceanLook>): OceanLook {
  return {
    kind: patch.kind ?? current.kind,
    amplitude: patch.amplitude ?? current.amplitude,
    specStrength: patch.specStrength ?? current.specStrength,
    specPower: patch.specPower ?? current.specPower,
    azimuth: patch.azimuth ?? current.azimuth,
    elevation: patch.elevation ?? current.elevation,
  };
}

// 把外观参数写进海面材质
function applyLook(surface: OceanSurface | null, look: OceanLook): void {
  if (!surface) return;
  surface.setKind(look.kind);
  surface.material.setFloat("uAmplitude", look.amplitude);
  surface.material.setFloat("uSpecStrength", look.specStrength);
  surface.material.setFloat("uSpecPower", look.specPower);
  surface.setLight(look.azimuth, look.elevation);
}

interface OceanScene {
  engine: Engine;
  surface: OceanSurface;
  dispose(): void;
}

// 建场景、铺海面、跑渲染循环
function createOceanScene(
  canvas: HTMLCanvasElement,
  segments: number,
  look: OceanLook,
  pausedRef: RefObject<boolean>,
  scaleRef: RefObject<number>,
  timeRef: RefObject<number>,
  onFps: (fps: number) => void,
): OceanScene {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.02, 0.06, 0.1, 1);

  const camera = new FreeCamera("camera", new Vector3(0, 0, -100), scene);
  camera.setTarget(Vector3.Zero());
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -800;
  camera.orthoRight = 800;
  camera.orthoTop = 450;
  camera.orthoBottom = -450;
  scene.activeCamera = camera;

  const surface = createOceanSurface({
    scene,
    kind: look.kind,
    worldWidth: 1600,
    worldHeight: 900,
    segmentsX: segments,
    segmentsY: Math.round((segments * 900) / 1600),
  });
  applyLook(surface, look);

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
    scene.render();
    frames += 1;
    // 帧率统计限流，避免每帧触发 React 重渲染
    if (frames % 15 === 0) onFps(Math.round(engine.getFps()));
  });

  const observer = new ResizeObserver(() => engine.resize());
  observer.observe(canvas);

  return {
    engine,
    surface,
    dispose() {
      observer.disconnect();
      engine.stopRenderLoop();
      surface.dispose();
      engine.dispose();
    },
  };
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

// 统一的「标题 + 滑杆 + 数值」控件行
function SliderField({ label, value, min, max, step, format, onChange }: SliderFieldProps) {
  return (
    <label className="playground-field">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="playground-value">{format(value)}</span>
    </label>
  );
}

interface LookFieldProps {
  look: OceanLook;
  onChange: (patch: Partial<OceanLook>) => void;
}

// 波浪参数：波高与高光
function WaveField({ look, onChange }: LookFieldProps) {
  const { t } = useTranslation();
  return (
    <fieldset>
      <legend>{t("expanse.wave")}</legend>
      <SliderField
        label={t("expanse.waveHeight")}
        value={look.amplitude}
        min={0}
        max={2}
        step={0.05}
        format={(v) => v.toFixed(2)}
        onChange={(amplitude) => onChange({ amplitude })}
      />
      <SliderField
        label={t("expanse.specStrength")}
        value={look.specStrength}
        min={0}
        max={2}
        step={0.02}
        format={(v) => v.toFixed(2)}
        onChange={(specStrength) => onChange({ specStrength })}
      />
      <SliderField
        label={t("expanse.specPower")}
        value={look.specPower}
        min={8}
        max={160}
        step={1}
        format={(v) => v.toFixed(0)}
        onChange={(specPower) => onChange({ specPower })}
      />
    </fieldset>
  );
}

// 光照参数：方位角与高度角，决定高光落在哪一片浪上
function LightField({ look, onChange }: LookFieldProps) {
  const { t } = useTranslation();
  return (
    <fieldset>
      <legend>{t("expanse.light")}</legend>
      <SliderField
        label={t("expanse.lightAzimuth")}
        value={look.azimuth}
        min={0}
        max={360}
        step={1}
        format={(v) => `${v.toFixed(0)}${DEG}`}
        onChange={(azimuth) => onChange({ azimuth })}
      />
      <SliderField
        label={t("expanse.lightElevation")}
        value={look.elevation}
        min={10}
        max={85}
        step={1}
        format={(v) => `${v.toFixed(0)}${DEG}`}
        onChange={(elevation) => onChange({ elevation })}
      />
    </fieldset>
  );
}

interface ExpanseStatsProps {
  look: OceanLook;
  segments: number;
  fps: number;
}

// 当前参数读数
function ExpanseStats({ look, segments, fps }: ExpanseStatsProps) {
  const { t } = useTranslation();
  return (
    <dl className="expanse-stats">
      <dt>{t("expanse.fps")}</dt>
      <dd>{fps}</dd>
      <dt>{t("expanse.waveHeight")}</dt>
      <dd>{look.amplitude.toFixed(2)}</dd>
      <dt>{t("expanse.specStrength")}</dt>
      <dd>{look.specStrength.toFixed(2)}</dd>
      <dt>{t("expanse.specPower")}</dt>
      <dd>{look.specPower.toFixed(0)}</dd>
      <dt>{t("expanse.lightAzimuth")}</dt>
      <dd>
        {look.azimuth.toFixed(0)}
        {DEG}
      </dd>
      <dt>{t("expanse.lightElevation")}</dt>
      <dd>
        {look.elevation.toFixed(0)}
        {DEG}
      </dd>
      <dt>{t("expanse.meshSegments")}</dt>
      <dd>{segments}</dd>
    </dl>
  );
}

interface ExpanseState {
  look: OceanLook;
  paused: boolean;
  timeScale: number;
  segments: number;
  showStats: boolean;
  fps: number;
}

interface ExpanseActions {
  onKindChange: (kind: OceanKind) => void;
  onLookChange: (patch: Partial<OceanLook>) => void;
  onTogglePaused: () => void;
  onScaleChange: (value: number) => void;
  onSegmentsChange: (value: number) => void;
  onToggleStats: (value: boolean) => void;
  onReset: () => void;
}

// 左侧 HTML 控件面板：切换海域、调整波浪与光照参数、查看当前状态
function ExpanseControls({ state, actions }: { state: ExpanseState; actions: ExpanseActions }) {
  const { t } = useTranslation();
  const { look } = state;

  return (
    <section className="playground-controls">
      <h2>{t("expanse.controls")}</h2>
      <fieldset>
        <legend>{t("expanse.oceanKind")}</legend>
        <label>
          <input type="radio" name="oceanKind" checked={look.kind === "shallow"} onChange={() => actions.onKindChange("shallow")} />
          {t("expanse.shallow")}
        </label>
        <label>
          <input type="radio" name="oceanKind" checked={look.kind === "deep"} onChange={() => actions.onKindChange("deep")} />
          {t("expanse.deep")}
        </label>
      </fieldset>
      <fieldset>
        <legend>{t("expanse.animation")}</legend>
        <button type="button" onClick={actions.onTogglePaused}>
          {state.paused ? t("expanse.resume") : t("expanse.pause")}
        </button>
        <SliderField
          label={t("expanse.timeScale")}
          value={state.timeScale}
          min={0}
          max={3}
          step={0.1}
          format={(v) => `${v.toFixed(1)}x`}
          onChange={actions.onScaleChange}
        />
      </fieldset>
      <WaveField look={look} onChange={actions.onLookChange} />
      <LightField look={look} onChange={actions.onLookChange} />
      <fieldset>
        <legend>{t("expanse.mesh")}</legend>
        <label className="playground-field">
          <span>{t("expanse.meshSegments")}</span>
          <select value={state.segments} onChange={(e) => actions.onSegmentsChange(Number(e.target.value))}>
            {SEGMENT_OPTIONS.map((segments) => (
              <option key={segments} value={segments}>
                {segments}
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
      {state.showStats ? <ExpanseStats look={look} segments={state.segments} fps={state.fps} /> : null}
    </section>
  );
}

// 海洋调试页：只渲染海面着色器，配合 HTML 控件切换海域、调整波浪与光照参数，
// 便于在不启动游戏对战的情况下单独调试海浪表现。
export default function TestExpanse() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<OceanSurface | null>(null);
  // 渲染循环里的可变参数走 ref，避免每次改动都重建 Babylon 场景
  const lookRef = useRef<OceanLook>(mergeLook(DEFAULT_LOOK, {}));
  const pausedRef = useRef(false);
  const scaleRef = useRef(1);
  const timeRef = useRef(0);

  const [look, setLook] = useState<OceanLook>(mergeLook(DEFAULT_LOOK, {}));
  const [paused, setPaused] = useState(false);
  const [timeScale, setTimeScale] = useState(1);
  const [segments, setSegments] = useState(200);
  const [showStats, setShowStats] = useState(true);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ocean = createOceanScene(canvas, segments, lookRef.current, pausedRef, scaleRef, timeRef, setFps);
    surfaceRef.current = ocean.surface;

    return () => {
      ocean.dispose();
      surfaceRef.current = null;
    };
  }, [segments]);

  const replaceLook = (next: OceanLook) => {
    lookRef.current = next;
    setLook(next);
    applyLook(surfaceRef.current, next);
  };

  const changeLook = (patch: Partial<OceanLook>) => {
    replaceLook(mergeLook(lookRef.current, patch));
  };

  const changeKind = (kind: OceanKind) => {
    // 换海域时回到该海域的预设参数
    replaceLook(lookFromPreset(kind, lookRef.current.azimuth, lookRef.current.elevation));
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
    replaceLook(lookFromPreset("shallow", DEFAULT_LIGHT_AZIMUTH, DEFAULT_LIGHT_ELEVATION));
    pausedRef.current = false;
    setPaused(false);
    scaleRef.current = 1;
    setTimeScale(1);
    setSegments(200);
  };

  return (
    <div className="playground">
      <div className="playground-body">
        <ExpanseControls
          state={{ look, paused, timeScale, segments, showStats, fps }}
          actions={{
            onKindChange: changeKind,
            onLookChange: changeLook,
            onTogglePaused: togglePaused,
            onScaleChange: changeScale,
            onSegmentsChange: setSegments,
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
