// 行动限制区（游戏层实现）：在地图层 RestrictArea 的基础上加入可绘制、可校验的战场行为。
//
// 职责：
//   1. 画限制区虚线框；
//   2. 校验船是否越界、是否落在岛礁 / 建筑上；
//   3. 把边界写回舰船，供移动 clamp 使用；
//   4. 在限制区内自动摆船。
//
// 边界、阵营、出生点等静态数据由地图层 RestrictArea 统一校验并持有；
// 这里只保留运行期状态（enabled / 虚线框 / 地形占用判定）。
import { Color3, LinesMesh, VertexBuffer, VertexData, type Scene } from "@babylonjs/core";
import { H, W, clamp } from "./utils";
import { createShip } from "../ship/create-ship";
import { getTerrainField } from "../terrain";
import { MAP_TEAM_COLORS, type MapPoint, type MapZone } from "../map/types";
import { RestrictArea } from "../map/RestrictArea";
import type { Ship, ShipConfig } from "../ship/ship";

// 限制区虚线框与 HUD 同组
const RG_HUD = 2;
// 自动摆船最多尝试多少次随机点；超出仍未找到空位就报错
const SPAWN_TRIES = 24;
// 摆船净空：约等于半舰长（100 / 2）+ 余量，避免船头插进沙滩
const SPAWN_CLEARANCE = 60;

// 出生集结带：靠己方中线一侧，避免大地图开局双方隔屏相望；
// Y 轴收拢到地图中部，保证交战能被相机同时拍到。
const SPAWN_BAND_X = 650;
const SPAWN_BAND_Y = 720;

// ---- 限制区虚线样式 ----
// 虚线一格的总长度（实线 + 间隔）；密度按周长自动换算
const DASH_CYCLE = 60;
// 实线占一格的比例（4 / 7，接近原来的 dashSize:gapSize）
const DASH_RATIO = 4 / 7;
// 虚线沿边框缓慢流动的速度（世界像素 / 秒）
const DASH_FLOW_SPEED = 5;
// 边框透明度：比原先的 0.35 更淡，避免抢走舰船的画面焦点
const LINE_ALPHA = 0.2;
// 每条虚线折线的点数：起点 / 拐角 / 终点
const DASH_POINTS = 3;

// 默认的「不可放船」判定：查当前地物表。
// 独立成函数，playground 可以传入自己的判定而不改这里。
function defaultIsBlocked(x: number, y: number, radius: number): boolean {
  return getTerrainField()?.isBlockedCircle(x, y, radius) ?? false;
}

export class RestrictAreaImpl extends RestrictArea {
  /** 是否启用限制；取消后不再校验、也不再画框 */
  enabled: boolean;
  /** 限制区虚线框网格 */
  line: LinesMesh | null;
  /** 不可放船判定：以 (x, y) 为圆心、radius 为半径的圆是否压到陆地 */
  isBlocked: (x: number, y: number, radius: number) => boolean;

  /** 运行期可变的 X 轴边界（扩张后会变），初始等于原始 bounds */
  private curMinX: number;
  private curMaxX: number;

  /** 虚线顶点缓冲：固定 (虚线数 + 1) 条三点折线，只改坐标不重建网格 */
  private dashPositions: Float32Array | null = null;
  /** 预留的折线条数（其中一条用于跨接缝的虚线分段） */
  private dashLineCount = 0;
  /** 虚线容量：按世界最大周长预留，扩张时只增加实际使用条数 */
  private dashCount = 0;
  /** 相位用 0..1 的归一化值表示，扩张改变周长后无需换算 */
  private dashPhase = 0;

  constructor(zone: MapZone, enabled = true, isBlocked: (x: number, y: number, radius: number) => boolean = defaultIsBlocked) {
    super(zone);
    this.enabled = enabled;
    this.line = null;
    this.isBlocked = isBlocked;
    this.curMinX = this.bounds.minX;
    this.curMaxX = this.bounds.maxX;
  }

  get minX(): number {
    return this.curMinX;
  }

  get maxX(): number {
    return this.curMaxX;
  }

  get width(): number {
    return this.curMaxX - this.curMinX;
  }

