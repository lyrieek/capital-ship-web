import type { Ship, ShipConfig, SailOrder, ThreatItem, ShipClassId, TorpedoVolley, Bounds } from "./ship";
import { shipBounds } from "./bounds";
import { P, rand, clamp, angleDiff, approachAngle } from "../game/utils";
import { updateSailOrder } from "../game/movement";
import { getGameInstance } from "../game/Game";
// 武器参数集中在 src/weapons
import { getWeaponSpec, planTorpedoVolley, withinRange } from "../weapons";
// 舰种参数：尺寸 / 血量 / 炮塔布局 / 鱼雷齐射数量
import { getShipClassSpec } from "./ship-class";
// 地形场：鱼雷发射前检查航线是否被岛礁挡住
import { getTerrainField } from "../terrain";
// 规避行为抽象：不同舰船可替换不同的规避逻辑
import { DefaultEvasionBehavior, type EvasionBehavior } from "./evasion";
// 行动模式抽象 + 统一运动执行层
import { createDefaultActionMode, type ActionMode } from "./action";
import { driveShip } from "./locomotion";
export type { Ship, ShipConfig, SailOrder, ThreatItem, ShipClassId, TorpedoVolley, Bounds } from "./ship";
export { createShip, getTeamColors } from "./create-ship";
export { shipBounds } from "./bounds";

const CANNON = getWeaponSpec("shell");
const TORPEDO = getWeaponSpec("torp");

// 炮口与目标方向的夹角小于该值（约 3.4°）才允许开火
const AIM_TOLERANCE = 0.06;

// 鱼雷暂时不适合发射（友舰挡线 / 地形遮挡）时的重试间隔：
// 避免每帧都做一次航线采样，也不会像正常冷却那样等十几秒
const TORPEDO_RETRY_DELAY = 0.5;

// 多炮塔齐射时相邻两门炮的开火间隔（秒）：让每门炮依次开火，而不是同一帧全部打出
const GUN_SALVO_INTERVAL = 0.12;

// 规避时相对前进轴压的舵角：明显的转向（约 68°），既像真实躲雷，也能获得足够的横向脱离速度。
// 采用「船头对准真实航迹」的方式移动，避免横着平移的僵硬观感。
const EVASION_TURN = (68 * Math.PI) / 180;
// 规避航向的横向分量；速度按它补偿，保证按 evasion.ts 算出的横移量能在命中前走完
const EVASION_LATERAL = Math.sin(EVASION_TURN);

// 进行中的多炮塔齐射队列：舰船逐门开火，炮塔各自后坐
interface GunVolley {
  /** 下一门要开火的炮塔下标 */
  next: number;
  /** 还没打出去的炮塔数量 */
  remaining: number;
  /** 距下一门炮开火的剩余时间（秒） */
  timer: number;
  /** 齐射开始时锁定的瞄准点（目标中途死亡时继续朝这里打） */
  aimX: number;
  aimY: number;
  /** 自动交战目标；null 表示手动指定点 */
  target: Ship | null;
}

export class ShipImpl implements Ship {
  x: number;
  y: number;
  bounds: Bounds | null;
  dir: 1 | -1;
  hp: number;
  maxHp: number;
  len: number;
  wid: number;
  light: string;
  dark: string;
  name: string;
  nameKey?: string;
  team: "red" | "blue";
  shipClass: ShipClassId;
  gunCount: number;
  torpedoSalvoMin: number;
  torpedoSalvoMax: number;
  baseY: number;
  order: SailOrder | null;
  target: Ship | null;
  actionMode: ActionMode;

  cruiseFactor: number;
  speedFactor: number;
  speedMin: number;
  speedMax: number;
  accelRate: number;
  turnFatigue: number;
  stuckT: number;

  baseAngle: number;
  angle: number;
  state: "normal" | "dodge" | "recover";
  stateT: number;
  evasionT: number;
  evasionSide: 1 | -1;
  vx: number;
  vy: number;
  gunCD: number;
  torpCD: number;
  torpVolley: TorpedoVolley | null;
  turretRecoil: number[];
  // 进行中的多炮塔齐射；舰船沉没后 update 不再执行，队列自然作废
  private gunVolley: GunVolley | null;
  hitFlash: number;
  smokeTimer: number;
  recoil: number;
  aimAngle: number;
  aimOrder: SailOrder | null;

