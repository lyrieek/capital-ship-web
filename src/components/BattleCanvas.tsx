import { useEffect, useRef } from "react";
import { getGameInstance, initializeGame, resetGame } from "../game/Game";
import { disposeRender, initRender, renderGame } from "../game/render";

// 2D 海战 Babylon.js 渲染容器（尺寸由 App.css 的 .map-section canvas 控制）
export default function BattleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    initializeGame();
    const engine = initRender(canvas);
    // 按 CSS 布局尺寸校正画布分辨率
    engine.resize();

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
    };
  }, []);

  return <canvas ref={canvasRef} id="c" />;
}
