// 地图配置错误：地图数据不合法时在加载阶段直接抛出，避免坏数据进入游戏。
export class MapConfigError extends Error {
  /** 具体的逐条错误，便于日志与调试 */
  readonly errors: readonly string[];

  constructor(context: string, errors: readonly string[]) {
    super(`[MapConfig] ${context} 配置非法：\n${errors.map((error) => `- ${error}`).join("\n")}`);
    this.name = "MapConfigError";
    this.errors = errors;
  }
}