  // 规避行为（可按舰船类型替换）与本次规避的参数
  evasionBehavior: EvasionBehavior;
  evasionSpeedFactor: number;
  evasionDuration: number;
  evasionAmplitude: number;

  constructor(cfg: ShipConfig) {
    const spec = getShipClassSpec(cfg.shipClass ?? "torpedoBoat");

    this.x = cfg.x ?? 0;
    this.y = cfg.y ?? 0;
    // 活动边界由 RestrictArea 通过 ship.bounds 绑定；缺省 null 表示不受限制区约束，仅受世界边界约束
    this.bounds = null;
    this.dir = cfg.dir ?? 1;
    this.hp = spec.maxHp;
    this.maxHp = spec.maxHp;
    this.len = spec.len;
    this.wid = spec.wid;
    this.light = cfg.light ?? "#ffffff";
    this.dark = cfg.dark ?? "#666666";
    this.name = cfg.name;
    this.nameKey = cfg.nameKey;
    this.team = cfg.team;
    this.shipClass = spec.id;
    this.gunCount = spec.turrets.length;
    this.torpedoSalvoMin = spec.torpedoSalvoMin;
    this.torpedoSalvoMax = spec.torpedoSalvoMax;
    this.baseY = cfg.baseY ?? cfg.y ?? 0;
    this.order = null;
    this.target = null;
    this.actionMode = cfg.actionMode ?? createDefaultActionMode(this.shipClass);

    this.cruiseFactor = cfg.cruiseFactor ?? spec.cruiseFactor;
    this.speedFactor = 1;
    this.speedMin = cfg.speedMin ?? 0.7;
    this.speedMax = cfg.speedMax ?? 1.6;
    this.accelRate = cfg.accelRate ?? 1.2;
    this.turnFatigue = 0;
    this.stuckT = 0;

    this.baseAngle = this.dir > 0 ? 0 : Math.PI;
    this.angle = this.baseAngle;

    this.state = "normal";
    this.stateT = 0;
    this.evasionT = 0;
    this.evasionSide = 1;

    this.vx = 0;
    this.vy = 0;

    this.gunCD = rand(CANNON.initialCooldownMin, CANNON.initialCooldownMax);
    this.torpCD = rand(TORPEDO.initialCooldownMin, TORPEDO.initialCooldownMax);
    this.torpVolley = null;
    this.turretRecoil = Array.from({ length: this.gunCount }, () => 0);
    this.gunVolley = null;
    this.hitFlash = 0;
    this.smokeTimer = 0;
    this.recoil = 0;
    this.aimAngle = this.baseAngle;
    this.aimOrder = null;

    this.evasionBehavior = cfg.evasionBehavior ?? new DefaultEvasionBehavior();
    this.evasionSpeedFactor = 0.65;
    this.evasionDuration = 0.85;
    this.evasionAmplitude = 42;
  }

  get alive() {
    // 是否存活（生命值大于0）
    return this.hp > 0;
  }