  get center(): MapPoint {
    return { x: (this.curMinX + this.curMaxX) / 2, y: super.center.y };
  }

  /** 直接把 X 轴边界设为目标值；扩张由外部按进度插值，保证边界单调且不会抖动。 */
  setBoundsX(minX: number, maxX: number): void {
    if (maxX <= minX) return;
    this.curMinX = minX;
    this.curMaxX = maxX;
  }

  /** 恢复到地图原始边界（重开对局时用） */
  resetBounds(): void {
    this.curMinX = this.bounds.minX;
    this.curMaxX = this.bounds.maxX;
  }

  /** 当前周长随扩张实时变化，虚线的参数化必须基于它而不是初始尺寸 */
  private get perimeter(): number {
    return 2 * (this.width + this.height);
  }

  /** 判定点是否在运行期边界内（扩张后原 bounds 已不再是有效范围） */
  override contains(x: number, y: number): boolean {
    return x >= this.curMinX && x <= this.curMaxX && y >= this.minY && y <= this.maxY;
  }

  // 画限制区虚线框：颜色跟随阵营并带透明度。
  // 虚线顶点由 update 方法逐帧改写，这里只创建固定拓扑的网格。
  draw(scene: Scene): LinesMesh | null {
    if (!this.enabled) return null;
    if (this.line) return this.line;

    const w = this.width;
    const h = this.height;
    const perimeter = 2 * (w + h);
    if (perimeter <= 0) return null;
    // 虚线密度固定为约 60px 一格。初始按世界最大周长预留容量，
    // 扩张时只增加实际使用的条数（cycle 始终稳定，不会越拉越长）。
    const maxPerimeter = 2 * (W + H);
    const shortestSide = Math.max(1, Math.min(W, H));
    const byLength = Math.round(maxPerimeter / DASH_CYCLE);
    const bySide = Math.ceil(maxPerimeter / shortestSide);
    this.dashCount = clamp(Math.max(byLength, bySide), 4, 600);
    // 正常情况下每格一条折线；跨过周长接缝的那一条会拆成两段，所以多预留一条
    this.dashLineCount = this.dashCount + 1;
    this.dashPositions = new Float32Array(this.dashLineCount * DASH_POINTS * 3);

    const indices: number[] = [];
    for (let i = 0; i < this.dashLineCount; i++) {
      const base = i * DASH_POINTS;
      // 三点折线拆成两段：起点→拐角、拐角→终点
      indices.push(base, base + 1, base + 1, base + 2);
    }

    const data = new VertexData();
    data.positions = this.dashPositions;
    data.indices = indices;

    const line = new LinesMesh(`restrictArea_${this.id}`, scene);
    data.applyToMesh(line, true);
    line.renderingGroupId = RG_HUD;
    line.isPickable = false;
    // LinesMesh 自带 color / alpha，不必再挂 StandardMaterial
    line.color = Color3.FromHexString(MAP_TEAM_COLORS[this.team]);
    line.alpha = LINE_ALPHA;
    this.line = line;
    this.dashPhase = 0;
    this.writeDashPositions();
    return line;
  }

  /**
   * 每帧推进虚线相位。
   * 顶点缓冲的拓扑固定，只更新坐标，因此可以逐帧平滑移动而不用重建网格。
   */
  update(dt: number): void {
    if (!this.line || !this.dashPositions || this.dashCount <= 0) return;
    const perimeter = this.perimeter;
    if (perimeter <= 0) return;
    // 相位归一化到 0..1：周长变化时虚线的流动速度保持恒定像素/秒
    this.dashPhase = (this.dashPhase + (DASH_FLOW_SPEED * dt) / perimeter) % 1;
    this.writeDashPositions();
  }

