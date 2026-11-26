import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Scene, FreeCamera } from "@babylonjs/core";
import { useTranslation } from "react-i18next";
import { getGameInstance, initializeGame, getRestrictAreas, getGameSpeedMultiplier, clearGameInstance } from "../game/Game";
import { disposeRender, getShipSelection, initRender, resizeRender, renderGame, getRestrictError } from "../game/render";
import { panCameraBy, screenToWorld, getCameraFocus, setCameraFocus } from "../game/camera-focus";
import { setTerrainField } from "../terrain";
import { getZoom, zoomBy, applyZoomToCamera } from "../babylon";
import { bindAttackKey } from "../game/selection";
import { W, H } from "../game/utils";
import { MIN_VIEW_H, MIN_VIEW_W } from "../game/world";
import { fitViewport, type ViewportSize } from "../game/viewport";
import { usePreventContextMenu } from "../hooks/use-prevent-context-menu";
import { getMaps, type GameMap } from "../map";
import { createInitialFleetSelection, FLEET_SIZE, type FleetSelection, type FleetShips, type FleetTeam } from "../game/fleet";
import { shipManager } from "../ship/ship-manager";
import Hud from "./Hud";
import MapSelect from "./MapSelect";
import BattleResult from "./BattleResult";
import Minimap from "./Minimap";
import Model from "./Model";

// Keyboard viewport panning: WASD and arrow keys, in world units per second.
const PAN_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
const PAN_SPEED = 760;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

interface BattleStageProps {
  map: GameMap;
  fleets: FleetShips;
  onChangeMap: () => void;
}

