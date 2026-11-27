import type { Mesh, Scene } from "@babylonjs/core";
import { AdvancedDynamicTexture, Control, Rectangle, TextBlock } from "@babylonjs/gui";
import i18n from "i18next";
import "../i18n";
import { registerGuiLayer, unregisterGuiLayer } from "../babylon/gui";
import type { Ship } from "./ship";

const HUD_WIDTH = 104;
const HUD_HEIGHT = 35;
const BAR_WIDTH = 84;
const BAR_HEIGHT = 5;
const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', sans-serif";

const STATE_KEYS = {
  dodge: "shipHud.state.dodge",
  recover: "shipHud.state.recover",
} as const;

const STATE_DISPLAY_SECONDS = 3;
const STATE_FADE_SECONDS = 0.6;
const BUBBLE_ALPHA = 0.9;

// TODO(调试HUD): 显示行动模式阶段（search/approach/engage/loop）、环绕圈、
// 期望航向、当前速度倍率、转向疲劳、卡位计时、鱼雷齐射队列，
// 以及贴边状态（平行航向 / 到边界距离 / 索敌权重），方便调参与观察 AI 决策。

export interface ShipHud {
  setVisible(visible: boolean): void;
  sync(ship: Ship): void;
  dispose(): void;
}

export interface ShipHudLayer {
  create(ship: Ship, mesh: Mesh, shipSize: number): ShipHud;
  /** 视口宽度变化后更新设计宽度，保持 HUD 的屏幕像素尺寸稳定 */
  setViewportWidth(width: number): void;
  dispose(): void;
}

interface ShipHudImpl extends ShipHud {
  refreshLabels(): void;
}

interface HudControls {
  panel: Rectangle;
  nameLabel: TextBlock;
  ghost: Rectangle;
  fill: Rectangle;
  stateBubble: Rectangle;
  stateText: TextBlock;
  stateTail: Rectangle;
}