  /** 按当前相位和当前周长重写所有虚线顶点 */
  private writeDashPositions(): void {
    const positions = this.dashPositions;
    const perimeter = this.perimeter;
    if (!positions || perimeter <= 0 || this.dashCount <= 0) return;

    // 按当前周长决定实际使用多少条虚线，保持每格约 60px 的观感
    const activeCount = clamp(Math.round(perimeter / DASH_CYCLE), 4, this.dashCount);
    const cycle = perimeter / activeCount;
    const dashLength = cycle * DASH_RATIO;
    let line = 0;
    for (let i = 0; i < activeCount; i++) {
      const start = ((this.dashPhase + i / activeCount) % 1) * perimeter;
      const end = start + dashLength;
      if (end > perimeter) {
        // 跨过周长接缝：拆成「接缝前」和「接缝后」两段，分别占用一条折线
        this.writeDashSegment(line, start, start, perimeter);
        this.writeDashSegment(line + 1, 0, 0, end - perimeter);
        line += 2;
        continue;
      }
      // 终点落在一条边内：中间点要么是拐角，要么退化成起点
      this.writeDashSegment(line, start, this.cornerBetween(start, end) ?? start, end);
      line += 1;
    }

    // 没用到的折线（包括拆段多出来的那条）写成退化线段，不产生可见像素
    for (; line < this.dashLineCount; line++) {
      this.writeDashSegment(line, 0, 0, 0);
    }

    this.line?.updateVerticesData(VertexBuffer.PositionKind, positions);
  }

  /** 把一条虚线（起点 / 拐角 / 终点）写进指定折线 */
  private writeDashSegment(line: number, start: number, corner: number, end: number): void {
    this.writeDashPoint(line, 0, start);
    this.writeDashPoint(line, 1, corner);
    this.writeDashPoint(line, 2, end);
  }

  /** 把周长上的参数 s 写到指定折线的指定顶点 */
  private writeDashPoint(line: number, point: number, s: number): void {
    const positions = this.dashPositions;
    if (!positions) return;

    const w = this.width;
    const h = this.height;
    const perimeter = this.perimeter;
    let t = s % perimeter;
    if (t < 0) t += perimeter;

    // 按顺时针方向依次经过 上 → 右 → 下 → 左边
    let x = 0;
    let y = 0;
    if (t <= w) {
      x = this.minX + t;
      y = this.minY;
    } else if (t <= w + h) {
      x = this.maxX;
      y = this.minY + (t - w);
    } else if (t <= w * 2 + h) {
      x = this.maxX - (t - w - h);
      y = this.maxY;
    } else {
      x = this.minX;
      y = this.maxY - (t - w * 2 - h);
    }

    // 与 worldToScene 相同：世界坐标（左上原点、Y 向下）→ 场景坐标（居中、Y 向上）
    const base = (line * DASH_POINTS + point) * 3;
    positions[base] = x - W / 2;
    positions[base + 1] = H / 2 - y;
    positions[base + 2] = 0;
  }

  /** 一段时间内是否跨过矩形拐角；跨过才需要插入中间点 */
  private cornerBetween(start: number, end: number): number | null {
    const w = this.width;
    const h = this.height;
    const c1 = w;
    const c2 = w + h;
    const c3 = w * 2 + h;
    if (c1 > start && c1 < end) return c1;
    if (c2 > start && c2 < end) return c2;
    if (c3 > start && c3 < end) return c3;
    return null;
  }

  // 校验船位置：越界或压在岛礁 / 建筑上时返回错误信息，由调用方决定如何提示。
  // 这里只查船心：航行中的贴岸由碰撞系统负责，用整条船判定会把正常贴岸误判成搁浅。
  validate(ship: Ship): string | null {
    if (!this.enabled) return null;
    if (!this.contains(ship.x, ship.y)) {
      return `[RestrictArea] 船 "${ship.name}" 位置 (${ship.x}, ${ship.y}) 超出限制区域 [${this.minX},${this.maxX}] x [${this.minY},${this.maxY}]`;
    }
    if (this.isBlocked(ship.x, ship.y, 0)) {
      return `[RestrictArea] 船 "${ship.name}" 位置 (${ship.x}, ${ship.y}) 落在岛礁 / 建筑上`;
    }
    return null;
  }

  // 把边界写回舰船，供移动逻辑 clamp
  applyTo(ship: Ship): void {
    if (!this.enabled) return;
    ship.minX = this.minX;
    ship.maxX = this.maxX;
  }

