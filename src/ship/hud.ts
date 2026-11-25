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
  stateLabel: TextBlock;
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

function createStateLabel(ship: Ship): TextBlock {
  const label = makeText(`shipHudState_${ship.name}`, 10, "400", "#fbbf24");
  label.width = `${HUD_WIDTH}px`;
  label.height = "11px";
  label.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  label.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  label.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  label.outlineWidth = 1;
  label.outlineColor = "rgba(3,10,18,0.55)";
  label.top = "23px";
  label.isVisible = false;
  return label;
}

function createHudControls(ship: Ship): HudControls {
  const panel = createPanel(ship);

  const nameLabel = createNameLabel(ship);
  panel.addControl(nameLabel);

  const { bar, ghost, fill } = createBar(ship);
  panel.addControl(bar);

  const stateLabel = createStateLabel(ship);
  panel.addControl(stateLabel);

  return { panel, nameLabel, ghost, fill, stateLabel };
}

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
    const { panel, nameLabel, ghost, fill, stateLabel } = createHudControls(ship);

    panel.scaleX = shipSize;
    panel.scaleY = shipSize;
    root.addControl(panel);
    panel.linkWithMesh(mesh);
    panel.linkOffsetYInPixels = -(ship.wid / 2 + 26) * shipSize;

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
        stateLabel.text = "";
        stateLabel.isVisible = false;
        return;
      }
      stateLabel.text = i18n.t(STATE_KEYS[state]);
      stateLabel.color = state === "dodge" ? "#fbbf24" : "#7dd3fc";
      stateLabel.isVisible = ship.alive;
    };

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
