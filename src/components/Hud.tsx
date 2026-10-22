import { useEffect, useRef } from "react";
import type { Scene } from "@babylonjs/core";
import { AdvancedDynamicTexture, TextBlock, Rectangle } from "@babylonjs/gui";
import { useTranslation } from "react-i18next";

export interface HudProps {
  scene: Scene | null;
  gameOver: boolean;
  winnerTeam: "red" | "blue" | null;
  onRestart: () => void;
}

// 工厂函数：统一创建带对齐样式的 TextBlock
function makeTextBlock(
  name: string,
  color: string,
  fontWeight: string,
  fontSize: number,
  align: "left" | "right" | "center",
  vertical: "top" | "center" | "bottom",
  left: string | number,
  top: string | number,
  width: string,
  height: number,
): TextBlock {
  const tb = new TextBlock(name);
  tb.color = color;
  tb.fontFamily = "system-ui, sans-serif";
  tb.fontWeight = fontWeight;
  tb.fontSize = fontSize;
  tb.textHorizontalAlignment =
    align === "left"
      ? TextBlock.HORIZONTAL_ALIGNMENT_LEFT
      : align === "right"
        ? TextBlock.HORIZONTAL_ALIGNMENT_RIGHT
        : TextBlock.HORIZONTAL_ALIGNMENT_CENTER;
  tb.textVerticalAlignment =
    vertical === "top"
      ? TextBlock.VERTICAL_ALIGNMENT_TOP
      : vertical === "bottom"
        ? TextBlock.VERTICAL_ALIGNMENT_BOTTOM
        : TextBlock.VERTICAL_ALIGNMENT_CENTER;
  tb.horizontalAlignment =
    align === "left"
      ? TextBlock.HORIZONTAL_ALIGNMENT_LEFT
      : align === "right"
        ? TextBlock.HORIZONTAL_ALIGNMENT_RIGHT
        : TextBlock.HORIZONTAL_ALIGNMENT_CENTER;
  tb.verticalAlignment =
    vertical === "top"
      ? TextBlock.VERTICAL_ALIGNMENT_TOP
      : vertical === "bottom"
        ? TextBlock.VERTICAL_ALIGNMENT_BOTTOM
        : TextBlock.VERTICAL_ALIGNMENT_CENTER;
  tb.left = left;
  tb.top = top;
  tb.width = width;
  tb.height = height;
  return tb;
}

// 全屏 HUD：用 Babylon GUI（AdvancedDynamicTexture + TextBlock）替代原 Canvas 贴图
export default function Hud({ scene, gameOver, winnerTeam, onRestart }: HudProps) {
  const { t } = useTranslation();
  const rootRef = useRef<AdvancedDynamicTexture | null>(null);
  const titleRef = useRef<TextBlock | null>(null);
  const weaponRef = useRef<TextBlock | null>(null);
  const overlayRef = useRef<Rectangle | null>(null);
  const winnerRef = useRef<TextBlock | null>(null);
  const hintRef = useRef<TextBlock | null>(null);
  const selectionHintRef = useRef<TextBlock | null>(null);

  useEffect(() => {
    if (!scene) return;
    const root = AdvancedDynamicTexture.CreateFullscreenUI("hudUi", true, scene);
    rootRef.current = root;

    const title = makeTextBlock("hudTitle", "#b4d7f5", "600", 15, "left", "top", 22, 32, "40%", 20);
    root.addControl(title);
    titleRef.current = title;

    const weapon = makeTextBlock("hudWeapon", "#8cb4cd", "400", 13, "right", "top", -22, 32, "55%", 20);
    root.addControl(weapon);
    weaponRef.current = weapon;

    const overlay = new Rectangle("hudOverlay");
    overlay.width = "100%";
    overlay.height = "100%";
    overlay.background = "rgba(4,12,22,0)";
    overlay.thickness = 0;
    overlay.isPointerBlocker = false;
    overlay.onPointerDownObservable.add(() => {
      if (gameOver) onRestart();
    });
    root.addControl(overlay);
    overlayRef.current = overlay;

    const winner = makeTextBlock("hudWinner", "#cfe3f5", "700", 46, "center", "center", 0, "45%", "100%", 60);
    root.addControl(winner);
    winnerRef.current = winner;

    const hint = makeTextBlock("hudHint", "rgba(200,225,245,0.75)", "400", 16, "center", "center", 0, "45% + 50px", "100%", 24);
    root.addControl(hint);
    hintRef.current = hint;

    const selectionHint = makeTextBlock("hudSelectionHint", "rgba(180,215,245,0.7)", "400", 13, "left", "bottom", 22, -18, "70%", 18);
    root.addControl(selectionHint);
    selectionHintRef.current = selectionHint;

    return () => {
      root.dispose();
      titleRef.current = null;
      weaponRef.current = null;
      overlayRef.current = null;
      winnerRef.current = null;
      hintRef.current = null;
      selectionHintRef.current = null;
      rootRef.current = null;
    };
  }, [scene, onRestart]);

  // 根据状态更新文案与可见性（i18n）
  useEffect(() => {
    if (!titleRef.current || !weaponRef.current) return;
    titleRef.current.text = t("hud.title");
    weaponRef.current.text = t("hud.weaponInfo");
    if (selectionHintRef.current) selectionHintRef.current.text = t("hud.selectionHint");
  }, [t]);

  useEffect(() => {
    if (!overlayRef.current || !winnerRef.current || !hintRef.current) return;
    if (!gameOver) {
      overlayRef.current.background = "rgba(4,12,22,0)";
      overlayRef.current.isPointerBlocker = false;
      winnerRef.current.text = "";
      hintRef.current.text = "";
      return;
    }
    overlayRef.current.background = "rgba(4,12,22,0.65)";
    overlayRef.current.isPointerBlocker = true;
    const winnerText = winnerTeam === "red" ? t("hud.winnerRed") : winnerTeam === "blue" ? t("hud.winnerBlue") : t("hud.winnerDraw");
    winnerRef.current.text = winnerText;
    winnerRef.current.color = winnerTeam === "red" ? "#ff7b6b" : winnerTeam === "blue" ? "#7cc4ff" : "#cfe3f5";
    hintRef.current.text = t("hud.restartHint");
  }, [gameOver, winnerTeam, t]);

  return null;
}