// 一场战斗：创建 Babylon 场景、驱动主循环，并在结束时提供返回选图的入口。
// oxlint-disable-next-line max-lines-per-function
function BattleStage({ map, fleets, onChangeMap }: BattleStageProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [winnerTeam, setWinnerTeam] = useState<"red" | "blue" | null>(null);
  const [restrictError, setRestrictError] = useState<string | null>(null);
  const [showRestrictError, setShowRestrictError] = useState(false);
  // Refs keep the render loop's closure from going stale.
  const gameOverRef = useRef(false);
  const winnerTeamRef = useRef<"red" | "blue" | null>(null);
  // Last mouse position in world coordinates, used for F-key aiming.
  const mouseRef = useRef<{ x: number; y: number }>({ x: W / 2, y: H / 2 });
  // Last mouse screen position: the camera moves, so F recomputes the world point.
  const pointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  // Held WASD / arrow keys, applied every frame by the render loop.
  const panKeysRef = useRef(new Set<string>());
  // 可用空间与运行时视口：固定 16:9，最小 MIN_VIEW_W x MIN_VIEW_H。
  const fillRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<ViewportSize | null>(null);
  const [viewport, setViewport] = useState<ViewportSize | null>(null);
  const [tooSmall, setTooSmall] = useState(false);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  // 渲染循环每帧读取：窗口小于最低要求时冻结推进与绘制。
  const blockedRef = useRef(false);

  // Block the context menu so right-click fleet orders work.
  usePreventContextMenu(canvasRef);

  // 视口跟随浏览器可用空间：等比放到最大，放不下最低要求时冻结并提示。
  useEffect(() => {
    const fill = fillRef.current;
    if (!fill) return;

    const update = () => {
      const width = fill.clientWidth;
      const height = fill.clientHeight;
      const fitted = fitViewport(width, height);
      blockedRef.current = fitted === null;
      setTooSmall(fitted === null);
      setAvailable((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      if (!fitted) return;
      viewportRef.current = fitted;
      setViewport((prev) => (prev && prev.width === fitted.width && prev.height === fitted.height ? prev : fitted));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(fill);
    return () => observer.disconnect();
  }, []);

  const ready = viewport !== null;

  // 只在首次拿到合法视口时创建场景；之后窗口变化只做 resize，不重建对局。
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const size = viewportRef.current;
    if (!canvas || !size) return;

    // 地图决定地形摆位与限制区；initializeGame 必须在 initRender 之前完成。
    initializeGame(map, fleets);
    const engine = initRender(canvas, getRestrictAreas(), size);
    sceneRef.current = engine.scenes[0] ?? null;
    setSceneVersion((v) => v + 1);

    // F key: make the selected ships fire at the mouse world position.
    const selection = getShipSelection();
    const scene = sceneRef.current;
    if (scene && selection) {
      bindAttackKey(scene, () => {
        const game = getGameInstance();
        const pointer = pointerRef.current;
        const rect = canvas.getBoundingClientRect();
        if (!game || !pointer || rect.width <= 0 || rect.height <= 0) return;
        const aim = screenToWorld(scene, pointer.clientX, pointer.clientY, rect);
        mouseRef.current = aim;
        game.focusFireAt(selection.list, aim.x, aim.y);
      });
    }

    const handleMove = (event: MouseEvent) => {
      const currentScene = sceneRef.current;
      const rect = canvas.getBoundingClientRect();
      if (!currentScene || rect.width <= 0 || rect.height <= 0) return;
      pointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      mouseRef.current = screenToWorld(currentScene, event.clientX, event.clientY, rect);
    };
    canvas.addEventListener("mousemove", handleMove);

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const currentScene = sceneRef.current;
      const rect = canvas.getBoundingClientRect();
      if (!currentScene || rect.width <= 0 || rect.height <= 0) return;

      const before = screenToWorld(currentScene, event.clientX, event.clientY, rect);
      const factor = Math.exp(-event.deltaY * 0.0012);
      const oldZoom = getZoom();
      zoomBy(factor);
      if (getZoom() === oldZoom) return;

      const camera = currentScene.activeCamera as FreeCamera | null;
      if (camera) applyZoomToCamera(camera);

      const after = screenToWorld(currentScene, event.clientX, event.clientY, rect);
      const focus = getCameraFocus();
      setCameraFocus(focus.x + before.x - after.x, focus.y + before.y - after.y, 2);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    // WASD / arrow keys: hold to pan the camera viewport.
    const panKeys = panKeysRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!PAN_KEYS.has(key) || isEditableTarget(event.target)) return;
      // Don't swallow browser shortcuts like Ctrl+D / Cmd+W.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      panKeys.add(key);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      panKeys.delete(event.key.toLowerCase());
    };
    const handleBlur = () => panKeys.clear();
    globalThis.addEventListener("keydown", handleKeyDown);
    globalThis.addEventListener("keyup", handleKeyUp);
    globalThis.addEventListener("blur", handleBlur);

    let last = performance.now();
    engine.runRenderLoop(() => {
      const now = performance.now();
      const rawDt = Math.min((now - last) / 1000, 0.05);
      last = now;
      // 窗口小于最低要求：暂停推进与绘制，等待用户调整到可渲染尺寸。
      if (blockedRef.current) return;
      const dt = rawDt * getGameSpeedMultiplier();

      const game = getGameInstance();
      if (!game) return;
      game.update(dt);

      // Keyboard panning uses real time and is not affected by 2x game speed.
      const dx = (panKeys.has("d") || panKeys.has("arrowright") ? 1 : 0) - (panKeys.has("a") || panKeys.has("arrowleft") ? 1 : 0);
      const dy = (panKeys.has("s") || panKeys.has("arrowdown") ? 1 : 0) - (panKeys.has("w") || panKeys.has("arrowup") ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        const length = Math.hypot(dx, dy);
        const step = (PAN_SPEED * rawDt) / length;
        panCameraBy(dx * step, dy * step);
      }

      renderGame(game, dt);

      // Restrict-area errors stop the loop and show a modal instead of drawing out-of-bounds ships.
      const err = getRestrictError();
      if (err && !showRestrictError) {
        setRestrictError(err);
        setShowRestrictError(true);
        engine.stopRenderLoop();
      }

      // Sync game-over state into React via refs to avoid stale closure values.
      if (game.over !== gameOverRef.current || game.winnerTeam !== winnerTeamRef.current) {
        gameOverRef.current = game.over;
        winnerTeamRef.current = game.winnerTeam;
        setGameOver(game.over);
        setWinnerTeam(game.winnerTeam);
      }
    });

    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
      globalThis.removeEventListener("keyup", handleKeyUp);
      globalThis.removeEventListener("blur", handleBlur);
      panKeys.clear();
      canvas.removeEventListener("mousemove", handleMove);
      canvas.removeEventListener("wheel", handleWheel);
      engine.stopRenderLoop();
      disposeRender();
      clearGameInstance();
      setTerrainField(null);
      sceneRef.current = null;
      setSceneVersion(0);
    };
  }, [map, fleets, ready]);

  // 可用空间变化后同步相机 / HUD / 海面与 backbuffer。
  useLayoutEffect(() => {
    if (!viewport) return;
    resizeRender(viewport.width, viewport.height);
  }, [viewport]);

  // 游戏结束后回到选图界面；选择新地图会重新挂载整个战场。
  const handleRestart = useCallback(() => {
    onChangeMap();
  }, [onChangeMap]);

  const scene = sceneRef.current;
  const winnerText = winnerTeam === "red" ? t("hud.winnerRed") : winnerTeam === "blue" ? t("hud.winnerBlue") : t("hud.winnerDraw");
  const results = gameOver ? (getGameInstance()?.record.getResults() ?? []) : [];
  const subtitle = t("battleRecord.mapInfo", { name: t(map.nameKey) });
  const stageHidden = tooSmall || viewport === null;

  return (
    <div className="battle-fill" ref={fillRef}>
      <div
        className={stageHidden ? "battle-stage is-blocked" : "battle-stage"}
        style={viewport ? { width: viewport.width, height: viewport.height } : undefined}
      >
        <canvas ref={canvasRef} id="c" className="battle-canvas" />
        {scene ? <Hud key={sceneVersion} scene={scene} allow2x={true} /> : null}
        <Minimap />
        <BattleResult
          scene={scene}
          open={gameOver}
          title={winnerText}
          titleColor={winnerTeam === "red" ? "#ff7b6b" : winnerTeam === "blue" ? "#7cc4ff" : "#cfe3f5"}
          subtitle={subtitle}
          winnerTeam={winnerTeam}
          results={results}
          onRestart={handleRestart}
        />
        <Model
          scene={scene}
          open={showRestrictError}
          title={t("ship.restrictErrorTitle")}
          message={restrictError ?? ""}
          actions={[
            {
              label: t("ship.restrictErrorButton"),
              onClick: () => {
                setShowRestrictError(false);
                setRestrictError(null);
              },
            },
          ]}
        />
      </div>
      {tooSmall ? (
        <div className="viewport-too-small" role="alert">
          <h2>{t("viewport.tooSmallTitle")}</h2>
          <p>
            {t("viewport.tooSmallBody", {
              width: MIN_VIEW_W,
              height: MIN_VIEW_H,
              availableWidth: available.width,
              availableHeight: available.height,
            })}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// 选图 → 战斗 → 结束后返回选图。战场以地图 id 为 key，换图时完整重建场景。
// 舰队选择放在这一层，战斗结束返回选图时仍保留上一次的编队。
export default function BattleCanvas() {
  const [battle, setBattle] = useState<{ map: GameMap; fleets: FleetShips } | null>(null);
  const [ships] = useState(() => shipManager.export());
  const [selection, setSelection] = useState<FleetSelection>(() => createInitialFleetSelection(ships));

  const toggleShip = useCallback((team: FleetTeam, id: string) => {
    setSelection((prev) => {
      const current = prev[team];
      if (current.includes(id)) {
        return team === "red"
          ? { ...prev, red: prev.red.filter((shipId) => shipId !== id) }
          : { ...prev, blue: prev.blue.filter((shipId) => shipId !== id) };
      }
      if (current.length >= FLEET_SIZE) return prev;
      if (team === "red") {
        return { red: [...prev.red, id], blue: prev.blue.filter((shipId) => shipId !== id) };
      }
      return { red: prev.red.filter((shipId) => shipId !== id), blue: [...prev.blue, id] };
    });
  }, []);

  if (!battle) {
    return (
      <MapSelect
        maps={getMaps()}
        ships={ships}
        selection={selection}
        onToggleShip={toggleShip}
        onSelect={(map, fleets) => setBattle({ map, fleets })}
      />
    );
  }

  return <BattleStage key={battle.map.id} map={battle.map} fleets={battle.fleets} onChangeMap={() => setBattle(null)} />;
}
