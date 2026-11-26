import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Scene } from "@babylonjs/core";
import { AdvancedDynamicTexture, Button, Control, Grid, Rectangle, StackPanel, TextBlock } from "@babylonjs/gui";
import { useTranslation } from "react-i18next";
import { registerGuiLayer, unregisterGuiLayer } from "../babylon/gui";
import { popUiBlocker, pushUiBlocker } from "../game/ui-state";
import type { DeathInfo, ShipBattleRecord } from "../game/BattleRecord";
import { computeScore, rankScores, type ScoreResult } from "../game/Score";
import { MAP_TEAM_COLORS } from "../map/types";

const FONT_FAMILY = "system-ui, sans-serif";
const PANEL_WIDTH = 950;
const HEADER_ROW_HEIGHT = 40;
const ROW_HEIGHT = 38;
const TABLE_PADDING = 10;

const HEADER_FONT_SIZE = 15;
const TABLE_FONT_SIZE = 16;
const SHIP_FONT_SIZE = 18;

// 死因句子需要把「舰名」单独染成阵营色，用占位符切开模板
const SHIP_TOKEN = "\uE000";
const DEATH_TEXT_COLOR = "rgba(226,242,255,0.82)";
const DEATH_FONT_SIZE = 15;

type TextAlign = "left" | "center" | "right";
type Translate = (key: string, options?: Record<string, unknown>) => string;

type SortState = { kind: "default" } | { kind: "asc"; column: number } | { kind: "desc"; column: number };

