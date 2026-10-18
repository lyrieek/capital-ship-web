import { useCallback, useEffect, useRef, useState } from "react";
import type { Scene } from "@babylonjs/core";
import { getGameInstance, initializeGame, resetGame } from "../game/Game";
import { disposeRender, initRender, renderGame } from "../game/render";
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    initializeGame();
    const engine = initRender(canvas);
    // 按 CSS 布局尺寸校正画布分辨率（避免初始 0×0 黑屏）
    engine.resize();
    sceneRef.current = engine.scenes[0] ?? null;
    setSceneVersion((v) => v + 1);

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

    return () => {
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("click", handleClick);
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
