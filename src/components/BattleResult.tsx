import { useEffect, useId, useRef } from "react";
import type { Scene } from "@babylonjs/core";
import { AdvancedDynamicTexture, Button, Control, Grid, Rectangle, StackPanel, TextBlock } from "@babylonjs/gui";
import { useTranslation } from "react-i18next";
import { registerGuiLayer, unregisterGuiLayer } from "../babylon/gui";
import { popUiBlocker, pushUiBlocker } from "../game/ui-state";
import type { ShipBattleRecord } from "../game/BattleRecord";
import { MAP_TEAM_COLORS } from "../map/types";

const FONT_FAMILY = "system-ui, sans-serif";
const PANEL_WIDTH = 780;
const HEADER_ROW_HEIGHT = 34;
const ROW_HEIGHT = 32;
const PANEL_PADDING = 24;
const TABLE_PADDING = 10;

type TextAlign = "left" | "center" | "right";
type Translate = (key: string) => string;

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function displayShipName(row: ShipBattleRecord, t: Translate): string {
  const key = row.nameKey;
  if (!key) return row.name;
  const label = t(key);
  return label && label !== key ? label : row.name;
}

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

function alignText(block: TextBlock, align: TextAlign): void {
  block.textHorizontalAlignment =
    align === "left"
      ? TextBlock.HORIZONTAL_ALIGNMENT_LEFT
      : align === "right"
        ? TextBlock.HORIZONTAL_ALIGNMENT_RIGHT
        : TextBlock.HORIZONTAL_ALIGNMENT_CENTER;
}

function makeCell(name: string, text: string, color: string, fontSize: number, fontWeight: string, align: TextAlign = "center"): TextBlock {
  const cell = makeText(name, text, color, fontSize, fontWeight);
  cell.width = "100%";
  cell.height = "100%";
  alignText(cell, align);
  return cell;
}

function makeRestartButton(name: string, label: string): { button: Button; labelBlock: TextBlock } {
  const button = new Button(name);
  button.width = "156px";
  button.height = "38px";
  button.cornerRadius = 10;
  button.thickness = 1;
  button.color = "rgba(140,205,255,0.9)";
  button.background = "rgba(48,120,190,0.95)";
  button.hoverCursor = "pointer";
  button.pointerEnterAnimation = () => {
    button.background = "rgba(66,146,220,1)";
  };
  button.pointerOutAnimation = () => {
    button.background = "rgba(48,120,190,0.95)";
  };

  const labelBlock = makeText(`${name}_label`, label, "#f2f8ff", 15, "600");
  button.addControl(labelBlock);
  return { button, labelBlock };
}

function createResultsGrid(results: readonly ShipBattleRecord[], t: Translate): Grid {
  const grid = new Grid("battleResultGrid");
  grid.width = "100%";
  grid.height = `${HEADER_ROW_HEIGHT + results.length * ROW_HEIGHT}px`;

  // 阵营 / 舰船 / 存活时间 / 杀敌数 / 死亡原因
  for (const weight of [0.8, 1.9, 1.1, 0.7, 1.8]) {
    grid.addColumnDefinition(weight);
  }
  grid.addRowDefinition(HEADER_ROW_HEIGHT, true);
  results.forEach(() => {
    grid.addRowDefinition(ROW_HEIGHT, true);
  });

  const headers = [
    t("battleRecord.team"),
    t("battleRecord.ship"),
    t("battleRecord.survival"),
    t("battleRecord.kills"),
    t("battleRecord.deathReason"),
  ];
  headers.forEach((text, column) => {
    grid.addControl(makeCell(`battleResultHeader_${column}`, text, "rgba(154,196,224,0.78)", 13, "600"), 0, column);
  });

  results.forEach((row, index) => {
    const rowIndex = index + 1;
    const teamColor = MAP_TEAM_COLORS[row.team];
    const team = t(row.team === "red" ? "battleRecord.teams.red" : "battleRecord.teams.blue");
    const outcome = row.alive ? t("battleRecord.alive") : t(`battleRecord.death.${row.deathReason ?? "unknown"}`);
    const cells: [string, string, TextAlign][] = [
      [team, teamColor, "center"],
      [displayShipName(row, t), "#d9ecfa", "left"],
      [formatDuration(row.survivalTime), "#d9ecfa", "center"],
      [String(row.kills), row.kills > 0 ? "#fbbf24" : "#d9ecfa", "center"],
      [outcome, row.alive ? "#86efac" : "rgba(226,242,255,0.82)", "left"],
    ];
    cells.forEach(([text, color, align], column) => {
      grid.addControl(makeCell(`battleResultCell_${index}_${column}`, text, color, 14, "400", align), rowIndex, column);
    });
  });

  return grid;
}

export interface BattleResultProps {
  scene: Scene | null;
  open: boolean;
  title: string;
  titleColor?: string;
  subtitle?: string;
  results: readonly ShipBattleRecord[];
  onRestart: () => void;
}

