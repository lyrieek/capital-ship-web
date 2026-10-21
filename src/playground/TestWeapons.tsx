import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Camera, Color3, Color4, DynamicTexture, Engine, FreeCamera, MeshBuilder, Scene, Vector3, type StandardMaterial } from "@babylonjs/core";
import { useTranslation } from "react-i18next";
import {
  clampToBounds,
  createSpriteMaterial,
  createWeaponRender,
  fireWeapon,
  getWeaponSpec,
  toCanvas2D,
  updateProjectiles,
  WEAPON_IDS,
  type Projectile,
  type WeaponId,
  type WeaponRender,
} from "../weapons";
import "./playground.css";
import "./TestWeapons.css";

const TAU = Math.PI * 2;

// 调试场景的世界尺寸（与主场景一致）
const WORLD_W = 1600;
const WORLD_H = 900;
// 发射平台位置
const LAUNCHER = { x: 220, y: 450 };
// 发射平台（假的发射者，满足 ProjectileOwner）
const OWNER = { x: LAUNCHER.x, y: LAUNCHER.y, vx: 0, vy: 0 };
// 落点标记数量与存活时间
const MARKER_COUNT = 16;
const MARKER_LIFE = 1.6;
// 齐射数量输入范围
const SALVO_MIN = 1;
const SALVO_MAX = 50;
// 落点允许的范围：随机目标与散布都不会跑出画面
const BOUNDS = { width: WORLD_W, height: WORLD_H, margin: 40 };

type PlaneMesh = ReturnType<typeof MeshBuilder.CreatePlane>;

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
function paintLauncher(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  // 船体
  ctx.fillStyle = "#3d5a73";
  ctx.beginPath();
  ctx.moveTo(12, height * 0.35);
  ctx.lineTo(width * 0.62, height * 0.22);
  ctx.lineTo(width * 0.78, height * 0.5);
  ctx.lineTo(width * 0.62, height * 0.78);
  ctx.lineTo(12, height * 0.65);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.45)";
  ctx.lineWidth = 3;
  ctx.stroke();
  // 炮塔与炮管
  ctx.fillStyle = "#9fb6c9";
  ctx.fillRect(width * 0.48, height * 0.4, width * 0.44, height * 0.2);
  // 舱室
  ctx.fillStyle = "rgba(255,255,255,.18)";
  ctx.fillRect(width * 0.12, height * 0.42, width * 0.26, height * 0.16);
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

// 正交俯视相机
function createDebugCamera(scene: Scene): FreeCamera {
  const camera = new FreeCamera("camera", new Vector3(0, 0, -100), scene);
  camera.setTarget(Vector3.Zero());
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -WORLD_W / 2;
  camera.orthoRight = WORLD_W / 2;
  camera.orthoTop = WORLD_H / 2;
  camera.orthoBottom = -WORLD_H / 2;
  camera.minZ = 0.1;
  camera.maxZ = 1000;
  return camera;
}

// 发射平台
function createLauncherMesh(scene: Scene): PlaneMesh {
  const texture = new DynamicTexture("launcherTexture", { width: 200, height: 100 }, scene, true);
  paintLauncher(toCanvas2D(texture), 200, 100);
  texture.update();
  const mesh = MeshBuilder.CreatePlane("launcher", { width: 100, height: 50 }, scene);
  mesh.material = createSpriteMaterial("launcherMaterial", texture, scene);
  mesh.position.set(LAUNCHER.x - WORLD_W / 2, WORLD_H / 2 - LAUNCHER.y, 0);
  mesh.isPickable = false;
  return mesh;
}

// 落点标记池
function createMarkerPool(scene: Scene): PlaneMesh[] {
  const texture = new DynamicTexture("markerTexture", { width: 48, height: 48 }, scene, true);
  paintMarker(toCanvas2D(texture), 48, 48);
  texture.update();
  const pool: PlaneMesh[] = [];
  for (let i = 0; i < MARKER_COUNT; i++) {
    const mesh = MeshBuilder.CreatePlane(`marker_${i}`, { width: 26, height: 26 }, scene);
    mesh.material = createSpriteMaterial(`markerMaterial_${i}`, texture, scene);
    mesh.isPickable = false;
    mesh.setEnabled(false);
    pool.push(mesh);
  }
  return pool;
}

// 鼠标瞄准标记
function createAimMesh(scene: Scene): PlaneMesh {
  const texture = new DynamicTexture("aimTexture", { width: 48, height: 48 }, scene, true);
  paintAim(toCanvas2D(texture), 48, 48);
  texture.update();
  const mesh = MeshBuilder.CreatePlane("aim", { width: 30, height: 30 }, scene);
  mesh.material = createSpriteMaterial("aimMaterial", texture, scene);
  mesh.isPickable = false;
  mesh.setEnabled(false);
  return mesh;
}

