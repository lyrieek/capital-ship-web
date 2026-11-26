import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { GameMap } from "../map";
import { getZoneSpawn, MAP_TEAM_COLORS } from "../map/types";
import { getTerrainSpec } from "../terrain/spec";
import type { TerrainPlacement } from "../terrain/layout";
import { WORLD_H, WORLD_W } from "../game/world";
import type { ShipEntry } from "../ship/ship-manager";
import { createFleetShips, FLEET_SCALE_ORDER, type FleetScale, type FleetSelection, type FleetShips, type FleetTeam } from "../game/fleet";
import FleetPicker from "./FleetPicker";
import { Slider } from "./Slider";

const GRID_STEPS_X = 8;
const GRID_STEPS_Y = 5;

export interface MapSelectProps {
  maps: readonly GameMap[];
  ships: readonly ShipEntry[];
  selection: FleetSelection;
  fleetScale: FleetScale;
  fleetSize: number;
  onFleetScaleChange: (scale: FleetScale) => void;
  onToggleShip: (team: FleetTeam, id: string) => void;
  onSelect: (map: GameMap, fleets: FleetShips) => void;
}

function MapTerrain({ terrain }: { terrain: readonly TerrainPlacement[] }) {
  return (
    <g>
      {terrain.map((placement, index) => {
        const spec = getTerrainSpec(placement.kind);
        const radius = spec.radius * (placement.scale ?? 1);
        const x = placement.u * WORLD_W;
        const y = placement.v * WORLD_H;
        if (placement.kind === "shipyard") {
          const rotation = ((placement.rotation ?? 0) * 180) / Math.PI;
          return (
            <rect
              key={`${placement.kind}-${index}`}
              x={x - radius * 0.3}
              y={y - radius * 0.85}
              width={radius * 1.2}
              height={radius * 1.7}
              rx={10}
              fill={spec.color}
              transform={`rotate(${rotation} ${x} ${y})`}
            />
          );
        }
        return (
          <circle
            key={`${placement.kind}-${index}`}
            cx={x}
            cy={y}
            r={radius}
            fill={spec.color}
            stroke="#e7d8ab"
            strokeWidth={placement.kind === "island" ? 10 : 0}
          />
        );
      })}
    </g>
  );
}

