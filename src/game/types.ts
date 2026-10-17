// Game types and interfaces
export interface Vector2 {
  x: number;
  y: number;
}

export interface Projectile {
  type: 'shell' | 'torp';
  owner: Ship;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  life: number;
  trail: number[];
  dead?: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface Ship {
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
  team: 'red' | 'blue';
  baseY: number;

  baseAngle: number;
  angle: number;
  state: 'normal' | 'dodge' | 'recover';
  stateT: number;
  dodgeT: number;
  dodgeSide: 1 | -1;
  vx: number;
  vy: number;
  gunCD: number;
  torpCD: number;
  hitFlash: number;
  recoil: number;

  get alive(): boolean;
  findTarget(): Ship | null;
  findThreat(): any;
  startDodge(th: any): void;
  update(dt: number): void;
  takeDamage(dmg: number): void;
}

export interface GameState {
  ships: Ship[];
  projectiles: Projectile[];
  particles: Particle[];
  time: number;
  over: boolean;
  winnerTeam: 'red' | 'blue' | null;
  reset(): void;
  fireShell(ship: Ship, target: Ship): void;
  fireTorpedo(ship: Ship, target: Ship): void;
  burst(x: number, y: number, n: number, color: string): void;
  resolveCollisions(): void;
  updateProjectiles(dt: number): void;
  updateParticles(dt: number): void;
  update(dt: number): void;
  draw(): void;
}

export interface GameConfig {
  moveSpeed: number;
  normalFactor: number;
  dodgeFactor: number;
  turnRate: number;
  dodgeDuration: number;
  recoverDuration: number;
  dodgeSideDist: number;
  shellSpeed: number;
  shellDmg: number;
  shellR: number;
  torpSpeed: number;
  torpDmg: number;
  torpR: number;
  firePenalty: number;
  minSep: number;
  yMin: number;
  yMax: number;
}