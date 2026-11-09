import { useCallback, useEffect, useRef, useState } from "react";
import type { Scene } from "@babylonjs/core";
import { getGameInstance, initializeGame, resetGame } from "../game/Game";
import { disposeRender, getShipSelection, initRender, renderGame } from "../game/render";
import { bindAttackKey } from "../game/selection";
import { W, H } from "../game/utils";
import { usePreventContextMenu } from "../hooks/use-prevent-context-menu";
import Hud from "./Hud";

// 2D 海战 Babylon.js 渲染容器（尺寸由 App.css 的 .map-section canvas 控制）
export default function BattleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [winnerTeam, setWinnerTeam] = useState<"red" | "blue" | null>(null);
  // 用 ref 打破 render loop 闭包的 stale问题：loop 内始终与最新状态比较
  const gameOverRef = useRef(false);
  const winnerTeamRef = useRef<"red" | "blue" | null>(null);
  // 鼠标在世界坐标中的位置，供 F 键开火瞄准
  const mouseRef = useRef<{ x: number; y: number }>({ x: W / 2, y: H / 2 });

  // 屏蔽右键菜单，否则右键移动会弹出浏览器菜单
  usePreventContextMenu(canvasRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    initializeGame();
    const engine = initRender(canvas);
    // 按 CSS 布局尺寸校正画布分辨率（避免初始 0×0 黑屏）
    engine.resize();
    sceneRef.current = engine.scenes[0] ?? null;
    setSceneVersion((v) => v + 1);

    // F 键：命令当前选中的舰船向鼠标所在世界位置齐射
    const selection = getShipSelection();
    if (sceneRef.current && selection) {
      bindAttackKey(sceneRef.current, () => {
        const game = getGameInstance();
        const mouse = mouseRef.current;
        if (game && mouse) game.focusFireAt(selection.list, mouse.x, mouse.y);
      });
    }

    const toWorld = (event: MouseEvent): { x: number; y: number } | null => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        x: ((event.clientX - rect.left) / rect.width) * W,
        y: ((event.clientY - rect.top) / rect.height) * H,
      };
    };

    const handleMove = (event: MouseEvent) => {
      const point = toWorld(event);
      if (point) mouseRef.current = point;
    };
    canvas.addEventListener("mousemove", handleMove);

    let last = performance.now();
    engine.runRenderLoop(() => {
      const now = performance.now();
      let dt = (now - last) / 1000;
      last = now;
      dt = Math.min(dt, 0.05);

      const game = getGameInstance();
      if (!game) return;
      game.update(dt);
      renderGame(game);

      // 把游戏结束状态同步到 React HUD（用 ref 避免闭包 stale）
      if (game.over !== gameOverRef.current || game.winnerTeam !== winnerTeamRef.current) {
        gameOverRef.current = game.over;
        winnerTeamRef.current = game.winnerTeam;
        setGameOver(game.over);
        setWinnerTeam(game.winnerTeam);
      }
    });

    const handleResize = () => engine.resize();
    window.addEventListener("resize", handleResize);

    const handleClick = () => {
      const game = getGameInstance();
      if (game && game.over) resetGame();
    };
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("mousemove", handleMove);

    return () => {
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("click", handleClick);
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

  return (
    <>
      <canvas ref={canvasRef} id="c" />
      {scene ? <Hud key={sceneVersion} scene={scene} gameOver={gameOver} winnerTeam={winnerTeam} onRestart={handleRestart} /> : null}
    </>
  );
}