  findTarget() {
    // 查找最近的敌方舰船（同阵营或已死亡的舰船不考虑）
    const game = getGameInstance();
    if (!game) return null;
    let best: Ship | null = null,
      bestD = Infinity;
    for (const s of game.ships) {
      if (s.team === this.team || s.hp <= 0) continue;
      const d = (s.x - this.x) ** 2 + (s.y - this.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }
  findThreat() {
    // 查找来袭威胁（只有鱼雷算威胁：炮弹速度慢、散布大，躲它没有意义）
    const game = getGameInstance();
    if (!game) return null;
    let best: ThreatItem | null = null;
    for (const p of game.projectiles) {
      // 跳过自身发射的弹药
      if (p.owner === this) continue;
      // 只有仍在正常飞行的鱼雷才需要规避；正在淡出的鱼雷已经不会造成伤害
      if (p.kind !== "torpedo" || p.fade !== undefined) continue;

      const rx = this.x - p.x,
        ry = this.y - p.y;
      const rvx = this.vx - p.vx,
        rvy = this.vy - p.vy;
      const vv = rvx * rvx + rvy * rvy;
      // 相对速度太小，不构成威胁
      if (vv < 100) continue;

      // 时间到最近接近点
      const t = -(rx * rvx + ry * rvy) / vv;
      // 只考虑未来2.2秒内的威胁
      if (t < 0 || t > 2.2) continue;

      // 最近接近点相对坐标
      const cx = rx + rvx * t,
        cy = ry + rvy * t;
      // 未击中距离
      const miss = Math.hypot(cx, cy);
      // 鱼雷危险半径
      const danger = getWeaponSpec(p.type).dangerRadius;

      if (miss < danger && (!best || t < best.t)) best = { t, p, miss };
    }
    return best;
  }

  startEvasion(th: ThreatItem): void {
    // 委托给规避行为决定向哪一侧机动，并携带本次规避的速度/时长/幅度
    const plan = this.evasionBehavior.decide(this, th);
    if (!plan) return;
    this.evasionSide = plan.side;
    this.evasionSpeedFactor = plan.speedFactor;
    this.evasionDuration = plan.duration;
    this.evasionAmplitude = plan.amplitude;
    this.state = "dodge";
    this.evasionT = 0;
    this.stateT = 0;
    // 规避优先：立刻中止还没打完的炮塔齐射，集中精力躲雷（已出膛的炮弹不受影响）
    this.gunVolley = null;
  }

  update(dt: number) {
    // 更新舰船状态（每帧调用）
    if (!this.alive) return;

    // 减少闪白和后坐力效果
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    for (let i = 0; i < this.turretRecoil.length; i++) {
      this.turretRecoil[i] = Math.max(0, this.turretRecoil[i] - dt * 6);
    }
    if (this.hp < this.maxHp) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        getGameInstance()?.smoke(this.x, this.y);
        this.smokeTimer = this.hp / this.maxHp < 0.3 ? 0.22 : this.hp / this.maxHp < 0.6 ? 0.4 : 0.75;
      }
    }
    this.stateT += dt;

    // 鱼雷齐射队列：分时发射由舰船自己计时；船沉后 update 不再执行，队列自然作废
    this.updateTorpedoVolley(dt);
    // 多炮塔齐射队列：逐门开火
    this.updateGunVolley(dt);

    // 控制优先级：手动航行指令 > 鱼雷规避 > 行动模式 > 默认巡航
    if (!updateSailOrder(this, dt)) {
      if (this.state === "normal") {
        // 先做安全层检测；有鱼雷威胁时本帧交给规避，下一帧执行规避机动
        const threat = this.findThreat();
        if (threat) {
          this.startEvasion(threat);
        } else {
          // 行动模式只输出意图，转向 / 加减速 / 地形避让由 locomotion 统一执行；
          // useTurnFatigue 让 AI 不要每帧追着小幅航向修正来回摆。
          const intent = this.actionMode.update(this, dt);
          driveShip(this, intent.heading, intent.speedFactor, dt, { bounce: true, useTurnFatigue: true });
          // 规避锚点跟随当前航向和位置，兼容尚未重做的横向规避逻辑
          this.baseY = this.y;
          this.baseAngle = this.angle;
        }
      } else if (this.state === "dodge") {
        // 规避状态：向安全一侧压一个明显的舵角，边转向边全速脱离鱼雷航线。
        // 幅度 / 速度由 EvasionBehavior 自适应给出；船头始终对准真实航迹，
        // 不再横着平移，看起来像一次真正的急转脱离。
        const px = this.x;
        const py = this.y;
        const bounds = shipBounds(this);
        const targetY = clamp(this.baseY + this.evasionSide * this.evasionAmplitude, bounds.minY, bounds.maxY);
        const remainY = targetY - this.y;
        // 世界坐标航向：X 分量跟随前进方向，Y 分量指向规避侧，两者合成明确的斜向脱离角。
        // 横移到位后转回水平航向（对应横向模型里的鱼雷航向），保持 Y 不再漂移。
        const forward = this.dir > 0 ? 0 : Math.PI;
        const heading = Math.abs(remainY) > 0.5 ? Math.atan2(this.evasionSide * Math.sin(EVASION_TURN), this.dir * Math.cos(EVASION_TURN)) : forward;
        this.angle = approachAngle(this.angle, heading, P.turnRate * dt);

        // 横向分量只有 sin(EVASION_TURN)，按此补偿总速度，确保实际横移量达到 plan.amplitude
        const step = (P.moveSpeed * this.evasionSpeedFactor * dt) / EVASION_LATERAL;
        this.x += Math.cos(this.angle) * step;
        this.y += Math.sin(this.angle) * step;
        // 左右越界反弹并更新 dir / baseAngle；上下只做夹取
        if (this.x < bounds.minX) {
          this.x = bounds.minX;
          this.dir = 1;
          this.baseAngle = 0;
        } else if (this.x > bounds.maxX) {
          this.x = bounds.maxX;
          this.dir = -1;
          this.baseAngle = Math.PI;
        }
        this.y = clamp(this.y, bounds.minY, bounds.maxY);

        this.evasionT += dt;
        // 规避时间到但鱼雷仍在来袭，继续规避，避免过早回正撞上雷
        if (this.evasionT >= this.evasionDuration && !this.findThreat()) {
          this.state = "recover";
          this.stateT = 0;
        }

        // 由实际位移反推速度，保证威胁预判读到真实航速
        if (dt > 0) {
          this.vx = (this.x - px) / dt;
          this.vy = (this.y - py) / dt;
        }
      } else {
        // 回正状态：缓慢转回基准角度并返回基准航线
        const rotStep = P.turnRate * dt;
        this.angle = approachAngle(this.angle, this.baseAngle, rotStep);

        const dy = this.baseY - this.y;
        const step = P.moveSpeed * P.normalFactor * dt;
        if (Math.abs(dy) <= step) this.y = this.baseY;
        else this.y += Math.sign(dy) * step;

        // 回正途中若又有鱼雷来袭，重新规避，避免回到基准航线时正好撞上雷
        const threat = this.findThreat();
        if (threat) {
          this.startEvasion(threat);
        } else {
          const angDone = Math.abs(angleDiff(this.angle, this.baseAngle)) < 0.02;
          const posDone = Math.abs(this.y - this.baseY) < 0.5;
          if (angDone && posDone && this.stateT > 0.35) {
            this.state = "normal";
            this.angle = this.baseAngle;
            this.y = this.baseY;
          }
        }

        const speed = P.moveSpeed * P.normalFactor;
        this.moveForward(speed * dt);
        this.vx = this.dir * speed;
        const remain = this.baseY - this.y;
        this.vy = Math.abs(remain) > 1 ? Math.sign(remain) * speed : 0;
      }
    }

    // 处理武器发射
    this.updateWeapons(dt);
  }

