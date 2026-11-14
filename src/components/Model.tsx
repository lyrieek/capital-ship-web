import { useEffect, useId, useRef } from "react";
import type { Scene } from "@babylonjs/core";
import { AdvancedDynamicTexture, Button, Rectangle, StackPanel, TextBlock } from "@babylonjs/gui";

export interface ModelAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface ModelProps {
  scene: Scene | null;
  open: boolean;
  title?: string;
  message?: string;
  actions?: ModelAction[];
  width?: number | string;
  titleColor?: string;
  onBackdropClick?: () => void;
}

const FONT_FAMILY = "system-ui, sans-serif";

function makeText(name: string, text: string, color: string, fontSize: number, fontWeight: string): TextBlock {
  const block = new TextBlock(name, text);
  block.color = color;
  block.fontFamily = FONT_FAMILY;
  block.fontSize = fontSize;
  block.fontWeight = fontWeight;
  block.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_CENTER;
  block.textVerticalAlignment = TextBlock.VERTICAL_ALIGNMENT_CENTER;
  return block;
}

function makeButton(name: string, label: string, primary: boolean): Button {
  const button = new Button(name);
  button.width = "132px";
  button.height = "38px";
  button.cornerRadius = 10;
  button.thickness = 1;
  button.color = primary ? "rgba(140,205,255,0.9)" : "rgba(140,175,205,0.55)";
  button.background = primary ? "rgba(48,120,190,0.95)" : "rgba(18,38,58,0.9)";
  button.hoverCursor = "pointer";

  const labelBlock = makeText(`${name}_label`, label, primary ? "#f2f8ff" : "#c9def0", 15, primary ? "600" : "400");
  button.addControl(labelBlock);

  const baseBackground = button.background;
  button.pointerEnterAnimation = () => {
    button.background = primary ? "rgba(66,146,220,1)" : "rgba(28,54,80,0.95)";
  };
  button.pointerOutAnimation = () => {
    button.background = baseBackground;
  };

  return button;
}

export default function Model({
  scene,
  open,
  title = "",
  message = "",
  actions = [],
  width = 420,
  titleColor = "#e6f2fb",
  onBackdropClick,
}: ModelProps) {
  const id = useId();
  const latestRef = useRef({ open, actions: actions ?? [], onBackdropClick });
  const backdropRef = useRef<Rectangle | null>(null);
  const panelRef = useRef<Rectangle | null>(null);
  const titleRef = useRef<TextBlock | null>(null);
  const messageRef = useRef<TextBlock | null>(null);
  const footerRef = useRef<StackPanel | null>(null);

  useEffect(() => {
    latestRef.current = { open, actions: actions ?? [], onBackdropClick };
  });

  useEffect(() => {
    if (!scene) return;
    const root = AdvancedDynamicTexture.CreateFullscreenUI(`model${id}`, true, scene);

    const backdrop = new Rectangle("modelBackdrop");
    backdrop.width = "100%";
    backdrop.height = "100%";
    backdrop.background = "rgba(4,12,22,0.65)";
    backdrop.thickness = 0;
    backdrop.isPointerBlocker = true;
    backdrop.isVisible = false;
    backdrop.onPointerDownObservable.add(() => {
      const latest = latestRef.current;
      if (latest.open) latest.onBackdropClick?.();
    });
    root.addControl(backdrop);

    const panel = new Rectangle("modelPanel");
    panel.cornerRadius = 16;
    panel.thickness = 1;
    panel.color = "rgba(125,180,220,0.55)";
    panel.background = "rgba(7,20,34,0.96)";
    panel.shadowBlur = 24;
    panel.shadowColor = "rgba(0,0,0,0.55)";
    panel.setPadding("24px", "28px", "24px", "28px");
    panel.adaptHeightToChildren = true;
    panel.isVisible = false;
    root.addControl(panel);

    const stack = new StackPanel("modelStack");
    stack.isVertical = true;
    stack.spacing = 16;
    stack.width = "100%";
    panel.addControl(stack);

    const titleBlock = makeText("modelTitle", "", "#e6f2fb", 22, "700");
    titleBlock.height = "38px";
    titleBlock.paddingTop = "10px";
    stack.addControl(titleBlock);

    const messageBlock = makeText("modelMessage", "", "rgba(200,225,245,0.85)", 15, "400");
    messageBlock.textWrapping = true;
    messageBlock.resizeToFit = true;
    messageBlock.lineSpacing = "4px";
    stack.addControl(messageBlock);

    const footer = new StackPanel("modelFooter");
    footer.isVertical = false;
    footer.horizontalAlignment = StackPanel.HORIZONTAL_ALIGNMENT_CENTER;
    footer.spacing = 12;
    footer.height = "40px";
    footer.paddingBottom = "8px";
    footer.adaptWidthToChildren = true;
    stack.addControl(footer);

    backdropRef.current = backdrop;
    panelRef.current = panel;
    titleRef.current = titleBlock;
    messageRef.current = messageBlock;
    footerRef.current = footer;

    return () => {
      root.dispose();
      backdropRef.current = null;
      panelRef.current = null;
      titleRef.current = null;
      messageRef.current = null;
      footerRef.current = null;
    };
  }, [scene, id]);

  useEffect(() => {
    const backdrop = backdropRef.current;
    const panel = panelRef.current;
    if (!backdrop || !panel) return;

    backdrop.isVisible = open;
    panel.isVisible = open;
    panel.width = typeof width === "number" ? `${width}px` : width;

    if (titleRef.current) {
      titleRef.current.text = title;
      titleRef.current.color = titleColor;
      titleRef.current.isVisible = title.length > 0;
    }
    if (messageRef.current) {
      messageRef.current.text = message;
      messageRef.current.isVisible = message.length > 0;
    }
  }, [scene, open, title, message, width, titleColor]);

  const actionKey = `${actions.length}:${actions.map((action) => action.label).join("\u0000")}`;
  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    footer.clearControls();
    const singleAction = latestRef.current.actions.length === 1;
    latestRef.current.actions.forEach((action, index) => {
      const button = makeButton(`modelAction${id}_${index}`, action.label, singleAction || action.primary === true);
      button.onPointerUpObservable.add(() => {
        latestRef.current.actions[index]?.onClick();
      });
      footer.addControl(button);
    });
    footer.isVisible = latestRef.current.actions.length > 0;
  }, [scene, actionKey, id]);

  return null;
}
