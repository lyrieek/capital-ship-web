import { useRef, useEffect } from "react";
import { initializeGame, resetGame, getGameInstance } from "../game/Game";
import { setContext } from "../game/draw";
import { H, W } from "../game/utils";

// 2D Naval Battle Canvas component
export default function BattleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    initializeGame();
    setContext(canvas.getContext("2d")!);

    let last = performance.now();

    const loop = (now: number) => {
      let dt = (now - last) / 1000;
      last = now;
      dt = Math.min(dt, 0.05);

      const game = getGameInstance();
      if (game) {
        game.update(dt);
        game.draw();
      }

      requestAnimationFrame(loop);
    };
    const animationFrameId = requestAnimationFrame(loop);

    const handleClick = () => {
      const game = getGameInstance();
      if (game && game.over) {
        resetGame();
      }
    };
    canvas.addEventListener("click", handleClick);

    return () => {
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener("click", handleClick);
    };
  }, []);

  return <canvas ref={canvasRef} id="c" width={W} height={H} />;
}