function hpColor(ratio: number): string {
  if (ratio > 0.55) return "#34d399";
  if (ratio > 0.25) return "#fbbf24";
  return "#f87171";
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function makeText(name: string, fontSize: number, fontWeight: string, color: string): TextBlock {
  const block = new TextBlock(name, "");
  block.fontFamily = FONT_FAMILY;
  block.fontSize = fontSize;
  block.fontWeight = fontWeight;
  block.color = color;
  return block;
}

function createPanel(ship: Ship): Rectangle {
  const panel = new Rectangle(`shipHud_${ship.name}`);
  panel.width = `${HUD_WIDTH}px`;
  panel.height = `${HUD_HEIGHT}px`;
  panel.thickness = 0;
  panel.isHitTestVisible = false;
  return panel;
}

function createNameLabel(ship: Ship): TextBlock {
  const label = makeText(`shipHudName_${ship.name}`, 13, "600", "#f2f8ff");
  label.width = `${HUD_WIDTH}px`;
  label.height = "15px";
  label.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  label.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  label.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  label.outlineWidth = 1.5;
  label.outlineColor = "rgba(3,10,18,0.6)";
  return label;
}

function createBar(ship: Ship): { bar: Rectangle; ghost: Rectangle; fill: Rectangle } {
  const bar = new Rectangle(`shipHudBar_${ship.name}`);
  bar.width = `${BAR_WIDTH}px`;
  bar.height = `${BAR_HEIGHT}px`;
  bar.cornerRadius = 2.5;
  bar.thickness = 0;
  bar.background = "rgba(2,8,14,0.38)";
  bar.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  bar.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  bar.top = "17px";

  const ghost = new Rectangle(`shipHudGhost_${ship.name}`);
  ghost.width = "100%";
  ghost.height = "100%";
  ghost.cornerRadius = 2.5;
  ghost.thickness = 0;
  ghost.background = "rgba(248,113,113,0.5)";
  ghost.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  ghost.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  ghost.isVisible = false;
  bar.addControl(ghost);

  const fill = new Rectangle(`shipHudFill_${ship.name}`);
  fill.width = "100%";
  fill.height = "100%";
  fill.cornerRadius = 2.5;
  fill.thickness = 0;
  fill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  fill.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  bar.addControl(fill);

  return { bar, ghost, fill };
}

function createStateBubble(ship: Ship): { bubble: Rectangle; text: TextBlock; tail: Rectangle } {
  const bubble = new Rectangle(`shipStateBubble_${ship.name}`);
  // 宽度交给子文字测量（adaptWidthToChildren），气泡只包住「规避 / 回正」四个字，
  // 不再固定 100px 把气泡拉得和血条面板一样宽。
  bubble.width = "1px";
  bubble.height = "20px";
  bubble.adaptWidthToChildren = true;
  bubble.cornerRadius = 9;
  bubble.thickness = 0;
  bubble.background = "rgba(255,255,255,0.14)";
  bubble.alpha = 0;
  bubble.isVisible = false;
  bubble.isHitTestVisible = false;
  bubble.paddingLeft = "7px";
  bubble.paddingRight = "7px";
  bubble.paddingTop = "1px";
  bubble.paddingBottom = "1px";
  bubble.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
  bubble.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  bubble.top = "-6px";

  const tail = new Rectangle(`shipStateBubbleTail_${ship.name}`);
  tail.width = "10px";
  tail.height = "10px";
  tail.cornerRadius = 1;
  tail.thickness = 0;
  tail.background = "rgba(255,255,255,0.14)";
  tail.rotation = Math.PI / 4;
  tail.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
  tail.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
  tail.top = "-5px";
  tail.isVisible = false;
  bubble.addControl(tail);

  const text = new TextBlock(`shipStateText_${ship.name}`, "");
  text.fontFamily = FONT_FAMILY;
  text.fontSize = "11px";
  text.fontWeight = "500";
  text.color = "#f2f8ff";
  text.outlineWidth = 1;
  text.outlineColor = "rgba(3,10,18,0.55)";
  // 不换行：resizeToFit 才能量出准确的文字宽度，气泡再由 adaptWidthToChildren 收紧
  text.textWrapping = false;
  text.resizeToFit = true;
  text.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  text.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  bubble.addControl(text);

  return { bubble, text, tail };
}

function createHudControls(ship: Ship): HudControls {
  const panel = createPanel(ship);

  const nameLabel = createNameLabel(ship);
  panel.addControl(nameLabel);

  const { bar, ghost, fill } = createBar(ship);
  panel.addControl(bar);

  const { bubble: stateBubble, text: stateText, tail: stateTail } = createStateBubble(ship);
  // stateBubble 不作为 panel 子控件，改为独立 linkWithMesh，避免和面板顶部的 nameLabel 重叠
  return { panel, nameLabel, ghost, fill, stateBubble, stateText, stateTail };
}

// oxlint-disable-next-line max-lines-per-function
export function createShipHudLayer(scene: Scene, designWidth: number): ShipHudLayer {
  const root = AdvancedDynamicTexture.CreateFullscreenUI("shipHudUi", true, scene);
  registerGuiLayer(root, "shipHud");
  root.idealWidth = designWidth;
  root.disablePicking = true;

  const huds: ShipHudImpl[] = [];

  const refreshAll = () => {
    for (const hud of huds) hud.refreshLabels();
  };
  i18n.on("languageChanged", refreshAll);

  const create = (ship: Ship, mesh: Mesh, shipSize: number): ShipHud => {
    const { panel, nameLabel, ghost, fill, stateBubble, stateText, stateTail } = createHudControls(ship);

    panel.scaleX = shipSize;
    panel.scaleY = shipSize;
    root.addControl(panel);
    panel.linkWithMesh(mesh);
    panel.linkOffsetYInPixels = -(ship.wid / 2 + 26) * shipSize;

    stateBubble.scaleX = shipSize;
    stateBubble.scaleY = shipSize;
    root.addControl(stateBubble);
    stateBubble.linkWithMesh(mesh);
    // 定位到舰船投影右上方，与面板（舰船名+血条）分开，不重叠
    stateBubble.linkOffsetXInPixels = (ship.wid / 2 + 12) * shipSize;
    stateBubble.linkOffsetYInPixels = -(ship.wid / 2 + 34) * shipSize;

    const displayName = () => {
      const key = ship.nameKey;
      if (!key) return ship.name;
      const label = i18n.t(key);
      return label && label !== key ? label : ship.name;
    };

    const refreshLabels = () => {
      nameLabel.text = displayName();
      const state = ship.state;
      if (state === "normal") {
        stateText.text = "";
        stateBubble.isVisible = false;
        stateTail.isVisible = false;
        return;
      }
      stateText.text = i18n.t(STATE_KEYS[state]);
      stateText.color = state === "dodge" ? "#fbbf24" : "#7dd3fc";
      stateBubble.isVisible = true;
      stateTail.isVisible = true;
    };

    let stateShowTimer = 0;
    let stateFading = false;

    const applyRatio = (value: number) => {
      fill.width = `${value * 100}%`;
      fill.background = hpColor(value);
      fill.isVisible = value > 0;
    };

    let ratio = clampRatio(ship.hp / ship.maxHp);
    let ghostRatio = ratio;
    let ghostShown = ratio;
    let lastPulse = 1;
    let lastFrame = performance.now();
    let lastHp = ship.hp;
    let lastState = ship.state;

    applyRatio(ratio);
    refreshLabels();

    const setVisible = (visible: boolean) => {
      panel.isVisible = visible;
      stateBubble.isVisible = visible;
      stateTail.isVisible = visible;
    };

    const sync = (current: Ship) => {
      const now = performance.now();
      const dt = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;

      if (current.hp !== lastHp) {
        lastHp = current.hp;
        ratio = clampRatio(current.hp / current.maxHp);
        if (ghostRatio < ratio) ghostRatio = ratio;
        applyRatio(ratio);
      }

      if (current.state !== lastState) {
        lastState = current.state;
        refreshLabels();

        if (current.state === "normal") {
          stateBubble.alpha = 0;
          stateText.alpha = 0;
          stateTail.alpha = 0;
        } else {
          stateBubble.alpha = BUBBLE_ALPHA;
          stateText.alpha = BUBBLE_ALPHA;
          stateTail.alpha = BUBBLE_ALPHA;
        }
        stateShowTimer = 0;
        stateFading = false;
      } else if (current.state === "dodge" || current.state === "recover") {
        stateShowTimer += dt;

        if (!stateFading && stateShowTimer >= STATE_DISPLAY_SECONDS) {
          stateFading = true;
        }

        if (stateFading) {
          const fadeProgress = (stateShowTimer - STATE_DISPLAY_SECONDS) / STATE_FADE_SECONDS;
          const newAlpha = Math.max(0, BUBBLE_ALPHA * (1 - fadeProgress));
          stateBubble.alpha = newAlpha;
          stateText.alpha = newAlpha;
          stateTail.alpha = newAlpha;

          if (newAlpha <= 0) {
            stateBubble.isVisible = false;
            stateText.text = "";
            stateTail.isVisible = false;
          }
        } else {
          stateBubble.isVisible = true;
          stateTail.isVisible = true;
          stateBubble.alpha = BUBBLE_ALPHA;
          stateText.alpha = BUBBLE_ALPHA;
          stateTail.alpha = BUBBLE_ALPHA;
        }
      }

      ghostRatio = ghostRatio > ratio ? Math.max(ratio, ghostRatio - dt * 1.1) : ratio;
      if (Math.abs(ghostRatio - ghostShown) > 0.002) {
        ghostShown = ghostRatio;
        ghost.width = `${ghostShown * 100}%`;
        ghost.isVisible = ghostShown > ratio + 0.002;
      }

      if (ratio > 0 && ratio < 0.25) {
        const pulse = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(now / 125));
        if (Math.abs(pulse - lastPulse) > 0.03) {
          lastPulse = pulse;
          fill.alpha = pulse;
        }
      } else if (lastPulse !== 1) {
        lastPulse = 1;
        fill.alpha = 1;
      }

      if (!current.alive) {
        stateBubble.isVisible = false;
        stateTail.isVisible = false;
      }

      panel.isVisible = current.alive;
    };

    const impl: ShipHudImpl = {
      setVisible,
      sync,
      refreshLabels,
      dispose: () => {
        const index = huds.indexOf(impl);
        if (index !== -1) huds.splice(index, 1);
        panel.dispose();
        stateBubble.dispose();
      },
    };
    huds.push(impl);
    return impl;
  };

  return {
    create,
    setViewportWidth: (width: number) => {
      root.idealWidth = width;
    },
    dispose: () => {
      i18n.off("languageChanged", refreshAll);
      for (let index = huds.length - 1; index >= 0; index -= 1) huds[index].dispose();
      unregisterGuiLayer(root);
      root.dispose();
    },
  };
}
