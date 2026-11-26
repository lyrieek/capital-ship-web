// 弹药结构定义在 src/weapons
import type { Projectile } from "../weapons";
import type { ActionMode } from "./action/ActionMode";
import type { EvasionBehavior } from "./evasion";
// 舰种参数表：尺寸 / 血量 / 炮塔布局 / 鱼雷齐射数量
import type { ShipClassId } from "./ship-class";

export type { ShipClassId } from "./ship-class";

/**
 * 轴对齐边界（世界像素坐标）。
 * 由限制区（RestrictAreaImpl）实现并提供实时值，Ship 只持引用，
 * 运动 / 碰撞层通过 shipBounds() 取「限制区 ∩ 世界边界」后的有效范围。
 */
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// 右键下达的航行目标（世界像素坐标）
export interface SailOrder {
  x: number;
  y: number;
}

/**
 * 由运动层计算的一帧运动结果。动作逻辑不构造或提交这个结构；
 * 只有 locomotion 完成舵角、地形与边界处理后才会交给舰体应用。
 */
export interface ShipMotionStep {
  /** 本帧实际位移，而不是可任意指定的目标坐标 */
  dx: number;
  dy: number;
  /** 用于校验位移没有超过当前最大航速 */
  dt: number;
  /** 本帧运动层算出的朝向与速度，用于威胁预判 */
  angle: number;
  vx: number;
  vy: number;
  dir: 1 | -1;
}

/**
 * 进行中的鱼雷齐射队列。
 * 齐射间隔由舰船自己计时、逐发创建弹药；舰船沉没后队列随之消失，
 * 不会再出现「沉船后提前摆好的鱼雷陆续飞出去」。
 */
export interface TorpedoVolley {
  /** 已发射数量（决定下一发是精准弹还是散布弹） */
  fired: number;
  /** 还没打出去的数量 */
  remaining: number;
  /** 距下一发的剩余时间（秒） */
  timer: number;
  /** 齐射开始时锁定的瞄准点 */
  aimX: number;
  aimY: number;
}

export interface ShipConfig {
  // 舰种；缺省为鱼雷艇
  shipClass?: ShipClassId;
  // 出生 X 坐标，可选；只用于初始化，未设置时由 RestrictArea 摆放
  x?: number;
  // 出生 Y 坐标，可选；只用于初始化，未设置时由 RestrictArea 摆放
  y?: number;
  // 航向方向：1-右，-1-左，可选；未设置时由 RestrictArea 按阵营分配
  dir?: 1 | -1;
  // 舰船亮侧颜色，可选，缺省按阵营分配
  light?: string;
  // 舰船暗侧颜色，可选，缺省按阵营分配
  dark?: string;
  // 舰船名称
  name: string;
  // 舰船名称的 i18n key，未设置时回落到 name
  nameKey?: string;
  // 舰船所属阵营：red-红方，blue-蓝方
  team: "red" | "blue";
  // 基准Y坐标（用于规避和回正），可选，缺省等于 y
  baseY?: number;
  // 巡航速度系数（相对 P.moveSpeed）；缺省使用舰种参数
  cruiseFactor?: number;
  // 主炮冷却倍率；缺省使用舰种参数
  gunCooldownFactor?: number;
  // 行动模式速度倍率下限 / 上限；缺省 0.7 / 1.6
  speedMin?: number;
  speedMax?: number;
  // 速度倍率每秒变化量；缺省 1.2
  accelRate?: number;
  // 规避行为；缺省使用 DefaultEvasionBehavior，可按舰船类型替换
  evasionBehavior?: EvasionBehavior;
  // 行动模式；缺省按舰种创建
  actionMode?: ActionMode;
}

