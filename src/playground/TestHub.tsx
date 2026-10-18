import { useEffect, useRef, useState } from "react";
import { Engine, Color4, Vector3, FreeCamera, Camera, Scene } from "@babylonjs/core";
import { useTranslation } from "react-i18next";
import Hud from "../components/Hud";

// HUD 测试中心：仅渲染 HUD 组件本身，配合 input/checkbox 改变状态，
// 方便在无游戏内容的前提下验证 HUD 的 Babylon GUI 表现与 i18n。
export default function TestHub() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
//   const sceneRef = useRef<Scene | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [winnerTeam, setWinnerTeam] = useState<"red" | "blue" | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
    engineRef.current = engine;
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.04, 0.17, 0.27, 1);

    const camera = new FreeCamera("camera", new Vector3(0, 0, -100), scene);
    camera.setTarget(Vector3.Zero());
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoLeft = -800;
    camera.orthoRight = 800;
    camera.orthoTop = 450;
    camera.orthoBottom = -450;
    scene.activeCamera = camera;

    setScene(scene);
    setSceneVersion((v) => v + 1);

    // 等布局确定后再 resize，避免 canvas 尺寸为 0
    engine.resize();

    engine.runRenderLoop(() => {
      // 测试中心无游戏逻辑，仅驱动渲染以显示 HUD
      scene.render();
    });

    const observer = new ResizeObserver(() => engine.resize());
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      engine.stopRenderLoop();
      engine.dispose();
      engineRef.current = null;
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
