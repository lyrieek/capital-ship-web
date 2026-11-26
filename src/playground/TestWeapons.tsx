import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Color3, DynamicTexture, type Scene, type Mesh, type StandardMaterial } from "@babylonjs/core";
import { useTranslation } from "react-i18next";
import {
  clampToBounds,
  createWeaponRender,
  fireWeapon,
  getWeaponKindSpec,
  getWeaponSpec,
  isWeaponKindImplemented,
  paintLauncherPlatform,
  updateProjectiles,
  WEAPON_IDS,
  WEAPON_KIND_IDS,
  type Projectile,
  type WeaponId,
  type WeaponRender,
} from "../weapons";
import { createBabylonScene, createPlane, createSpriteMaterial, toCanvas2D } from "../babylon";
import { playgroundToScene, usePlaygroundViewport, type PlaygroundViewport } from "./viewport";
import "./playground.css";
import "./TestWeapons.css";

const TAU = Math.PI * 2;

// 发射平台位置：相对画布左侧 / 垂直居中，随视口大小缩放
const LAUNCHER_X_RATIO = 0.14;
const LAUNCHER_Y_RATIO = 0.5;
// 落点标记数量与存活时间
const MARKER_COUNT = 16;
const MARKER_LIFE = 1.6;
// 齐射数量输入范围
const SALVO_MIN = 1;
const SALVO_MAX = 50;
// 只占位、尚未实现的武器大类：在调试页里以禁用项展示，方便后续补齐
const PLANNED_WEAPON_KINDS = WEAPON_KIND_IDS.filter((kind) => !isWeaponKindImplemented(kind));

function launcherPoint(viewport: PlaygroundViewport): { x: number; y: number } {
  return { x: viewport.width * LAUNCHER_X_RATIO, y: viewport.height * LAUNCHER_Y_RATIO };
}

// 落点允许的范围：随机目标与散布都不会跑出画面
function worldBounds(viewport: PlaygroundViewport) {
  return { width: viewport.width, height: viewport.height, margin: 40 };
}

type PlaneMesh = Mesh;

/** 一次射击的落点标记 */
interface ShotMarker {
  x: number;
  y: number;
  born: number;
  /** shot-射击落点，splash-落海水花 */
  kind: "shot" | "splash";
}

/** 调试页的控件状态：直接对应左侧 HTML 面板的显示内容 */
interface WeaponsState {
  /** 当前选择的武器 */
  weapon: WeaponId;
  /** 单次齐射的弹药数量 */
  salvo: number;
  /** 曲射弯曲度（相对弦长） */
  bend: number;
  /** 是否显示弹道预览线 */
  showPath: boolean;
  /** 是否显示尾迹线 */
  showTrail: boolean;
  /** 当前帧率 */
  fps: number;
  /** 场上在飞的弹药数量 */
  live: number;
  /** 累计发射的弹药数量 */
  fired: number;
}

/** 调试页的控件操作：由左侧 HTML 面板的交互触发 */
interface WeaponsActions {
  /** 切换武器 */
  onWeaponChange: (weapon: WeaponId) => void;
  /** 修改齐射数量 */
  onSalvoChange: (salvo: number) => void;
  /** 修改曲射弯曲度 */
  onBendChange: (bend: number) => void;
  /** 开关弹道预览 */
  onPathToggle: (value: boolean) => void;
  /** 开关尾迹 */
  onTrailToggle: (value: boolean) => void;
  /** 向随机位置开火 */
  onFireRandom: () => void;
  /** 清空场上弹药与落点标记 */
  onClear: () => void;
  /** 恢复默认设置并清场 */
  onReset: () => void;
}
// 绘制调试用的发射平台
function paintLauncher(ctx: CanvasRenderingContext2D, width: number, height: number, weapon: WeaponId): void {
  paintLauncherPlatform(ctx, width, height, weapon);
}

// 落点标记颜色（贴图本身画成白色，用材质自发光染色）
const MARKER_SHOT_COLOR = "#ffd166";
const MARKER_SPLASH_COLOR = "#7cc4ff";

// 绘制落点标记
function paintMarker(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, width * 0.3, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(width * 0.12, height / 2);
  ctx.lineTo(width * 0.88, height / 2);
  ctx.moveTo(width / 2, height * 0.12);
  ctx.lineTo(width / 2, height * 0.88);
  ctx.stroke();
}

