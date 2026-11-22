import { useCallback, useEffect, useRef, useState } from "react";
import type { Scene } from "@babylonjs/core";
import { useTranslation } from "react-i18next";
import { getGameInstance, initializeGame, resetGame, getGameSpeedMultiplier } from "../game/Game";
import { disposeRender, getShipSelection, initRender, renderGame, getRestrictError } from "../game/render";
import { panCameraBy, screenToWorld } from "../game/camera-focus";
import { bindAttackKey } from "../game/selection";
import { W, H } from "../game/utils";
import { usePreventContextMenu } from "../hooks/use-prevent-context-menu";
import Hud from "./Hud";
import Minimap from "./Minimap";
import Model from "./Model";

// Keyboard viewport panning: WASD and arrow keys, in world units per second.
const PAN_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
const PAN_SPEED = 760;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

// Babylon.js render container for the 2D naval battle.
export default function BattleCanvas() {
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

  // Block the context menu so right-click fleet orders work.
  usePreventContextMenu(canvasRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    initializeGame();
    const engine = initRender(canvas);
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
      engine.stopRenderLoop();
      disposeRender();
      sceneRef.current = null;
      setSceneVersion(0);
    };
  }, []);

  const handleRestart = useCallback(() => {
    resetGame();
    gameOverRef.current = false;
    winnerTeamRef.current = null;
    setGameOver(false);
    setWinnerTeam(null);
  }, []);

  const scene = sceneRef.current;
  const winnerText = winnerTeam === "red" ? t("hud.winnerRed") : winnerTeam === "blue" ? t("hud.winnerBlue") : t("hud.winnerDraw");

  return (
    <div className="battle-stage">
      <canvas ref={canvasRef} id="c" className="battle-canvas" />
      {scene ? <Hud key={sceneVersion} scene={scene} allow2x={true} /> : null}
      <Minimap />
      <Model
        scene={scene}
        open={gameOver}
        title={winnerText}
        message={t("hud.restartPrompt")}
        titleColor={winnerTeam === "red" ? "#ff7b6b" : winnerTeam === "blue" ? "#7cc4ff" : "#cfe3f5"}
        actions={[{ label: t("hud.restartButton"), onClick: handleRestart }]}
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
  );
}
