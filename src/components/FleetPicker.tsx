import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ShipEntry, getShipColors } from "../ship/ship-manager";
import { FLEET_SIZE, type FleetTeam } from "../game/fleet";

interface FleetPickerProps {
  team: FleetTeam;
  ships: readonly ShipEntry[];
  selected: readonly string[];
  otherSelected: readonly string[];
  onToggle: (id: string) => void;
}

/** 一个阵营的舰队选择 popover：按钮上显示当前 3 艘船，展开后可以增删 */
export default function FleetPicker({ team, ships, selected, otherSelected, onToggle }: FleetPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const byId = useMemo(() => new Map(ships.map((ship) => [ship.id, ship])), [ships]);
  const selectedShips = selected.map((id) => byId.get(id)).filter((ship): ship is ShipEntry => ship !== undefined);
  const full = selected.length >= FLEET_SIZE;
  const teamName = t(team === "red" ? "mapSelect.redFleet" : "mapSelect.blueFleet");
  const otherTeamName = t(team === "red" ? "mapSelect.blueFleet" : "mapSelect.redFleet");
  const popoverId = `fleet-popover-${team}`;

  const slots = Array.from({ length: FLEET_SIZE }, (_, index) => selectedShips[index]);
  const emptyCount = slots.filter((ship) => ship === undefined).length;

  return (
    <div className={`fleet-picker fleet-picker-${team}`} ref={rootRef}>
      <button
        type="button"
        className="fleet-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={popoverId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="fleet-trigger-head">
          <span className="fleet-team">{teamName}</span>
          <span className="fleet-count">
            {selected.length} / {FLEET_SIZE}
          </span>
        </span>
        <span className="fleet-chips">
          {slots.map((ship, index) =>
            ship ? (
              <span className="fleet-chip" key={ship.id}>
                <span className="fleet-chip-dot" style={{ backgroundColor: getShipColors(ship).light }} aria-hidden="true" />
                {ship.name}
              </span>
            ) : (
              <span className="fleet-chip fleet-chip-empty" key={`empty-${index}`} aria-hidden="true">
                {t("mapSelect.emptySlot")}
              </span>
            ),
          )}
        </span>
        <span className="fleet-trigger-hint">{emptyCount > 0 ? t("mapSelect.needMore", { count: emptyCount }) : t("mapSelect.fleetReadyShort")}</span>
      </button>

      {open ? (
        <div className="fleet-popover" id={popoverId} role="dialog" aria-label={teamName}>
          <header className="fleet-popover-head">
            <h4>{teamName}</h4>
            <p>{t("mapSelect.fleetPickerHint", { count: FLEET_SIZE })}</p>
          </header>

          {ships.length === 0 ? (
            <p className="fleet-popover-empty">{t("mapSelect.fleetNoShips")}</p>
          ) : (
            <ul className="fleet-options">
              {ships.map((ship) => {
                const inTeam = selected.includes(ship.id);
                const inOther = otherSelected.includes(ship.id);
                const disabled = !inTeam && full;
                const colors = getShipColors(ship);
                return (
                  <li key={ship.id}>
                    <button
                      type="button"
                      className={`fleet-option${inTeam ? " is-selected" : ""}${inOther ? " is-other" : ""}`}
                      aria-pressed={inTeam}
                      disabled={disabled}
                      title={inOther ? t("mapSelect.moveHere", { team: teamName }) : undefined}
                      onClick={() => onToggle(ship.id)}
                    >
                      <span
                        className="fleet-option-swatch"
                        style={{ background: `linear-gradient(135deg, ${colors.light} 0 50%, ${colors.dark} 50% 100%)` }}
                        aria-hidden="true"
                      />
                      <span className="fleet-option-name">{ship.name}</span>
                      <span className="fleet-option-class">{t(`ship.class.${ship.shipClass}`)}</span>
                      <span className="fleet-option-state">{inTeam ? "✓" : inOther ? t("mapSelect.inOther", { team: otherTeamName }) : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <footer className="fleet-popover-foot">
            {full ? t("mapSelect.fleetFull") : t("mapSelect.fleetPickerFoot", { count: FLEET_SIZE - selected.length })}
          </footer>
        </div>
      ) : null}
    </div>
  );
}
