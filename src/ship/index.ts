import type { Ship, ShipConfig, SailOrder, ThreatItem } from "./ship";
import { P, rand, clamp, angleDiff, approachAngle } from "../game/utils";
import { updateSailOrder } from "../game/movement";
import { getGameInstance } from "../game/Game";
// 武器参数集中在 src/weapons
import { getWeaponSpec, withinRange } from "../weapons";

const CANNON = getWeaponSpec("shell");
const TORPEDO = getWeaponSpec("torp");

// 炮口与目标方向的夹角小于该值（约 3.4°）才允许开火
const AIM_TOLERANCE = 0.06;

export class ShipImpl implements Ship {
  x: number;
  y: number;
  minX: number;
  maxX: number;
  dir: 1 | -1;
  hp: number;
  maxHp: number;
  len: number;
  wid: number;
  light: string;
  dark: string;
  name: string;
  team: "red" | "blue";
  baseY: number;
  order: SailOrder | null;

  baseAngle: number;
  angle: number;
  state: "normal" | "dodge" | "recover";
  stateT: number;
  dodgeT: number;
  dodgeSide: 1 | -1;
  vx: number;
  vy: number;
  gunCD: number;
  torpCD: number;
  hitFlash: number;
  smokeTimer: number;
  recoil: number;
  aimAngle: number;
  aimOrder: SailOrder | null;

  constructor(cfg: ShipConfig) {
    this.x = cfg.x;
    this.y = cfg.y;
    this.minX = cfg.minX;
    this.maxX = cfg.maxX;
    this.dir = cfg.dir;
    this.hp = 100;
    this.maxHp = 100;
    this.len = 100;
    this.wid = 30;
    this.light = cfg.light;
    this.dark = cfg.dark;
    this.name = cfg.name;
    this.team = cfg.team;
    this.baseY = cfg.baseY;
    this.order = null;

    this.baseAngle = this.dir > 0 ? 0 : Math.PI;
    this.angle = this.baseAngle;

    this.state = "normal";
    this.stateT = 0;
    this.dodgeT = 0;
    this.dodgeSide = 1;

    this.vx = 0;
    this.vy = 0;

    this.gunCD = rand(CANNON.initialCooldownMin, CANNON.initialCooldownMax);
    this.torpCD = rand(TORPEDO.initialCooldownMin, TORPEDO.initialCooldownMax);
    this.hitFlash = 0;
    this.smokeTimer = 0;
    this.recoil = 0;
    this.aimAngle = this.baseAngle;
    this.aimOrder = null;
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
      // 只有鱼雷才需要规避
      if (p.type !== "torp") continue;

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

  startDodge(th: ThreatItem): void {
    // 开始规避机动
    const p = th.p;
    // 预测的弹道击中Y坐标
    const hitY = p.y + p.vy * th.t;

    let side: 1 | -1 = 1;
    // 判断应该向上还是向下规避
    if (Math.abs(hitY - this.y) < 8) {
      side = Math.random() < 0.5 ? -1 : 1;
    } else {
      side = hitY > this.y ? -1 : 1;
    }

    const margin = 55;
    // 防止规避时超出边界
    if (side < 0 && this.y < P.yMin + margin) side = 1;
    if (side > 0 && this.y > P.yMax - margin) side = -1;

    this.dodgeSide = side;
    this.state = "dodge";
    this.dodgeT = 0;
    this.stateT = 0;
  }

  update(dt: number) {
    // 更新舰船状态（每帧调用）
    if (!this.alive) return;

    // 减少闪白和后坐力效果
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (this.hp < this.maxHp) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        getGameInstance()?.smoke(this.x, this.y);
        this.smokeTimer = this.hp / this.maxHp < 0.3 ? 0.22 : this.hp / this.maxHp < 0.6 ? 0.4 : 0.75;
      }
    }
    this.stateT += dt;