  // 沿当前 dir 前进并处理左右边界反弹（回正阶段沿用 X 轴运动；规避阶段已改为按船头航向位移）
  private moveForward(distance: number): void {
    const bounds = shipBounds(this);
    this.x += this.dir * distance;
    if (this.x < bounds.minX) {
      this.x = bounds.minX;
      this.dir = 1;
      this.baseAngle = 0;
    }
    if (this.x > bounds.maxX) {
      this.x = bounds.maxX;
      this.dir = -1;
      this.baseAngle = Math.PI;
    }
    this.y = clamp(this.y, bounds.minY, bounds.maxY);
  }

  // 炮管对准指定角度才算瞄准完成
  private isAimedAt(aim: number): boolean {
    return Math.abs(angleDiff(this.aimAngle, aim)) <= AIM_TOLERANCE;
  }

  // 炮管以固定转速转向目标，不会瞬间跳转
  private turnTurretToward(aim: number, dt: number, rateScale = 1): void {
    this.aimAngle = approachAngle(this.aimAngle, aim, P.turretTurnRate * dt * rateScale);
  }

  // 手动指定点：所有炮都对准后才开火；冷却中则保持瞄准继续等待
  private fireManualVolley(point: SailOrder): void {
    if (this.gunCD > 0 && this.torpCD > 0) return;

    if (!getGameInstance()) return;

    let fired = false;
    if (this.gunCD <= 0) {
      this.gunCD = rand(CANNON.cooldownMin, CANNON.cooldownMax);
      // 多炮塔逐门开火：先打第一门，其余由齐射队列按间隔依次打出
      this.startGunVolley(null, point.x, point.y);
      fired = true;
    }
    if (this.torpCD <= 0) {
      this.torpCD = rand(TORPEDO.cooldownMin, TORPEDO.cooldownMax);
      // 手动指定点：先按本舰种的齐射数量决定发数，再由舰船分时逐发打出
      this.startTorpedoVolley(point.x, point.y, this.rollTorpedoSalvo());
      fired = true;
    }
    if (fired) {
      this.aimOrder = null;
    }
  }