// 绘制落海水花：由内向外扩散的同心涟漪，不再使用陆地上的准星图案
function paintRipple(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  for (const [radius, alpha, lineWidth] of [
    [0.16, 0.95, 3],
    [0.3, 0.6, 2],
    [0.42, 0.3, 1.4],
  ] as const) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.ellipse(cx, cy, width * radius, height * radius * 0.62, 0, 0, TAU);
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// 绘制鼠标瞄准标记
function paintAim(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#7cc4ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, width * 0.36, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, width * 0.08, 0, TAU);
  ctx.stroke();
}

// 发射平台
function createLauncherMesh(scene: Scene, weapon: WeaponId, viewport: PlaygroundViewport): ReturnType<typeof createPlane> {
  const texture = new DynamicTexture("launcherTexture", { width: 200, height: 100 }, scene, true);
  paintLauncher(toCanvas2D(texture), 200, 100, weapon);
  texture.update();
  const mesh = createPlane("launcher", 100, 50, scene);
  mesh.material = createSpriteMaterial("launcherMaterial", texture, scene);
  const point = launcherPoint(viewport);
  mesh.position.copyFrom(playgroundToScene(point.x, point.y, viewport));
  mesh.isPickable = false;
  return mesh;
}

// 单个落点位置的两种标记：普通落点（准星）与落海水花（涟漪）
interface MarkerMesh {
  shot: PlaneMesh;
  splash: PlaneMesh;
}

// 落点标记池
function createMarkerPool(scene: Scene): MarkerMesh[] {
  const markerTexture = new DynamicTexture("markerTexture", { width: 48, height: 48 }, scene, true);
  paintMarker(toCanvas2D(markerTexture), 48, 48);
  markerTexture.update();
  const rippleTexture = new DynamicTexture("rippleTexture", { width: 48, height: 48 }, scene, true);
  paintRipple(toCanvas2D(rippleTexture), 48, 48);
  rippleTexture.update();

  const pool: MarkerMesh[] = [];
  for (let i = 0; i < MARKER_COUNT; i++) {
    const shot = createPlane(`marker_${i}`, 26, 26, scene);
    shot.material = createSpriteMaterial(`markerMaterial_${i}`, markerTexture, scene);
    shot.isPickable = false;
    shot.setEnabled(false);

    const splash = createPlane(`ripple_${i}`, 26, 26, scene);
    splash.material = createSpriteMaterial(`rippleMaterial_${i}`, rippleTexture, scene);
    splash.isPickable = false;
    splash.setEnabled(false);

    pool.push({ shot, splash });
  }
  return pool;
}

// 鼠标瞄准标记
function createAimMesh(scene: Scene): ReturnType<typeof createPlane> {
  const texture = new DynamicTexture("aimTexture", { width: 48, height: 48 }, scene, true);
  paintAim(toCanvas2D(texture), 48, 48);
  texture.update();
  const mesh = createPlane("aim", 30, 30, scene);
  mesh.material = createSpriteMaterial("aimMaterial", texture, scene);
  mesh.isPickable = false;
  mesh.setEnabled(false);
  return mesh;
}

// 更新落点标记的显示与淡出
function updateMarkers(pool: MarkerMesh[], markers: ShotMarker[], now: number, viewport: PlaygroundViewport): void {
  for (let i = 0; i < pool.length; i++) {
    const entry = pool[i];
    entry.shot.setEnabled(false);
    entry.splash.setEnabled(false);

    const marker = markers[i];
    if (!marker) continue;
    const age = now - marker.born;
    if (age > MARKER_LIFE) continue;

    const isSplash = marker.kind === "splash";
    const mesh = isSplash ? entry.splash : entry.shot;
    mesh.setEnabled(true);
    mesh.position.copyFrom(playgroundToScene(marker.x, marker.y, viewport));
    const material = mesh.material as StandardMaterial;
    material.emissiveColor = Color3.FromHexString(isSplash ? MARKER_SPLASH_COLOR : MARKER_SHOT_COLOR);
    // 落海水花会扩散变大，普通落点标记保持原样
    mesh.scaling.setAll(isSplash ? 0.6 + (age / MARKER_LIFE) * 1.6 : 1);
    material.alpha = Math.max(0, 1 - age / MARKER_LIFE);
  }
}

// 齐射数量输入：限制在 1~50
function clampSalvo(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return SALVO_MIN;
  return Math.max(SALVO_MIN, Math.min(SALVO_MAX, Math.round(parsed)));
}

/** 调试页的控件状态与操作 */
interface WeaponsDebug {
  /** 控件状态（供面板渲染） */
  state: WeaponsState;
  /** 控件操作（供面板触发） */
  actions: WeaponsActions;
  /** 帧率与在场弹药统计回调（渲染循环里限流调用） */
  onStats: (fps: number, live: number) => void;
  /** 武器渲染器 */
  renderRef: RefObject<WeaponRender | null>;
  /** 场上在飞的弹药 */
  projectilesRef: RefObject<Projectile[]>;
  /** 最近若干次射击的落点标记 */
  markersRef: RefObject<ShotMarker[]>;
  /** 调试场景的累计时间（秒） */
  timeRef: RefObject<number>;
  /** 向指定目标点开火（距离随机抖动） */
  fireAt: (target: { x: number; y: number }, distanceJitter?: number) => void;
}

function useWeaponsDebug(viewport: PlaygroundViewport | null): WeaponsDebug {
  const renderRef = useRef<WeaponRender | null>(null);
  const projectilesRef = useRef<Projectile[]>([]);
  const markersRef = useRef<ShotMarker[]>([]);
  const timeRef = useRef(0);
  // 渲染循环里的可变参数走 ref，避免每次改动都重建 Babylon 场景
  const weaponRef = useRef<WeaponId>("shell");
  const salvoRef = useRef(3);
  const bendRef = useRef(0.12);
  const viewportRef = useRef<PlaygroundViewport | null>(viewport);
  viewportRef.current = viewport;

  const [weapon, setWeapon] = useState<WeaponId>("shell");
  const [salvo, setSalvo] = useState(3);
  const [bend, setBend] = useState(0.12);
  const [showPath, setShowPath] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [fps, setFps] = useState(0);
  const [live, setLive] = useState(0);
  const [fired, setFired] = useState(0);

  // 向目标点开火：距离随机抖动，每发弹药的落点再各自随机散布
  const fireAt = useCallback((target: { x: number; y: number }, distanceJitter = 0.18) => {
    const world = viewportRef.current;
    if (!world) return;
    const from = launcherPoint(world);
    const bounds = worldBounds(world);
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const scale = 1 + (Math.random() * 2 - 1) * distanceJitter;
    // 抖动后可能超出画面，目标点限制在边界内
    const aim = clampToBounds({ x: from.x + dx * scale, y: from.y + dy * scale }, bounds);
    const id = weaponRef.current;
    const projectiles = fireWeapon(id, { ...from, vx: 0, vy: 0 }, from, aim, {
      salvo: salvoRef.current,
      bend: getWeaponSpec(id).kind === "cannon" ? bendRef.current : 0,
      bounds,
    });
    for (const projectile of projectiles) projectilesRef.current.push(projectile);
    markersRef.current.unshift({
      x: aim.x,
      y: aim.y,
      born: timeRef.current,
      kind: "shot",
    });
    if (markersRef.current.length > MARKER_COUNT) markersRef.current.length = MARKER_COUNT;
    setFired((count) => count + projectiles.length);
  }, []);

  const changeWeapon = (next: WeaponId) => {
    weaponRef.current = next;
    setWeapon(next);
  };

  const changeSalvo = (value: number) => {
    salvoRef.current = value;
    setSalvo(value);
  };

  const changeBend = (value: number) => {
    bendRef.current = value;
    setBend(value);
  };

  const togglePath = (value: boolean) => {
    renderRef.current?.setShowPaths(value);
    setShowPath(value);
  };

  const toggleTrail = (value: boolean) => {
    renderRef.current?.setShowTrails(value);
    setShowTrail(value);
  };

  // 随机角度 + 随机距离开火（目标点会被限制在画面内）
  const fireRandom = useCallback(() => {
    const world = viewportRef.current;
    if (!world) return;
    const from = launcherPoint(world);
    const base = Math.min(world.width, world.height);
    const angle = (Math.random() * 2 - 1) * (Math.PI / 3);
    const distance = base * (0.24 + Math.random() * 1.2);
    fireAt(
      {
        x: from.x + Math.cos(angle) * distance,
        y: from.y + Math.sin(angle) * distance,
      },
      0.25,
    );
  }, [fireAt]);

  const clear = useCallback(() => {
    projectilesRef.current.length = 0;
    markersRef.current.length = 0;
    setLive(0);
  }, []);

  const reset = useCallback(() => {
    changeWeapon("shell");
    changeSalvo(3);
    changeBend(0.12);
    togglePath(true);
    toggleTrail(true);
    clear();
    setFired(0);
  }, [clear]);

  // 帧率与在场弹药统计（限流调用，避免每帧触发 React 重渲染）
  const onStats = useCallback((currentFps: number, currentLive: number) => {
    setFps(currentFps);
    setLive(currentLive);
  }, []);

  const state: WeaponsState = {
    weapon,
    salvo,
    bend,
    showPath,
    showTrail,
    fps,
    live,
    fired,
  };
  const actions: WeaponsActions = {
    onWeaponChange: changeWeapon,
    onSalvoChange: changeSalvo,
    onBendChange: changeBend,
    onPathToggle: togglePath,
    onTrailToggle: toggleTrail,
    onFireRandom: fireRandom,
    onClear: clear,
    onReset: reset,
  };

  return {
    state,
    actions,
    onStats,
    renderRef,
    projectilesRef,
    markersRef,
    timeRef,
    fireAt,
  };
}

// 左侧 HTML 控件面板：选武器、设定齐射数量与弯曲度、开关弹道/尾迹
function WeaponsControls({ state, actions }: { state: WeaponsState; actions: WeaponsActions }) {
  const { t } = useTranslation();
  const spec = getWeaponSpec(state.weapon);

  return (
    <section className="playground-controls">
      <h2>{t("weapons.controls")}</h2>
      <fieldset>
        <legend>{t("weapons.weapon")}</legend>
        {WEAPON_IDS.map((id) => {
          const label = t(`weapons.${id}`);
          return (
            <label key={id}>
              <input type="radio" name="weapon" checked={state.weapon === id} onChange={() => actions.onWeaponChange(id)} />
              {label}
            </label>
          );
        })}
      </fieldset>
      <fieldset>
        <legend>{t("weapons.planned")}</legend>
        {PLANNED_WEAPON_KINDS.map((kind) => (
          <label key={kind} className="weapons-planned">
            <input type="checkbox" disabled />
            {t(getWeaponKindSpec(kind).nameKey)}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t("weapons.fire")}</legend>
        <label className="playground-field">
          <span>{t("weapons.salvo")}</span>
          <input
            type="number"
            min={SALVO_MIN}
            max={SALVO_MAX}
            value={state.salvo}
            onChange={(e) => actions.onSalvoChange(clampSalvo(e.target.value))}
          />
        </label>
        <label className="playground-field">
          <span>{t("weapons.bend")}</span>
          <input type="range" min={0} max={0.3} step={0.01} value={state.bend} onChange={(e) => actions.onBendChange(Number(e.target.value))} />
          <span className="playground-value">{state.bend.toFixed(2)}</span>
        </label>
        <label>
          <input type="checkbox" checked={state.showPath} onChange={(e) => actions.onPathToggle(e.target.checked)} />
          {t("weapons.showPath")}
        </label>
        <label>
          <input type="checkbox" checked={state.showTrail} onChange={(e) => actions.onTrailToggle(e.target.checked)} />
          {t("weapons.showTrail")}
        </label>
        <button type="button" onClick={actions.onFireRandom}>
          {t("weapons.fireRandom")}
        </button>
        <button type="button" onClick={actions.onClear}>
          {t("weapons.clear")}
        </button>
        <button type="button" onClick={actions.onReset}>
          {t("weapons.reset")}
        </button>
      </fieldset>
      <p className="weapons-hint">{t("weapons.hint")}</p>
      <dl className="weapons-stats">
        <dt>{t("weapons.fps")}</dt>
        <dd>{state.fps}</dd>
        <dt>{t("weapons.live")}</dt>
        <dd>{state.live}</dd>
        <dt>{t("weapons.fired")}</dt>
        <dd>{state.fired}</dd>
        <dt>{t("weapons.defaultSalvo")}</dt>
        <dd>
          {spec.salvoMin}~{spec.salvoMax}
        </dd>
        <dt>{t("weapons.speed")}</dt>
        <dd>{spec.speed}</dd>
        <dt>{t("weapons.range")}</dt>
        <dd>{spec.range}</dd>
        <dt>{t("weapons.damage")}</dt>
        <dd>{spec.damage}</dd>
        <dt>{t("weapons.cooldown")}</dt>
        <dd>
          {spec.cooldownMin}~{spec.cooldownMax}
        </dd>
      </dl>
    </section>
  );
}

// 武器调试页：单独渲染武器的发射与弹道，
// 便于不启动整局对战就单独调试炮弹曲射、鱼雷齐射等表现。
export default function TestWeapons() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const viewport = usePlaygroundViewport(previewRef);
  const viewportRef = useRef<PlaygroundViewport | null>(viewport);
  viewportRef.current = viewport;
  const { state, actions, onStats, renderRef, projectilesRef, markersRef, timeRef, fireAt } = useWeaponsDebug(viewport);
  const launcherRef = useRef<PlaneMesh | null>(null);
  const sceneRef = useRef<Scene | null>(null);

  useEffect(() => {
    if (!viewport) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const babylon = createBabylonScene({
      canvas,
      clearColor: [0.03, 0.09, 0.14, 1],
      width: viewport.width,
      height: viewport.height,
    });
    const thisScene = babylon.scene;
    sceneRef.current = thisScene;

    launcherRef.current = createLauncherMesh(thisScene, state.weapon, viewport);
    const markerPool = createMarkerPool(thisScene);
    const aimMesh = createAimMesh(thisScene);

    const weaponRender = createWeaponRender({
      scene: thisScene,
      worldWidth: viewport.width,
      worldHeight: viewport.height,
      renderingGroupId: 1,
      showPaths: true,
      showTrails: true,
    });
    renderRef.current = weaponRender;

    let last = performance.now();
    let frames = 0;
    babylon.engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      timeRef.current += dt;

      updateProjectiles(dt, {
        projectiles: projectilesRef.current,
        targets: [],
        worldWidth: viewport.width,
        worldHeight: viewport.height,
        onLanded: (_projectile, x, y) => {
          // 落海：记录水花位置（收进画面内）
          const splash = clampToBounds({ x, y }, worldBounds(viewport));
          markersRef.current.unshift({
            x: splash.x,
            y: splash.y,
            born: timeRef.current,
            kind: "splash",
          });
          if (markersRef.current.length > MARKER_COUNT) markersRef.current.length = MARKER_COUNT;
        },
      });
      weaponRender.sync(projectilesRef.current);
      updateMarkers(markerPool, markersRef.current, timeRef.current, viewport);
      thisScene.render();

      frames += 1;
      // 帧率统计限流，避免每帧触发 React 重渲染
      if (frames % 15 === 0) {
        onStats(Math.round(babylon.engine.getFps()), projectilesRef.current.length);
      }
    });

    const toWorld = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        x: ((event.clientX - rect.left) / rect.width) * viewport.width,
        y: ((event.clientY - rect.top) / rect.height) * viewport.height,
      };
    };

    const handleClick = (event: MouseEvent) => {
      const point = toWorld(event);
      if (point) fireAt(point);
    };

    const handleMove = (event: MouseEvent) => {
      const point = toWorld(event);
      if (!point) return;
      aimMesh.setEnabled(true);
      aimMesh.position.set(point.x - viewport.width / 2, viewport.height / 2 - point.y, 0);
    };

    const handleLeave = () => aimMesh.setEnabled(false);

    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("mousemove", handleMove);
    canvas.addEventListener("mouseleave", handleLeave);

    return () => {
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("mousemove", handleMove);
      canvas.removeEventListener("mouseleave", handleLeave);
      babylon.dispose();
      weaponRender.dispose();
      launcherRef.current?.dispose();
      launcherRef.current = null;
      sceneRef.current = null;
      renderRef.current = null;
    };
  }, [fireAt, onStats, projectilesRef, markersRef, timeRef, renderRef, viewport]);

  useEffect(() => {
    const scene = sceneRef.current;
    const currentViewport = viewportRef.current;
    if (!scene || !currentViewport) return;
    launcherRef.current?.dispose();
    launcherRef.current = createLauncherMesh(scene, state.weapon, currentViewport);
  }, [state.weapon]);

  return (
    <div className="playground">
      <div className="playground-body">
        <WeaponsControls state={state} actions={actions} />
        <section className="playground-preview" ref={previewRef}>
          <canvas ref={canvasRef} className="playground-canvas" />
        </section>
      </div>
    </div>
  );
}