/**
 * 战斗结算面板：使用 Babylon GUI 原生控件（全屏 ADT + Grid / StackPanel / Button），
 * 与游戏内 HUD、弹窗保持同一套视觉语言。
 */
export default function BattleResult({ scene, open, title, titleColor = "#e6f2fb", subtitle = "", results, onRestart }: BattleResultProps) {
  const { t } = useTranslation();
  const id = useId();
  const latestRef = useRef({ onRestart });
  const backdropRef = useRef<Rectangle | null>(null);
  const panelRef = useRef<Rectangle | null>(null);
  const titleRef = useRef<TextBlock | null>(null);
  const subtitleRef = useRef<TextBlock | null>(null);
  const tableHostRef = useRef<Rectangle | null>(null);
  const restartLabelRef = useRef<TextBlock | null>(null);

  useEffect(() => {
    latestRef.current = { onRestart };
  }, [onRestart]);

  // 模态打开时暂停场景指针输入，避免点遮罩也选了船
  useEffect(() => {
    if (!open) return;
    pushUiBlocker();
    return () => popUiBlocker();
  }, [open]);

  useEffect(() => {
    if (!scene) return;
    const root = AdvancedDynamicTexture.CreateFullscreenUI(`battleResult${id}`, true, scene);
    registerGuiLayer(root, "modal");

    const backdrop = new Rectangle("battleResultBackdrop");
    backdrop.width = "100%";
    backdrop.height = "100%";
    backdrop.background = "rgba(4,12,22,0.72)";
    backdrop.thickness = 0;
    backdrop.isPointerBlocker = true;
    backdrop.isVisible = false;
    root.addControl(backdrop);

    const panel = new Rectangle("battleResultPanel");
    panel.width = `${PANEL_WIDTH}px`;
    panel.cornerRadius = 16;
    panel.thickness = 1;
    panel.color = "rgba(125,180,220,0.55)";
    panel.background = "rgba(7,20,34,0.96)";
    panel.shadowBlur = 24;
    panel.shadowColor = "rgba(0,0,0,0.55)";
    panel.setPadding(`${PANEL_PADDING}px`, "28px", "20px", "28px");
    panel.adaptHeightToChildren = true;
    panel.isVisible = false;
    root.addControl(panel);

    const stack = new StackPanel("battleResultStack");
    stack.isVertical = true;
    stack.spacing = 12;
    stack.width = "100%";
    panel.addControl(stack);

    const titleBlock = makeText("battleResultTitle", "", "#e6f2fb", 24, "700");
    titleBlock.height = "38px";
    stack.addControl(titleBlock);

    const subtitleBlock = makeText("battleResultSubtitle", "", "rgba(190,220,240,0.7)", 13, "400");
    subtitleBlock.height = "20px";
    stack.addControl(subtitleBlock);

    const tableHost = new Rectangle("battleResultTable");
    tableHost.width = "100%";
    tableHost.height = "160px";
    tableHost.cornerRadius = 10;
    tableHost.thickness = 1;
    tableHost.color = "rgba(125,180,220,0.2)";
    tableHost.background = "rgba(3,14,24,0.55)";
    tableHost.setPadding(`${TABLE_PADDING}px`, "12px", `${TABLE_PADDING}px`, "12px");
    stack.addControl(tableHost);

    const footer = new StackPanel("battleResultFooter");
    footer.isVertical = false;
    footer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    footer.height = "42px";
    footer.adaptWidthToChildren = true;
    stack.addControl(footer);

    const { button, labelBlock } = makeRestartButton("battleResultRestart", "");
    button.onPointerUpObservable.add(() => latestRef.current.onRestart());
    footer.addControl(button);

    backdropRef.current = backdrop;
    panelRef.current = panel;
    titleRef.current = titleBlock;
    subtitleRef.current = subtitleBlock;
    tableHostRef.current = tableHost;
    restartLabelRef.current = labelBlock;

    return () => {
      unregisterGuiLayer(root);
      root.dispose();
      backdropRef.current = null;
      panelRef.current = null;
      titleRef.current = null;
      subtitleRef.current = null;
      tableHostRef.current = null;
      restartLabelRef.current = null;
    };
  }, [scene, id]);

  useEffect(() => {
    const backdrop = backdropRef.current;
    const panel = panelRef.current;
    const tableHost = tableHostRef.current;
    if (!backdrop || !panel || !tableHost) return;

    backdrop.isVisible = open;
    panel.isVisible = open;
    if (!open) return;

    if (titleRef.current) {
      titleRef.current.text = title;
      titleRef.current.color = titleColor;
    }
    if (subtitleRef.current) subtitleRef.current.text = subtitle;
    if (restartLabelRef.current) restartLabelRef.current.text = t("battleRecord.restart");

    tableHost.clearControls();
    tableHost.height = `${HEADER_ROW_HEIGHT + results.length * ROW_HEIGHT + TABLE_PADDING * 2}px`;
    tableHost.addControl(createResultsGrid(results, t));
  }, [scene, open, title, titleColor, subtitle, results, t]);

  return null;
}