  // 自动交战：炮管先慢慢转向最近目标，对准并且在射程内才开火
  private fireAtTarget(target: Ship, aim: number): void {
    if (!this.isAimedAt(aim)) return;

    const game = getGameInstance();
    if (!game) return;

    if (this.gunCD <= 0 && withinRange(this, target, CANNON.range)) {
      this.gunCD = rand(CANNON.cooldownMin, CANNON.cooldownMax);
      // 多炮塔逐门开火：第一门立即开火，后续炮塔按间隔依次跟上
      this.startGunVolley(target, target.x, target.y);
    }
    if (this.torpCD <= 0 && withinRange(this, target, TORPEDO.range)) {
      // 先规划齐射：目标横船时按本舰种的完整数量打，否则只打最低 3 枚；
      // 航线附近有友舰或会被岛礁挡住时直接放弃这一轮。
      const plan = planTorpedoVolley({
        shooter: this,
        target,
        ships: game.ships,
        field: getTerrainField(),
        spec: { ...TORPEDO, salvoMin: this.torpedoSalvoMin, salvoMax: this.torpedoSalvoMax },
      });
      if (plan) {
        this.torpCD = rand(TORPEDO.cooldownMin, TORPEDO.cooldownMax);
        this.startTorpedoVolley(plan.aim.x, plan.aim.y, plan.salvo);
        this.recoil = 1;
      } else {
        // 暂时打不了：短冷却后重新评估，不要每帧重复做航线检测
        this.torpCD = TORPEDO_RETRY_DELAY;
      }
    }
  }

  // 按本舰种的齐射区间掷一次鱼雷齐射数量
  private rollTorpedoSalvo(): number {
    const span = this.torpedoSalvoMax - this.torpedoSalvoMin;
    return this.torpedoSalvoMin + Math.floor(Math.random() * (span + 1));
  }

  /** 某门炮在舰体上的世界坐标：炮口从炮塔位置而非船心打出 */
  private turretPosition(index: number): { x: number; y: number } {
    const mount = getShipClassSpec(this.shipClass).turrets[index];
    const offset = (mount?.offsetRatio ?? 0) * this.len;
    return {
      x: this.x + Math.cos(this.angle) * offset,
      y: this.y + Math.sin(this.angle) * offset,
    };
  }

  /**
   * 开始一轮多炮塔齐射：第一门立即开火，其余炮塔按 GUN_SALVO_INTERVAL 逐门发射。
   * target 为 null 时朝锁定坐标点射击（手动指令）。
   */
  private startGunVolley(target: Ship | null, x: number, y: number): void {
    if (this.gunCount <= 0) return;
    this.fireGun(0, target, x, y);
    const remaining = this.gunCount - 1;
    this.gunVolley = remaining > 0 ? { next: 1, remaining, timer: GUN_SALVO_INTERVAL, aimX: x, aimY: y, target } : null;
  }

  // 推进多炮塔齐射队列：每门炮单独开火，并只让对应的炮塔后坐
  private updateGunVolley(dt: number): void {
    const volley = this.gunVolley;
    if (!volley) return;

    volley.timer -= dt;
    if (volley.timer > 0) return;

    if (!getGameInstance()) {
      this.gunVolley = null;
      return;
    }

    // 目标仍存活时每门炮都按最新目标位置开火；目标已沉没则继续打最后锁定的海面点
    const target = volley.target?.alive ? volley.target : null;
    if (target) {
      volley.aimX = target.x;
      volley.aimY = target.y;
    }

    this.fireGun(volley.next, target, volley.aimX, volley.aimY);
    volley.next += 1;
    volley.remaining -= 1;
    volley.timer += GUN_SALVO_INTERVAL;
    if (volley.remaining <= 0) this.gunVolley = null;
  }

