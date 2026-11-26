import { type ChangeEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ShipEntry,
  type ShipManager,
  shipManager,
  COLOR_OFFSET_LIMIT,
  getBaseColors,
  getShipColors,
  shiftHue,
  toShipConfig,
} from "../ship/ship-manager";
import { SHIP_CLASS_IDS, getShipClassSpec, type ShipClassId, type ShipClassSpec } from "../ship/ship-class";

type TeamFilter = "all" | "none" | "red" | "blue";
type SortKey = "manual" | "name" | "shipClass" | "team" | "colorOffset";
type ImportMode = "replace" | "merge";
type Status = { kind: "info" | "error"; text: string } | null;

interface ShipListProps {
  manager?: ShipManager;
}

interface ShipTableProps {
  manager: ShipManager;
  ships: ShipEntry[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  sortKey: SortKey;
  specByClass: Record<ShipClassId, ShipClassSpec>;
}

interface ShipToolbarProps {
  manager: ShipManager;
  sortKey: SortKey;
  setSortKey: (key: SortKey) => void;
  classFilter: ShipClassId | "all";
  setClassFilter: (value: ShipClassId | "all") => void;
  teamFilter: TeamFilter;
  setTeamFilter: (value: TeamFilter) => void;
  importMode: ImportMode;
  setImportMode: (mode: ImportMode) => void;
  fileInput: RefObject<HTMLInputElement | null>;
  confirmClear: boolean;
  onAdd: () => void;
  onRandomize: () => void;
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}

const TEAM_RANK: Record<"none" | "red" | "blue", number> = { none: 0, red: 1, blue: 2 };
const CLASS_ORDER = new Map(SHIP_CLASS_IDS.map((id, index) => [id, index]));

/** 颜色滑杆的渐变色标：覆盖 -15° ~ +15° 的全部可选色相 */
const GRADIENT_STOPS = [-15, -10, -5, 0, 5, 10, 15];

function offsetGradient(baseHex: string): string {
  const stops = GRADIENT_STOPS.map((deg) => {
    const position = ((deg + COLOR_OFFSET_LIMIT) / (COLOR_OFFSET_LIMIT * 2)) * 100;
    return `${shiftHue(baseHex, deg)} ${position}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function formatOffset(offset: number): string {
  return `${offset > 0 ? "+" : ""}${offset}°`;
}

function teamLabel(team: ShipEntry["team"], translate: (key: string) => string): string {
  if (team === "red") return translate("ships.teamRed");
  if (team === "blue") return translate("ships.teamBlue");
  return translate("ships.teamNone");
}

function ShipNameInput({ ship, manager }: { ship: ShipEntry; manager: ShipManager }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(ship.name);

  useEffect(() => setDraft(ship.name), [ship.name]);

  const commit = () => {
    const next = draft.trim();
    if (!next) {
      setDraft(ship.name);
      return;
    }
    if (next !== ship.name) manager.update(ship.id, { name: next });
  };

  return (
    <input
      className="ship-name-input"
      value={draft}
      aria-label={t("ships.name")}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(ship.name);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ShipColorField({ ship, manager }: { ship: ShipEntry; manager: ShipManager }) {
  const { t } = useTranslation();
  const { light, dark } = getShipColors(ship);
  const baseLight = getBaseColors(ship.shipClass).light;

  return (
    <div className="ship-color-row">
      <span
        className="color-swatch color-swatch-duo"
        style={{ background: `linear-gradient(135deg, ${light} 0 50%, ${dark} 50% 100%)` }}
        aria-hidden="true"
      />
      <input
        className="ship-color-slider"
        type="range"
        min={-COLOR_OFFSET_LIMIT}
        max={COLOR_OFFSET_LIMIT}
        step={1}
        value={ship.colorOffset}
        aria-label={t("ships.color")}
        title={t("ships.colorRange", { min: -COLOR_OFFSET_LIMIT, max: COLOR_OFFSET_LIMIT })}
        style={{ background: offsetGradient(baseLight) }}
        onChange={(event) => manager.update(ship.id, { colorOffset: Number(event.target.value) })}
      />
      <span className="ship-offset">{formatOffset(ship.colorOffset)}</span>
    </div>
  );
}

function ShipRow({
  ship,
  manager,
  spec,
  selected,
  canMoveUp,
  canMoveDown,
  onSelect,
}: {
  ship: ShipEntry;
  manager: ShipManager;
  spec: ShipClassSpec;
  selected: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();

  const handleRemove = (event: React.MouseEvent) => {
    event.stopPropagation();
    manager.remove(ship.id);
  };

  const handleDuplicate = (event: React.MouseEvent) => {
    event.stopPropagation();
    const copy = manager.duplicate(ship.id);
    if (copy) onSelect(copy.id);
  };

  const handleMove = (event: React.MouseEvent, delta: number) => {
    event.stopPropagation();
    const index = manager.all().findIndex((entry) => entry.id === ship.id);
    if (index !== -1) manager.move(index, index + delta);
  };

  return (
    <tr
      className={selected ? "ship-row ship-row-selected" : "ship-row"}
      onClick={() => onSelect(ship.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(ship.id);
        }
      }}
      tabIndex={0}
      aria-selected={selected}
    >
      <td>
        <ShipNameInput ship={ship} manager={manager} />
      </td>
      <td>
        <select
          className="ship-select"
          value={ship.shipClass}
          aria-label={t("ships.class")}
          onChange={(event) => manager.update(ship.id, { shipClass: event.target.value as ShipClassId })}
        >
          {SHIP_CLASS_IDS.map((id) => (
            <option key={id} value={id}>
              {t(`ship.class.${id}`)}
            </option>
          ))}
        </select>
        <div className="ship-spec-hint">
          {spec.len} × {spec.wid} · HP {spec.maxHp} · {t("ships.guns")} {spec.turrets.length}
        </div>
      </td>
      <td>
        <ShipColorField ship={ship} manager={manager} />
      </td>
      <td>
        <span className={`team-dot team-${ship.team ?? "none"}`} aria-hidden="true" />
        <select
          className="ship-select"
          value={ship.team ?? "none"}
          aria-label={t("ships.team")}
          onChange={(event) =>
            manager.update(ship.id, {
              team: event.target.value === "none" ? null : (event.target.value as "red" | "blue"),
            })
          }
        >
          <option value="none">{t("ships.teamNone")}</option>
          <option value="red">{t("ships.teamRed")}</option>
          <option value="blue">{t("ships.teamBlue")}</option>
        </select>
      </td>
      <td className="ship-actions">
        <button type="button" className="ship-btn-small" onClick={(event) => handleMove(event, -1)} disabled={!canMoveUp} title={t("ships.moveUp")}>
          ▲
        </button>
        <button
          type="button"
          className="ship-btn-small"
          onClick={(event) => handleMove(event, 1)}
          disabled={!canMoveDown}
          title={t("ships.moveDown")}
        >
          ▼
        </button>
        <button type="button" className="ship-btn-small" onClick={handleDuplicate} title={t("ships.duplicate")}>
          ⧉
        </button>
        <button type="button" className="ship-btn-small ship-btn-danger" onClick={handleRemove} title={t("ships.remove")}>
          ✕
        </button>
      </td>
    </tr>
  );
}

function ShipTable({ manager, ships, selectedId, setSelectedId, sortKey, specByClass }: ShipTableProps) {
  const { t } = useTranslation();
  const manualOrder = sortKey === "manual";

  return (
    <div className="ship-table-wrap">
      <table className="ships">
        <thead>
          <tr>
            <th>{t("ships.name")}</th>
            <th>{t("ships.class")}</th>
            <th>{t("ships.color")}</th>
            <th>{t("ships.team")}</th>
            <th className="ship-actions-head">{t("ships.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {ships.map((ship) => {
            const index = manager.all().findIndex((entry) => entry.id === ship.id);
            return (
              <ShipRow
                key={ship.id}
                ship={ship}
                manager={manager}
                spec={specByClass[ship.shipClass]}
                selected={selectedId === ship.id}
                canMoveUp={manualOrder && index > 0}
                canMoveDown={manualOrder && index !== -1 && index < manager.count() - 1}
                onSelect={setSelectedId}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ShipToolbar({
  manager,
  sortKey,
  setSortKey,
  classFilter,
  setClassFilter,
  teamFilter,
  setTeamFilter,
  importMode,
  setImportMode,
  fileInput,
  confirmClear,
  onAdd,
  onRandomize,
  onExport,
  onImport,
  onClear,
}: ShipToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="ship-toolbar">
      <div className="ship-toolbar-group">
        <button type="button" className="ship-btn ship-btn-primary" onClick={onAdd}>
          {t("ships.add")}
        </button>
        <button type="button" className="ship-btn" onClick={onRandomize} disabled={manager.count() === 0}>
          {t("ships.randomize")}
        </button>
        <button type="button" className="ship-btn" onClick={onExport} disabled={manager.count() === 0}>
          {t("ships.export")}
        </button>
        <label className="ship-btn import-label">
          {t("ships.import")}
          <input type="file" accept=".json,application/json" ref={fileInput} onChange={onImport} hidden />
        </label>
        <select
          className="ship-select"
          value={importMode}
          aria-label={t("ships.importMode")}
          onChange={(event) => setImportMode(event.target.value as ImportMode)}
        >
          <option value="merge">{t("ships.importMerge")}</option>
          <option value="replace">{t("ships.importReplace")}</option>
        </select>
      </div>

      <div className="ship-toolbar-group">
        <select className="ship-select" value={sortKey} aria-label={t("ships.sort")} onChange={(event) => setSortKey(event.target.value as SortKey)}>
          <option value="manual">{t("ships.sortManual")}</option>
          <option value="name">{t("ships.sortName")}</option>
          <option value="shipClass">{t("ships.sortClass")}</option>
          <option value="team">{t("ships.sortTeam")}</option>
          <option value="colorOffset">{t("ships.sortColor")}</option>
        </select>
        <select
          className="ship-select"
          value={classFilter}
          aria-label={t("ships.filterClass")}
          onChange={(event) => setClassFilter(event.target.value as ShipClassId | "all")}
        >
          <option value="all">{t("ships.filterClass")}</option>
          {SHIP_CLASS_IDS.map((id) => (
            <option key={id} value={id}>
              {t(`ship.class.${id}`)}
            </option>
          ))}
        </select>
        <select
          className="ship-select"
          value={teamFilter}
          aria-label={t("ships.filterTeam")}
          onChange={(event) => setTeamFilter(event.target.value as TeamFilter)}
        >
          <option value="all">{t("ships.filterTeam")}</option>
          <option value="none">{t("ships.teamNone")}</option>
          <option value="red">{t("ships.teamRed")}</option>
          <option value="blue">{t("ships.teamBlue")}</option>
        </select>
      </div>

      <div className="ship-toolbar-group ship-toolbar-end">
        <button
          type="button"
          className={confirmClear ? "ship-btn ship-btn-danger ship-btn-confirming" : "ship-btn ship-btn-danger"}
          onClick={onClear}
          disabled={manager.count() === 0}
        >
          {confirmClear ? t("ships.clearConfirmShort") : t("ships.clear")}
        </button>
      </div>
    </div>
  );
}

function ShipPreview({ ship, onClose }: { ship: ShipEntry; onClose: () => void }) {
  const { t } = useTranslation();
  const spec = getShipClassSpec(ship.shipClass);
  const colors = getShipColors(ship);
  const config = toShipConfig(ship);

  return (
    <aside className="ship-preview">
      <header className="ship-preview-head">
        <div>
          <h3>{ship.name}</h3>
          <p>
            {t(`ship.class.${ship.shipClass}`)} · {teamLabel(config.team, t)}
          </p>
        </div>
        <div className="ship-preview-side">
          <div className="ship-preview-swatches">
            <span style={{ backgroundColor: colors.light }} title={t("ships.colorLight")} />
            <span style={{ backgroundColor: colors.dark }} title={t("ships.colorDark")} />
          </div>
          <button type="button" className="ship-btn-small" onClick={onClose} title={t("ships.close")}>
            ✕
          </button>
        </div>
      </header>

      <dl className="ship-preview-stats">
        <div>
          <dt>{t("ships.size")}</dt>
          <dd>
            {spec.len} × {spec.wid}
          </dd>
        </div>
        <div>
          <dt>{t("ships.hp")}</dt>
          <dd>{spec.maxHp}</dd>
        </div>
        <div>
          <dt>{t("ships.guns")}</dt>
          <dd>{spec.turrets.length}</dd>
        </div>
        <div>
          <dt>{t("ships.torpedoSalvo")}</dt>
          <dd>
            {spec.torpedoSalvoMin}–{spec.torpedoSalvoMax}
          </dd>
        </div>
        <div>
          <dt>{t("ships.speed")}</dt>
          <dd>×{spec.cruiseFactor.toFixed(2)}</dd>
        </div>
        <div>
          <dt>{t("ships.color")}</dt>
          <dd>{formatOffset(ship.colorOffset)}</dd>
        </div>
      </dl>

      <details className="ship-preview-json">
        <summary>{t("ships.rawConfig")}</summary>
        <pre>{JSON.stringify(config, null, 2)}</pre>
      </details>
    </aside>
  );
}

function downloadShipList(ships: ShipEntry[]): void {
  const json = JSON.stringify(ships, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "ships.json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function ShipList({ manager: injected }: ShipListProps) {
  const manager = injected ?? shipManager;
  const { t } = useTranslation();
  const [items, setItems] = useState<ShipEntry[]>(() => [...manager.ships]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("manual");
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("all");
  const [classFilter, setClassFilter] = useState<ShipClassId | "all">("all");
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [status, setStatus] = useState<Status>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => manager.subscribe(() => setItems([...manager.ships])), [manager]);

  useEffect(() => {
    if (!status) return;
    const timer = globalThis.setTimeout(() => setStatus(null), 4000);
    return () => globalThis.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = globalThis.setTimeout(() => setConfirmClear(false), 3500);
    return () => globalThis.clearTimeout(timer);
  }, [confirmClear]);

  const specByClass = useMemo(() => {
    const specs = {} as Record<ShipClassId, ShipClassSpec>;
    for (const id of SHIP_CLASS_IDS) specs[id] = getShipClassSpec(id);
    return specs;
  }, []);

  const visibleShips = useMemo(() => {
    const filtered = items.filter((ship) => {
      if (teamFilter !== "all" && (ship.team ?? "none") !== teamFilter) return false;
      if (classFilter !== "all" && ship.shipClass !== classFilter) return false;
      return true;
    });
    if (sortKey === "manual") return filtered;

    return filtered.toSorted((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "shipClass") return (CLASS_ORDER.get(a.shipClass) ?? 0) - (CLASS_ORDER.get(b.shipClass) ?? 0);
      if (sortKey === "team") return TEAM_RANK[a.team ?? "none"] - TEAM_RANK[b.team ?? "none"];
      return a.colorOffset - b.colorOffset;
    });
  }, [items, teamFilter, classFilter, sortKey]);

  const selected = selectedId ? manager.findById(selectedId) : undefined;
  const filteredCount = visibleShips.length;

  const handleAdd = useCallback(() => {
    const redCount = items.filter((ship) => ship.team === "red").length;
    const blueCount = items.filter((ship) => ship.team === "blue").length;
    const added = manager.add({ team: redCount <= blueCount ? "red" : "blue" });
    setSelectedId(added.id);
  }, [manager, items]);

  const handleRandomize = useCallback(() => {
    manager.randomizeAll();
    setStatus({ kind: "info", text: t("ships.randomized") });
  }, [manager, t]);

  const handleExport = useCallback(() => {
    downloadShipList(manager.export());
    setStatus({ kind: "info", text: t("ships.exportDone") });
  }, [manager, t]);

  const handleImport = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      file
        .text()
        .then((text) => {
          const parsed: unknown = JSON.parse(text);
          if (!Array.isArray(parsed)) throw new Error("invalid ship list");
          manager.import(parsed, importMode);
          setSelectedId(null);
          setStatus({ kind: "info", text: t("ships.importDone", { count: parsed.length }) });
        })
        .catch(() => setStatus({ kind: "error", text: t("ships.importInvalid") }));
    },
    [manager, importMode, t],
  );

  const handleClear = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    manager.clear();
    setSelectedId(null);
    setConfirmClear(false);
    setStatus({ kind: "info", text: t("ships.cleared") });
  }, [manager, confirmClear, t]);

  return (
    <section className="ship-list">
      <header className="ship-list-header">
        <div>
          <h2>{t("ships.title")}</h2>
          <p className="ship-list-subtitle">{t("ships.subtitle")}</p>
        </div>
        <p className="ship-list-count">{t("ships.count", { count: manager.count() })}</p>
      </header>

      <ShipToolbar
        manager={manager}
        sortKey={sortKey}
        setSortKey={setSortKey}
        classFilter={classFilter}
        setClassFilter={setClassFilter}
        teamFilter={teamFilter}
        setTeamFilter={setTeamFilter}
        importMode={importMode}
        setImportMode={setImportMode}
        fileInput={fileInput}
        confirmClear={confirmClear}
        onAdd={handleAdd}
        onRandomize={handleRandomize}
        onExport={handleExport}
        onImport={handleImport}
        onClear={handleClear}
      />

      <div className="ship-list-meta">
        <span>{t("ships.showing", { shown: filteredCount, total: manager.count() })}</span>
        {sortKey !== "manual" && <span className="ship-hint">{t("ships.moveOrderHint")}</span>}
        {status && (
          <span className={status.kind === "error" ? "ship-status ship-status-error" : "ship-status"} role="status">
            {status.text}
          </span>
        )}
      </div>

      <div className={selected ? "ship-list-body ship-list-body-selected" : "ship-list-body"}>
        {items.length === 0 ? (
          <p className="ship-list-empty">{t("ships.empty")}</p>
        ) : filteredCount === 0 ? (
          <p className="ship-list-empty">{t("ships.noMatch")}</p>
        ) : (
          <ShipTable
            manager={manager}
            ships={visibleShips}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            sortKey={sortKey}
            specByClass={specByClass}
          />
        )}

        {selected ? (
          <ShipPreview ship={selected} onClose={() => setSelectedId(null)} />
        ) : (
          <p className="ship-preview-empty">{t("ships.previewEmpty")}</p>
        )}
      </div>
    </section>
  );
}