// 用 SVG 画一张示意图：地形、限制区和出生点都来自地图数据本身。
// 比例尺使用完整世界坐标，因此示意图与实际海图布局一致。
function MapPreview({ map }: { map: GameMap }) {
  const radial = `ocean-${map.id}`;

  return (
    <svg className="map-preview" viewBox={`0 0 ${WORLD_W} ${WORLD_H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <radialGradient id={radial} cx="50%" cy="48%" r="72%">
          <stop offset="0%" stopColor="#177d96" />
          <stop offset="100%" stopColor="#08303e" />
        </radialGradient>
      </defs>
      <rect width={WORLD_W} height={WORLD_H} fill={`url(#${radial})`} />
      <g stroke="rgba(190,235,255,0.12)" strokeWidth={6}>
        {Array.from({ length: GRID_STEPS_X - 1 }, (_, index) => (
          <line key={`v${index}`} x1={((index + 1) * WORLD_W) / GRID_STEPS_X} y1={0} x2={((index + 1) * WORLD_W) / GRID_STEPS_X} y2={WORLD_H} />
        ))}
        {Array.from({ length: GRID_STEPS_Y - 1 }, (_, index) => (
          <line key={`h${index}`} x1={0} y1={((index + 1) * WORLD_H) / GRID_STEPS_Y} x2={WORLD_W} y2={((index + 1) * WORLD_H) / GRID_STEPS_Y} />
        ))}
      </g>
      <MapTerrain terrain={map.terrain} />
      {map.zones.map((zone) => {
        const { minX, maxX, minY, maxY } = zone.bounds;
        const color = MAP_TEAM_COLORS[zone.team];
        const spawn = getZoneSpawn(zone);
        return (
          <g key={zone.id}>
            <rect
              x={minX}
              y={minY}
              width={maxX - minX}
              height={maxY - minY}
              fill={color}
              fillOpacity={0.09}
              stroke={color}
              strokeOpacity={0.85}
              strokeWidth={8}
              strokeDasharray="36 24"
            />
            <circle cx={spawn.x} cy={spawn.y} r={26} fill={color} stroke="#041a24" strokeWidth={8} />
          </g>
        );
      })}
    </svg>
  );
}

export default function MapSelect({ maps, ships, selection, fleetScale, fleetSize, onFleetScaleChange, onToggleShip, onSelect }: MapSelectProps) {
  const { t } = useTranslation();

  const ready = selection.red.length === fleetSize && selection.blue.length === fleetSize;
  const shortage = ships.length < fleetSize * 2;

  const startBattle = useCallback(
    (map: GameMap) => {
      if (!ready) return;
      onSelect(map, createFleetShips(ships, selection));
    },
    [onSelect, ready, selection, ships],
  );

  const statusText = shortage
    ? t("mapSelect.fleetShortage", { count: ships.length, need: fleetSize * 2 })
    : ready
      ? t("mapSelect.fleetReady", { count: fleetSize * 2 })
      : t("mapSelect.fleetIncomplete", { red: selection.red.length, blue: selection.blue.length, size: fleetSize });

  return (
    <section className="map-select">
      <header className="map-select-header">
        <h2>{t("mapSelect.title")}</h2>
        <p>{t("mapSelect.subtitle")}</p>
      </header>

      <section className="fleet-select" aria-label={t("mapSelect.fleetTitle")}>
        <header className="fleet-select-header">
          <h3>{t("mapSelect.fleetTitle")}</h3>
          <div className="fleet-scale">
            <span className="fleet-scale-label">{t("mapSelect.fleetScale")}</span>
            <Slider
              className="fleet-scale-slider"
              value={fleetScale}
              onChange={onFleetScaleChange}
              options={FLEET_SCALE_ORDER.map((scale) => ({
                value: scale,
                label: t(`mapSelect.fleetScales.${scale}`),
                ariaLabel: t(`mapSelect.fleetScales.${scale}`),
              }))}
              ariaLabel={t("mapSelect.fleetScale")}
            />
          </div>
          <p>{t("mapSelect.fleetSubtitle", { size: fleetSize })}</p>
        </header>
        <div className="fleet-select-row">
          <FleetPicker
            team="red"
            ships={ships}
            selected={selection.red}
            otherSelected={selection.blue}
            fleetSize={fleetSize}
            onToggle={(id) => onToggleShip("red", id)}
          />
          <span className="fleet-vs" aria-hidden="true">
            VS
          </span>
          <FleetPicker
            team="blue"
            ships={ships}
            selected={selection.blue}
            otherSelected={selection.red}
            fleetSize={fleetSize}
            onToggle={(id) => onToggleShip("blue", id)}
          />
        </div>
        <p className={ready ? "fleet-status is-ready" : "fleet-status is-warning"} role="status">
          {statusText}
        </p>
      </section>

      <div className="map-select-grid">
        {maps.map((map) => {
          const islandCount = map.terrain.filter((placement) => placement.kind === "island").length;
          const reefCount = map.terrain.filter((placement) => placement.kind === "reef").length;
          return (
            <article className="map-card" key={map.id}>
              <div className="map-card-preview">
                <MapPreview map={map} />
              </div>
              <div className="map-card-body">
                <h3>{t(map.nameKey)}</h3>
                <p className="map-card-description">{t(map.descriptionKey)}</p>
                <div className="map-card-stats">
                  <span>{t("mapSelect.islandCount", { count: islandCount })}</span>
                  <span>{t("mapSelect.reefCount", { count: reefCount })}</span>
                  <span>{t("mapSelect.zoneCount", { count: map.zones.length })}</span>
                </div>
                <button
                  type="button"
                  className="map-card-start"
                  onClick={() => startBattle(map)}
                  disabled={!ready}
                  title={ready ? undefined : statusText}
                >
                  {t("mapSelect.start")}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