  // 打出一门炮
  private fireGun(index: number, target: Ship | null, x: number, y: number): void {
    const game = getGameInstance();
    if (!game) return;

    const from = this.turretPosition(index);
    if (target) game.fireShell(this, target, from);
    else game.fireShellAt(this, x, y, from);

    if (index < this.turretRecoil.length) this.turretRecoil[index] = 1;
  }

  /**
   * 开始一轮鱼雷齐射：立刻打出第一发，其余按 salvoInterval 由舰船自己计时逐发发射。
   * 队列挂在舰船上，舰船沉没后 update 不再执行，剩余鱼雷自然取消。
   */
  private startTorpedoVolley(x: number, y: number, salvo: number): void {
    const game = getGameInstance();
    if (!game || salvo <= 0) return;
    game.fireTorpedoAt(this, x, y, 0);
    const remaining = salvo - 1;
    this.torpVolley = remaining > 0 ? { fired: 1, remaining, timer: Math.max(0.05, TORPEDO.salvoInterval), aimX: x, aimY: y } : null;
  }

  // 推进鱼雷齐射队列；每帧最多打出一发，避免 dt 抖动时一帧连发
  private updateTorpedoVolley(dt: number): void {
    const volley = this.torpVolley;
    if (!volley) return;

    volley.timer -= dt;
    if (volley.timer > 0) return;

    const game = getGameInstance();
    if (!game) {
      this.torpVolley = null;
      return;
    }

    game.fireTorpedoAt(this, volley.aimX, volley.aimY, volley.fired);
    volley.fired += 1;
    volley.remaining -= 1;
    volley.timer += Math.max(0.05, TORPEDO.salvoInterval);
    this.recoil = 1;
    if (volley.remaining <= 0) this.torpVolley = null;
  }

  private updateWeapons(dt: number): void {
    const rate = this.state === "normal" ? 1 : P.firePenalty;
    this.gunCD -= dt * rate;
    this.torpCD -= dt * rate;

    // 规避机动期间暂停开火：先集中精力躲雷，机动结束（recover）立刻恢复交战，
    // 避免出现「鱼雷都到眼前了还在横着船对射」的观感。
    if (this.state === "dodge") return;

    // 手动射击指令优先于自动交战
    if (this.aimOrder) {
      const order = this.aimOrder;
      const aim = Math.atan2(order.y - this.y, order.x - this.x);
      this.turnTurretToward(aim, dt);
      if (this.isAimedAt(aim)) this.fireManualVolley(order);
      return;
    }

    // 优先打行动模式锁定的目标；目标死亡 / 不存在时再找最近的敌人
    // TODO(横向射界): 主炮开火前应校验目标相对船头在 60°~120° 的横向射界内，
    // 让「横船」真正影响输出；当前仍只按炮口对准 + 射程判定。
    const target = this.target?.alive ? this.target : this.findTarget();
    if (!target) {
      // 没有目标时炮口慢慢转回航向
      this.turnTurretToward(this.baseAngle, dt, 0.5);
      return;
    }

    const aim = Math.atan2(target.y - this.y, target.x - this.x);
    this.turnTurretToward(aim, dt);
    this.fireAtTarget(target, aim);
  }

  takeDamage(dmg: number): void {
    // 受到伤害处理
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.hitFlash = 1;
    if (this.hp <= 0) {
      // 沉船时立刻作废还没打出去的鱼雷 / 炮弹齐射，避免沉船后仍在开火
      this.torpVolley = null;
      this.gunVolley = null;
      const game = getGameInstance();
      if (game) {
        // 产生爆炸效果
        game.burst(this.x, this.y, 70, "#ff8c42");
        game.burst(this.x, this.y, 24, "#ffffff");
      }
    }
  }
}