// 更新落点标记的显示与淡出
function updateMarkers(pool: PlaneMesh[], markers: ShotMarker[], now: number): void {
  for (let i = 0; i < pool.length; i++) {
    const mesh = pool[i];
    const marker = markers[i];
    if (!marker) {
      mesh.setEnabled(false);
      continue;
    }
    const age = now - marker.born;
    if (age > MARKER_LIFE) {
      mesh.setEnabled(false);
      continue;
    }
    mesh.setEnabled(true);
    mesh.position.set(marker.x - WORLD_W / 2, WORLD_H / 2 - marker.y, 0);
    const material = mesh.material as StandardMaterial;
    material.emissiveColor = Color3.FromHexString(marker.kind === "splash" ? MARKER_SPLASH_COLOR : MARKER_SHOT_COLOR);
    // 落海水花会扩散变大，普通落点标记保持原样
    const scale = marker.kind === "splash" ? 0.6 + (age / MARKER_LIFE) * 1.6 : 1;
    mesh.scaling.setAll(scale);
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

function useWeaponsDebug(): WeaponsDebug {
  const renderRef = useRef<WeaponRender | null>(null);
  const projectilesRef = useRef<Projectile[]>([]);
  const markersRef = useRef<ShotMarker[]>([]);
  const timeRef = useRef(0);
  // 渲染循环里的可变参数走 ref，避免每次改动都重建 Babylon 场景
  const weaponRef = useRef<WeaponId>("shell");
  const salvoRef = useRef(3);
  const bendRef = useRef(0.12);

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
    const from = { x: LAUNCHER.x, y: LAUNCHER.y };
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const scale = 1 + (Math.random() * 2 - 1) * distanceJitter;
    // 抖动后可能超出画面，目标点限制在边界内
    const aim = clampToBounds({ x: from.x + dx * scale, y: from.y + dy * scale }, BOUNDS);
    const id = weaponRef.current;
    const projectiles = fireWeapon(id, OWNER, from, aim, {
      salvo: salvoRef.current,
      bend: id === "shell" ? bendRef.current : 0,
      bounds: BOUNDS,
    });
    for (const projectile of projectiles) projectilesRef.current.push(projectile);
    markersRef.current.unshift({ x: aim.x, y: aim.y, born: timeRef.current, kind: "shot" });
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
    const angle = (Math.random() * 2 - 1) * (Math.PI / 3);
    const distance = 220 + Math.random() * 1100;
    fireAt({ x: LAUNCHER.x + Math.cos(angle) * distance, y: LAUNCHER.y + Math.sin(angle) * distance }, 0.25);
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

  const state: WeaponsState = { weapon, salvo, bend, showPath, showTrail, fps, live, fired };
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

  return { state, actions, onStats, renderRef, projectilesRef, markersRef, timeRef, fireAt };
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
  const { state, actions, onStats, renderRef, projectilesRef, markersRef, timeRef, fireAt } = useWeaponsDebug();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
    const thisScene = new Scene(engine);
    thisScene.clearColor = new Color4(0.03, 0.09, 0.14, 1);
    thisScene.activeCamera = createDebugCamera(thisScene);

    createLauncherMesh(thisScene);
    const markerPool = createMarkerPool(thisScene);
    const aimMesh = createAimMesh(thisScene);

    const weaponRender = createWeaponRender({
      scene: thisScene,
      worldWidth: WORLD_W,
      worldHeight: WORLD_H,
      renderingGroupId: 1,
      showPaths: true,
      showTrails: true,
    });
    renderRef.current = weaponRender;

    // 等布局确定后再 resize，避免 canvas 尺寸为 0
    engine.resize();

    let last = performance.now();
    let frames = 0;
    engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      timeRef.current += dt;

      updateProjectiles(dt, {
        projectiles: projectilesRef.current,
        targets: [],
        worldWidth: WORLD_W,
        worldHeight: WORLD_H,
        onLanded: (_projectile, x, y) => {
          // 落海：记录水花位置（收进画面内）
          const splash = clampToBounds({ x, y }, BOUNDS);
          markersRef.current.unshift({ x: splash.x, y: splash.y, born: timeRef.current, kind: "splash" });
          if (markersRef.current.length > MARKER_COUNT) markersRef.current.length = MARKER_COUNT;
        },
      });
      weaponRender.sync(projectilesRef.current);
      updateMarkers(markerPool, markersRef.current, timeRef.current);
      thisScene.render();

      frames += 1;
      // 帧率统计限流，避免每帧触发 React 重渲染
      if (frames % 15 === 0) {
        onStats(Math.round(engine.getFps()), projectilesRef.current.length);
      }
    });

    const toWorld = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        x: ((event.clientX - rect.left) / rect.width) * WORLD_W,
        y: ((event.clientY - rect.top) / rect.height) * WORLD_H,
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
      aimMesh.position.set(point.x - WORLD_W / 2, WORLD_H / 2 - point.y, 0);
    };

    const handleLeave = () => aimMesh.setEnabled(false);

    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("mousemove", handleMove);
    canvas.addEventListener("mouseleave", handleLeave);

    const observer = new ResizeObserver(() => engine.resize());
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("mousemove", handleMove);
      canvas.removeEventListener("mouseleave", handleLeave);
      engine.stopRenderLoop();
      weaponRender.dispose();
      renderRef.current = null;
      engine.dispose();
    };
  }, [fireAt, onStats, projectilesRef, markersRef, timeRef, renderRef]);

  return (
    <div className="playground">
      <div className="playground-body">
        <WeaponsControls state={state} actions={actions} />
        <section className="playground-preview">
          <canvas ref={canvasRef} className="playground-canvas" width={WORLD_W} height={WORLD_H} />
        </section>
      </div>
    </div>
  );
}