    // 有航行指令时，本帧由指令接管移动（转向 + 前进）；否则按原状态机巡航
    if (!updateSailOrder(this, dt)) {
      // 每帧可转动的角度
      const rotStep = P.turnRate * dt;

      if (this.state === "normal") {
        // 正常状态：逐步转回基准角度，检测威胁
        this.angle = approachAngle(this.angle, this.baseAngle, rotStep);
        const th = this.findThreat();
        if (th) this.startDodge(th);
      } else if (this.state === "dodge") {
        // 规避状态：转向90度角度并快速移动
        const targetAngle = this.baseAngle + (this.dodgeSide * Math.PI) / 2;
        this.angle = approachAngle(this.angle, targetAngle, rotStep);

        this.y += this.dodgeSide * P.moveSpeed * P.dodgeFactor * dt;
        this.y = clamp(this.y, P.yMin, P.yMax);

        this.dodgeT += dt;
        if (this.dodgeT >= P.dodgeDuration) {
          this.state = "recover";
          this.stateT = 0;
        }
      } else if (this.state === "recover") {
        // 回正状态：逐步转回基准角度并返回基准位置
        this.angle = approachAngle(this.angle, this.baseAngle, rotStep);

        const dy = this.baseY - this.y;
        const step = P.moveSpeed * P.dodgeFactor * dt;
        if (Math.abs(dy) <= step) this.y = this.baseY;
        else this.y += Math.sign(dy) * step;

        const angDone = Math.abs(angleDiff(this.angle, this.baseAngle)) < 0.02;
        const posDone = Math.abs(this.y - this.baseY) < 0.5;
        if (angDone && posDone && this.stateT > 0.35) {
          this.state = "normal";
          this.angle = this.baseAngle;
          this.y = this.baseY;
        }
      }

      // 计算水平速度（根据当前状态）
      const speedFactor = this.state === "normal" ? P.normalFactor : P.dodgeFactor;
      const hs = P.moveSpeed * speedFactor;

      // 更新水平位置并处理边界反弹
      this.x += this.dir * hs * dt;
      if (this.x < this.minX) {
        this.x = this.minX;
        this.dir = 1;
        this.baseAngle = 0;
      }
      if (this.x > this.maxX) {
        this.x = this.maxX;
        this.dir = -1;
        this.baseAngle = Math.PI;
      }

      // 更新速度向量（用于预判）
      this.vx = this.dir * hs;
      if (this.state === "dodge") {
        this.vy = this.dodgeSide * P.moveSpeed * P.dodgeFactor;
      } else if (this.state === "recover") {
        const dy = this.baseY - this.y;
        this.vy = Math.abs(dy) > 1 ? Math.sign(dy) * P.moveSpeed * P.dodgeFactor : 0;
      } else {
        this.vy = 0;
      }
    }

    // 处理武器发射
    this.updateWeapons(dt);
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

    const game = getGameInstance();
    if (!game) return;

    let fired = false;
    if (this.gunCD <= 0) {
      this.gunCD = rand(CANNON.cooldownMin, CANNON.cooldownMax);
      game.fireShellAt(this, point.x, point.y);
      fired = true;
    }
    if (this.torpCD <= 0) {
      this.torpCD = rand(TORPEDO.cooldownMin, TORPEDO.cooldownMax);
      game.fireTorpedoAt(this, point.x, point.y);
      fired = true;
    }
    if (fired) {
      this.recoil = 1;
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
      game.fireShell(this, target);
      this.recoil = 1;
    }
    if (this.torpCD <= 0 && withinRange(this, target, TORPEDO.range)) {
      this.torpCD = rand(TORPEDO.cooldownMin, TORPEDO.cooldownMax);
      game.fireTorpedo(this, target);
      this.recoil = 1;
    }
  }

  private updateWeapons(dt: number): void {
    const rate = this.state === "normal" ? 1 : P.firePenalty;
    this.gunCD -= dt * rate;
    this.torpCD -= dt * rate;

    // 手动射击指令优先于自动交战
    if (this.aimOrder) {
      const order = this.aimOrder;
      const aim = Math.atan2(order.y - this.y, order.x - this.x);
      this.turnTurretToward(aim, dt);
      if (this.isAimedAt(aim)) this.fireManualVolley(order);
      return;
    }

    const target = this.findTarget();
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
      const game = getGameInstance();
      if (game) {
        // 产生爆炸效果
        game.burst(this.x, this.y, 70, "#ff8c42");
        game.burst(this.x, this.y, 24, "#ffffff");
      }
    }
  }
}
