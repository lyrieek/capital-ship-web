// 统一的舰船工厂函数：替代之前分散在 Game.ts（mkShip）和 TestShip.tsx（createShip）的两套建船逻辑。
// 阵营决定默认颜色；行动限制区不再由建船函数设置，而是由 RestrictArea 类在画船前统一管理。
// restrictArea 为 false 时可完全取消限制，缺省启用（由 RestrictArea 决定是否限制）。
import { ShipImpl } from "./index";
import type { Ship, ShipConfig } from "./ship";

// 按阵营的舰船亮/暗面颜色
const TEAM_COLORS: Record<"red" | "blue", { light: string; dark: string }> = {
  red: { light: "#ff7b6b", dark: "#b8322a" },
  blue: { light: "#7cc4ff", dark: "#1d5c9e" },
};

// 获取指定阵营的默认颜色
export function getTeamColors(team: "red" | "blue"): { light: string; dark: string } {
  return TEAM_COLORS[team];
}

// 统一建船：缺省按阵营分配颜色，minX/maxX 默认无限制，由 RestrictArea 后续统一设置
export function createShip(cfg: ShipConfig): Ship {
  const team = cfg.team;
  const colors = TEAM_COLORS[team];

  return new ShipImpl({
    ...cfg,
    team,
    baseY: cfg.baseY ?? cfg.y,
    light: cfg.light ?? colors.light,
    dark: cfg.dark ?? colors.dark,
  });
}