  // 在本队集结带内随机找一个不被地物占用的点。
  // 反复随机而不是「发现岛就挪开」，是因为集结带可能整片被占住，需要多次尝试确认。
  pickFreeSpot(): { x: number; y: number } | null {
    const band = Math.min(SPAWN_BAND_X, this.width);
    const bandY = Math.min(SPAWN_BAND_Y, this.height);
    const centerY = this.center.y;
    for (let i = 0; i < SPAWN_TRIES; i++) {
      const x = this.team === "red" ? this.maxX - Math.random() * band : this.minX + Math.random() * band;
      const y = centerY + (Math.random() - 0.5) * bandY;
      if (!this.isBlocked(x, y, SPAWN_CLEARANCE)) return { x, y };
    }
    return null;
  }

  // 在指定点附近随机找一个不被地物占用的点，用于让同一出生点出港的多艘船不完全重叠。
  private pickNear(x: number, y: number): { x: number; y: number } | null {
    const offset = 40;
    for (let i = 0; i < SPAWN_TRIES; i++) {
      const nx = x + (Math.random() - 0.5) * offset * 2;
      const ny = y + (Math.random() - 0.5) * offset * 2;
      if (!this.isBlocked(nx, ny, SPAWN_CLEARANCE)) return { x: nx, y: ny };
    }
    return null;
  }

  // 把出生点解析成可用的水面点：点本身可用就直接用；
  // 否则以出生点为圆心逐圈向外找最近的可用点。
  // 例如红方船厂坐标落在岛屿碰撞圈内，这里会把它推到船坞外侧的水面，
  // 而不是直接把船丢到随机集结带。找不到时返回 null。
  private resolveSpawn(spawn: MapPoint): { x: number; y: number } | null {
    if (this.contains(spawn.x, spawn.y) && !this.isBlocked(spawn.x, spawn.y, SPAWN_CLEARANCE)) {
      return { x: spawn.x, y: spawn.y };
    }
    const step = 30;
    const maxRadius = 500;
    for (let radius = step; radius <= maxRadius; radius += step) {
      const samples = Math.max(8, Math.round((2 * Math.PI * radius) / step));
      for (let i = 0; i < samples; i++) {
        const angle = (i / samples) * Math.PI * 2;
        const x = spawn.x + Math.cos(angle) * radius;
        const y = spawn.y + Math.sin(angle) * radius;
        if (this.contains(x, y) && !this.isBlocked(x, y, SPAWN_CLEARANCE)) return { x, y };
      }
    }
    return null;
  }

  // 自动在限制区内摆放一艘船：未指定的 x/y 默认在出生点附近分配，缺省朝向按阵营。
  createShip(cfg: ShipConfig): Ship {
    const ship = createShip(cfg);
    if (cfg.x === undefined || cfg.y === undefined) {
      // 优先使用地图指定的出生点：先解析成水面点，再在附近小幅随机避免多艘船完全重叠；
      // 两侧都失败时才退化到限制区集结带随机摆位。
      const anchor = this.resolveSpawn(this.getSpawnPoint());
      const spot = anchor ? (this.pickNear(anchor.x, anchor.y) ?? anchor) : this.pickFreeSpot();
      if (!spot) {
        throw new Error(`[RestrictArea] 队伍 "${this.team}" 在限制区内找不到不被地物占用的空位（尝试 ${SPAWN_TRIES} 次）`);
      }
      if (cfg.x === undefined) ship.x = spot.x;
      if (cfg.y === undefined) ship.y = spot.y;
    }
    if (cfg.dir === undefined) {
      ship.dir = this.team === "red" ? 1 : -1;
    }
    if (cfg.baseY === undefined) {
      ship.baseY = ship.y;
    }
    const error = this.validate(ship);
    if (error) throw new Error(error);
    this.applyTo(ship);
    return ship;
  }

  /** 取消限制：销毁虚线框，后续不再限制船位置 */
  cancel(): void {
    this.enabled = false;
    if (this.line) {
      this.line.dispose();
      this.line = null;
    }
    this.dashPositions = null;
  }

  dispose(): void {
    this.cancel();
  }
}