interface RowWithScore {
  row: ShipBattleRecord;
  score: ScoreResult;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function shipLabel(name: string, nameKey: string | undefined, t: Translate): string {
  if (!nameKey) return name;
  const label = t(nameKey);
  return label && label !== nameKey ? label : name;
}

function makeShipCell(name: string, row: ShipBattleRecord, scoreResult: ScoreResult, t: Translate): Control {
  const panel = new StackPanel(name);
  panel.isVertical = false;
  panel.height = "100%";
  panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  panel.adaptWidthToChildren = true;

  const shipName = shipLabel(row.name, row.nameKey, t);
  const nameBlock = new TextBlock(`${name}_ship`, shipName);
  nameBlock.fontFamily = FONT_FAMILY;
  nameBlock.fontSize = SHIP_FONT_SIZE;
  nameBlock.fontWeight = "400";
  nameBlock.color = "#d9ecfa";
  nameBlock.resizeToFit = true;
  nameBlock.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_LEFT;
  nameBlock.textVerticalAlignment = TextBlock.VERTICAL_ALIGNMENT_CENTER;
  panel.addControl(nameBlock);

  if (scoreResult.label) {
    const labelContainer = new Rectangle(`${name}_labelContainer`);
    labelContainer.thickness = 1;
    labelContainer.color = scoreResult.color;
    labelContainer.background = "rgba(0,0,0,0)";
    labelContainer.cornerRadius = 4;
    labelContainer.adaptWidthToChildren = true;
    labelContainer.adaptHeightToChildren = true;
    labelContainer.paddingLeft = "6px";
    labelContainer.paddingRight = "6px";
    labelContainer.paddingTop = "2px";
    labelContainer.paddingBottom = "2px";

    const labelBlock = new TextBlock(`${name}_label`, scoreResult.label);
    labelBlock.fontFamily = FONT_FAMILY;
    labelBlock.fontSize = SHIP_FONT_SIZE;
    labelBlock.fontWeight = "700";
    labelBlock.fontStyle = "italic";
    labelBlock.color = scoreResult.color;
    labelBlock.resizeToFit = true;
    labelBlock.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_LEFT;
    labelBlock.textVerticalAlignment = TextBlock.VERTICAL_ALIGNMENT_CENTER;

    labelContainer.addControl(labelBlock);
    panel.addControl(labelContainer);
  }

  return panel;
}

/** 死因句子的一段：纯文本 + 颜色，舰名那一段会单独染色 */
interface DeathSegment {
  text: string;
  color: string;
  fontWeight: string;
}

function deathWeaponLabel(death: DeathInfo, t: Translate): string {
  return t(`deathCause.weapons.${death.weapon}`);
}

/** 按「敌友 + 远近」取模板，再把舰名占位符拆成单独一段 */
function makeDeathSegments(death: DeathInfo, shipName: string, t: Translate): DeathSegment[] {
  if (death.relation === "self") {
    return [
      {
        text: t("deathCause.lines.self", { weapon: deathWeaponLabel(death, t) }),
        color: DEATH_TEXT_COLOR,
        fontWeight: "400",
      },
    ];
  }

  const tone = `${death.relation}${death.tone === "far" ? "Far" : "Close"}`;
  const line = t(`deathCause.lines.${tone}.${death.variant}`, {
    adjective: t(`deathCause.adjectives.${tone}`),
    relation: t(`deathCause.relations.${death.relation}`),
    weapon: deathWeaponLabel(death, t),
    ship: SHIP_TOKEN,
  });
  const [before, after = ""] = line.split(SHIP_TOKEN);
  return [
    { text: before, color: DEATH_TEXT_COLOR, fontWeight: "400" },
    { text: shipName, color: MAP_TEAM_COLORS[death.killerTeam], fontWeight: "700" },
    { text: after, color: DEATH_TEXT_COLOR, fontWeight: "400" },
  ].filter((segment) => segment.text.length > 0);
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

/** 死因单元格：横向拼接多段文字，让舰名保持阵营色 */
function makeDeathCell(name: string, row: ShipBattleRecord, t: Translate): Control {
  if (!row.death) {
    return makeCell(name, t("deathCause.unknown"), DEATH_TEXT_COLOR, DEATH_FONT_SIZE, "400", "left");
  }

  const panel = new StackPanel(name);
  panel.isVertical = false;
  panel.height = "100%";
  panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  panel.adaptWidthToChildren = true;

  const shipName = shipLabel(row.death.killerName, row.death.killerNameKey, t);
  makeDeathSegments(row.death, shipName, t).forEach((segment, index) => {
    const block = new TextBlock(`${name}_part${index}`, segment.text);
    block.fontFamily = FONT_FAMILY;
    block.fontSize = DEATH_FONT_SIZE;
    block.fontWeight = segment.fontWeight;
    block.color = segment.color;
    block.resizeToFit = true;
    block.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_LEFT;
    block.textVerticalAlignment = TextBlock.VERTICAL_ALIGNMENT_CENTER;
    panel.addControl(block);
  });

  return panel;
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

function toggleSort(sort: SortState, column: number): SortState {
  if (sort.kind === "asc" && sort.column === column) return { kind: "desc", column };
  if (sort.kind === "desc" && sort.column === column) return { kind: "default" };
  return { kind: "asc", column };
}

function sortIndicator(sort: SortState, column: number): string {
  if (sort.kind === "default") return column === 4 ? "▼" : "";
  return sort.column === column ? (sort.kind === "asc" ? "▲" : "▼") : "";
}

function compareByColumn(a: RowWithScore, b: RowWithScore, column: number): number {
  switch (column) {
    case 0: {
      return a.row.team.localeCompare(b.row.team);
    }
    case 1: {
      return a.row.name.localeCompare(b.row.name);
    }
    case 2: {
      return a.row.survivalTime - b.row.survivalTime;
    }
    case 3: {
      return a.row.kills - b.row.kills;
    }
    case 4: {
      return a.score.score - b.score.score;
    }
    case 5: {
      return (b.row.alive ? 1 : 0) - (a.row.alive ? 1 : 0) || (a.row.death?.killerName ?? "").localeCompare(b.row.death?.killerName ?? "");
    }
    default: {
      return 0;
    }
  }
}

function sortRows(
  results: readonly ShipBattleRecord[],
  scoreResults: readonly ScoreResult[],
  sort: SortState,
): { results: ShipBattleRecord[]; scoreResults: ScoreResult[] } {
  const paired = results.map((row, index) => ({ row, score: scoreResults[index] }));
  if (sort.kind === "default") {
    paired.sort((a, b) => b.score.score - a.score.score || a.row.name.localeCompare(b.row.name));
  } else {
    const dir = sort.kind === "asc" ? 1 : -1;
    paired.sort((a, b) => dir * compareByColumn(a, b, sort.column) || a.row.name.localeCompare(b.row.name));
  }
  return {
    results: paired.map((p) => p.row),
    scoreResults: paired.map((p) => p.score),
  };
}

function makeSortableHeaderCell(
  name: string,
  text: string,
  color: string,
  fontSize: number,
  fontWeight: string,
  align: TextAlign,
  onClick: () => void,
): Control {
  const panel = new StackPanel(name);
  panel.isVertical = false;
  panel.width = "100%";
  panel.height = "100%";
  panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  panel.isPointerBlocker = true;
  panel.hoverCursor = "pointer";
  panel.onPointerUpObservable.add(() => onClick());

  const block = makeText(`${name}_text`, text, color, fontSize, fontWeight);
  block.width = "100%";
  block.height = "100%";
  alignText(block, align);
  panel.addControl(block);

  return panel;
}

function createResultsGrid(
  results: readonly ShipBattleRecord[],
  t: Translate,
  scoreResults: readonly ScoreResult[],
  sort: SortState,
  onHeaderClick: (column: number) => void,
): Grid {
  const { results: sortedResults, scoreResults: sortedScores } = sortRows(results, scoreResults, sort);
  const grid = new Grid("battleResultGrid");
  grid.width = "100%";
  grid.height = `${HEADER_ROW_HEIGHT + sortedResults.length * ROW_HEIGHT}px`;

  // 阵营 / 舰船 / 存活时间 / 杀敌数 / 积分 / 死亡原因
  for (const weight of [0.8, 1.2, 1.0, 0.7, 0.8, 3.0]) {
    grid.addColumnDefinition(weight);
  }
  grid.addRowDefinition(HEADER_ROW_HEIGHT, true);
  sortedResults.forEach(() => {
    grid.addRowDefinition(ROW_HEIGHT, true);
  });

  const headers = [
    t("battleRecord.team"),
    t("battleRecord.ship"),
    t("battleRecord.survival"),
    t("battleRecord.kills"),
    t("battleRecord.score"),
    t("battleRecord.deathReason"),
  ];
  headers.forEach((text, column) => {
    // 舰船 / 死亡原因两列正文左对齐，表头跟随
    const align: TextAlign = column === 1 || column === 5 ? "left" : "center";
    const indicator = sortIndicator(sort, column);
    const label = indicator ? `${text} ${indicator}` : text;
    const isSorted = (sort.kind === "asc" || sort.kind === "desc") && sort.column === column;
    const fontWeight = isSorted || (sort.kind === "default" && column === 4) ? "700" : "600";
    grid.addControl(
      makeSortableHeaderCell(`battleResultHeader_${column}`, label, "rgba(154,196,224,0.78)", HEADER_FONT_SIZE, fontWeight, align, () =>
        onHeaderClick(column),
      ),
      0,
      column,
    );
  });

  sortedResults.forEach((row, index) => {
    const rowIndex = index + 1;
    const teamColor = MAP_TEAM_COLORS[row.team];
    const team = t(row.team === "red" ? "battleRecord.teams.red" : "battleRecord.teams.blue");
    const scoreResult = sortedScores[index];
    const cells: [string, string, TextAlign, number][] = [
      [team, teamColor, "center", TABLE_FONT_SIZE],
      [shipLabel(row.name, row.nameKey, t), "#d9ecfa", "left", SHIP_FONT_SIZE],
      [formatDuration(row.survivalTime), "#d9ecfa", "center", TABLE_FONT_SIZE],
      [String(row.kills), row.kills > 0 ? "#fbbf24" : "#d9ecfa", "center", TABLE_FONT_SIZE],
      [String(scoreResult.score), scoreResult.color, "center", TABLE_FONT_SIZE + 1],
    ];
    cells.forEach(([text, color, align, fontSize], column) => {
      grid.addControl(makeCell(`battleResultCell_${index}_${column}`, text, color, fontSize, "400", align), rowIndex, column);
    });
    // 舰船名单元格：用 StackPanel 支持名 + MVP/SVP 标记分色
    grid.addControl(makeShipCell(`battleResultCell_${index}_1`, row, scoreResult, t), rowIndex, 1);
    grid.addControl(
      row.alive
        ? makeCell(`battleResultCell_${index}_5`, t("battleRecord.alive"), "#86efac", TABLE_FONT_SIZE, "400", "left")
        : makeDeathCell(`battleResultCell_${index}_5`, row, t),
      rowIndex,
      5,
    );
  });

  return grid;
}

export interface BattleResultProps {
  scene: Scene | null;
  open: boolean;
  title: string;
  titleColor?: string;
  subtitle?: string;
  winnerTeam: "red" | "blue" | null;
  results: readonly ShipBattleRecord[];
  onRestart: () => void;
}

/**
 * 战斗结算面板：使用 Babylon GUI 原生控件（全屏 ADT + Grid / StackPanel / Button），
 * 与游戏内 HUD、弹窗保持同一套视觉语言。
 */
export default function BattleResult({
  scene,
  open,
  title,
  titleColor = "#e6f2fb",
  subtitle = "",
  winnerTeam,
  results,
  onRestart,
}: BattleResultProps) {
  const { t } = useTranslation();
  const id = useId();
  const latestRef = useRef({ onRestart });
  const [sort, setSort] = useState<SortState>({ kind: "default" });
  const onHeaderClick = useCallback((column: number) => setSort((prev) => toggleSort(prev, column)), []);
  const backdropRef = useRef<Rectangle | null>(null);
  const panelRef = useRef<Rectangle | null>(null);
  const titleRef = useRef<TextBlock | null>(null);
  const subtitleRef = useRef<TextBlock | null>(null);
  const tableHostRef = useRef<Rectangle | null>(null);
  const restartLabelRef = useRef<TextBlock | null>(null);
  // 空表格只报一次错，避免面板重绘时刷屏
  const emptyTableLoggedRef = useRef(false);

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
    panel.setPadding("32px", "36px", "32px", "36px");
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
    if (!open) {
      emptyTableLoggedRef.current = false;
      return;
    }

    if (results.length === 0 && !emptyTableLoggedRef.current) {
      emptyTableLoggedRef.current = true;
      // oxlint-disable-next-line no-console
      console.error("[BattleResult] 战斗结束但没有任何舰船记录，结算表格为空", { title, subtitle });
    }

    if (titleRef.current) {
      titleRef.current.text = title;
      titleRef.current.color = titleColor;
    }
    if (subtitleRef.current) subtitleRef.current.text = subtitle;
    if (restartLabelRef.current) restartLabelRef.current.text = t("battleRecord.restart");

    const scoreInputs = results.map((row) => ({
      kills: row.kills,
      shellHitsDealt: row.shellHitsDealt,
      torpHitsDealt: row.torpHitsDealt,
      shellHitsTaken: row.shellHitsTaken,
      torpHitsTaken: row.torpHitsTaken,
      damageDealt: row.damageDealt,
      damageTaken: row.damageTaken,
      survivalTime: row.survivalTime,
      alive: row.alive,
      deathSpeedFactor: row.deathSpeedFactor,
      friendlyFireHits: row.friendlyFireHits,
      friendlyFireDamage: row.friendlyFireDamage,
      won: row.team === winnerTeam,
    }));
    const scores = scoreInputs.map((input) => computeScore(input));
    const scoreResults = rankScores(scores);

    tableHost.clearControls();
    tableHost.height = `${HEADER_ROW_HEIGHT + results.length * ROW_HEIGHT + TABLE_PADDING * 2}px`;
    tableHost.addControl(createResultsGrid(results, t, scoreResults, sort, onHeaderClick));
  }, [scene, open, title, titleColor, subtitle, winnerTeam, results, t, sort]);

  return null;
}