export interface Ship extends ShipConfig {
  // 坐标和姿态只读；运行时位置由 steering / 碰撞层更新，禁止行动逻辑直接赋值。
  readonly x: number;
  readonly y: number;
  // 舰种
  shipClass: ShipClassId;
  // 火炮数量（等于炮塔布局中的炮塔数）
  gunCount: number;
  // 鱼雷单轮齐射数量下限 / 上限（由舰种决定）
  torpedoSalvoMin: number;
  torpedoSalvoMax: number;
  // 航向方向：1-右，-1-左
  dir: 1 | -1;
  // 活动边界来源（限制区实例）；运行时实时读取，扩张自动生效；
  // null 表示不受限制区约束，仅受世界边界约束（缺省）
  bounds: Bounds | null;
  // 舰船亮侧颜色
  light: string;
  // 舰船暗侧颜色
  dark: string;
  // 基准Y坐标（用于规避和回正）
  baseY: number;
  // 当前航行指令；null 表示按行动模式自动行动
  order: SailOrder | null;
  // 当前行动模式锁定的目标；行动模式每帧维护，供开火逻辑复用
  target: Ship | null;
  // 行动模式实例（决策层），移动由 locomotion 统一执行
  actionMode: ActionMode;
  // 巡航速度系数（相对 P.moveSpeed）
  cruiseFactor: number;
  // 主炮冷却倍率：1 = 标准射速，2 = 冷却翻倍（射速 50%）
  gunCooldownFactor: number;
  // 当前速度倍率（相对巡航速度），由 locomotion 平滑逼近
  speedFactor: number;
  // 行动模式允许的速度倍率范围
  speedMin: number;
  speedMax: number;
  // 速度倍率每秒变化量
  accelRate: number;
  // 转向疲劳（转动意愿值）：实际转过 180° 累计到 1；
  // 疲劳越高，小幅航向修正越容易被忽略，避免来回摆；直线航行 / 减速会衰减
  turnFatigue: number;
  // 连续卡位时间（秒）：想走却几乎没有净位移时累计，触发脱困转向
  stuckT: number;
  // 当前生命值
  hp: number;
  // 受损后下一次产生烟雾的剩余时间
  smokeTimer: number;
  // 最大生命值
  maxHp: number;
  // 舰船长度
  len: number;
  // 舰船宽度
  wid: number;
  // 基准角度（朝向）
  readonly angle: number;
  /**
   * 舰船状态
   * normal-正常，dodge-规避（沿用旧命名以兼容 HUD/i18n），recover-回正
   */
  state: "normal" | "dodge" | "recover";
  // 状态计时器
  stateT: number;
  // 规避计时器
  evasionT: number;
  // 规避方向：1-上，-1-下
  evasionSide: 1 | -1;
  // 规避行为实现
  evasionBehavior: EvasionBehavior;
  // 本次规避的速度系数 / 持续时间 / 横向幅度
  evasionSpeedFactor: number;
  evasionDuration: number;
  evasionAmplitude: number;
  // X方向速度
  readonly vx: number;
  // Y方向速度
  readonly vy: number;
  // 主炮冷却时间
  gunCD: number;
  // 主炮射界模式：all-全部炮塔；aftOnly-只允许舰尾炮塔开火（鱼雷艇后撤时）
  gunMode: "all" | "aftOnly";
  // 鱼雷冷却时间
  torpCD: number;
  // 进行中的鱼雷齐射队列；由舰船逐发发射，船沉后自动作废
  torpVolley: TorpedoVolley | null;
  // 被击闪白效果
  hitFlash: number;
  // 后坐力效果（鱼雷 / 手动演示等整船级效果）
  recoil: number;
  // 每门炮自己的后坐力（0~1），逐门开火时只让开火的那门炮后坐
  turretRecoil: number[];
  // 主炮当前瞄准角度（朝向目标，平滑转向）
  aimAngle: number;
  // 手动指定的射击点：炮管先转向该点，对准后才开火；null 表示没有手动指令
  aimOrder: SailOrder | null;

  // 是否存活（hp>0）
  get alive(): boolean;
  // 查找最近的敌方舰船
  findTarget(): Ship | null;
  // 查找来袭威胁（炮弹/鱼雷）
  findThreat(): ThreatItem | null;
  // 开始规避机动
  startEvasion(th: ThreatItem): void;
  // 某门炮在舰体上的世界坐标：炮口从炮塔位置而非船心打出
  turretPosition(index: number): { x: number; y: number };
  // 更新舰船状态
  update(dt: number): void;
  // 受到伤害
  takeDamage(dmg: number): void;
}

/**
 * 仅运动层 / 碰撞层使用的可写能力。
 * GameState、ActionMode 和 UI 都只拿 Ship 只读视图，不暴露这些位移入口。
 */
export interface ShipMotionTarget extends Ship {
  /** 运动层提交已经积分、限界后的本帧位移，而不是任意目标 XY。 */
  applyMotionStep(step: ShipMotionStep): void;
  /** 碰撞求解器专用的位置修正，位移平分或来自地形推出。 */
  applyCollisionCorrection(dx: number, dy: number): void;
  /** 路点抵达后停止，不把舰船吸附到路点坐标。 */
  stopMotion(): void;
}

/**
 * 建船工厂的窄能力：只可在初始装配时指定一次出生位置，
 * 不包含运行时移动或碰撞修正接口。
 */
export interface SpawnableShip extends Ship {
  placeAtSpawn(x: number, y: number): void;
}

export interface ThreatItem {
  t: number;
  p: Projectile;
  miss: number;
}
