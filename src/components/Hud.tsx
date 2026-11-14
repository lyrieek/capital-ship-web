import { useEffect, useRef } from "react";
import type { Scene } from "@babylonjs/core";
import { AdvancedDynamicTexture, TextBlock } from "@babylonjs/gui";
import { useTranslation } from "react-i18next";

export interface HudProps {
  scene: Scene | null;
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
export default function Hud({ scene }: HudProps) {
  const { t } = useTranslation();
  const titleRef = useRef<TextBlock | null>(null);
  const weaponRef = useRef<TextBlock | null>(null);
  const selectionHintRef = useRef<TextBlock | null>(null);

  useEffect(() => {
    if (!scene) return;
    const root = AdvancedDynamicTexture.CreateFullscreenUI("hudUi", true, scene);

    const title = makeTextBlock("hudTitle", "#b4d7f5", "600", 15, "left", "top", 22, 32, "40%", 20);
    root.addControl(title);
    titleRef.current = title;

    const weapon = makeTextBlock("hudWeapon", "#8cb4cd", "400", 13, "right", "top", -22, 32, "55%", 20);
    root.addControl(weapon);
    weaponRef.current = weapon;

    const selectionHint = makeTextBlock("hudSelectionHint", "rgba(180,215,245,0.7)", "400", 13, "left", "bottom", 22, -18, "70%", 18);
    root.addControl(selectionHint);
    selectionHintRef.current = selectionHint;

    return () => {
      root.dispose();
      titleRef.current = null;
      weaponRef.current = null;
      selectionHintRef.current = null;
    };
  }, [scene]);

  // 根据状态更新文案与可见性（i18n）
  useEffect(() => {
    if (!titleRef.current || !weaponRef.current) return;
    titleRef.current.text = t("hud.title");
    weaponRef.current.text = t("hud.weaponInfo");
    if (selectionHintRef.current) selectionHintRef.current.text = t("hud.selectionHint");
  }, [t]);

  return null;
}
