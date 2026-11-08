import { useEffect, useRef, useState } from "react";
import type { Engine, Scene } from "@babylonjs/core";
import { useTranslation } from "react-i18next";
import Hud from "../components/Hud";
import { createBabylonScene } from "../babylon";
import "./playground.css";

// HUD 测试中心：仅渲染 HUD 组件本身，配合 input/checkbox 改变状态，
// 方便在无游戏内容的前提下验证 HUD 的 Babylon GUI 表现与 i18n。
export default function TestHub() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [winnerTeam, setWinnerTeam] = useState<"red" | "blue" | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const babylon = createBabylonScene({
      canvas,
      clearColor: [0.04, 0.17, 0.27, 1],
      width: 1600,
      height: 900,
    });
    engineRef.current = babylon.engine;
    const thisScene = babylon.scene;

    setScene(thisScene);
    setSceneVersion((v) => v + 1);

    babylon.engine.runRenderLoop(() => {
      // 测试中心无游戏逻辑，仅驱动渲染以显示 HUD
      thisScene.render();
    });

    return () => {
      babylon.dispose();
      setScene(null);
      setSceneVersion(0);
    };
  }, []);

  return (
    <div className="playground">
      <div className="playground-body">
        <section className="playground-controls">
          <h2>{t("playground.controls")}</h2>
          <label>
            <input type="checkbox" checked={gameOver} onChange={(e) => setGameOver(e.target.checked)} />
            {t("playground.gameOver")}
          </label>
          <fieldset>
            <legend>{t("playground.winner")}</legend>
            <label>
              <input type="radio" name="winner" checked={winnerTeam === null} onChange={() => setWinnerTeam(null)} />
              {t("playground.winnerNone")}
            </label>
            <label>
              <input type="radio" name="winner" checked={winnerTeam === "red"} onChange={() => setWinnerTeam("red")} />
              {t("playground.winnerRed")}
            </label>
            <label>
              <input type="radio" name="winner" checked={winnerTeam === "blue"} onChange={() => setWinnerTeam("blue")} />
              {t("playground.winnerBlue")}
            </label>
          </fieldset>
          <button
            type="button"
            onClick={() => {
              setGameOver(false);
              setWinnerTeam(null);
            }}
          >
            {t("playground.reset")}
          </button>
        </section>
        <section className="playground-preview">
          <canvas ref={canvasRef} className="playground-canvas" width={1600} height={900} />
          {scene ? <Hud key={sceneVersion} scene={scene} gameOver={gameOver} winnerTeam={winnerTeam} onRestart={() => setGameOver(false)} /> : null}
        </section>
      </div>
    </div>
  );
}
