// Drawing functions
import { P, W, H, TAU } from './utils';
import { Ship, Projectile, Particle } from './types';

// We'll need to set the context externally
let ctx: CanvasRenderingContext2D | null = null;

export function setContext(canvasContext: CanvasRenderingContext2D) {
  ctx = canvasContext;
}

export function drawWater(t: number) {
  if (!ctx) return;
  
  const context = ctx;
  const g = context.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0,   '#0a2c44');
  g.addColorStop(0.5, '#0d3c5c');
  g.addColorStop(1,   '#0a2c44');
  context.fillStyle = g;
  context.fillRect(0, 0, W, H);

  context.strokeStyle = 'rgba(120,200,255,.075)';
  context.lineWidth = 2;
  const waveCount = Math.floor((H - 40) / 36) + 1;
  for (let i = 0; i < waveCount; i++) {
    const y = 40 + i * 36;
    context.beginPath();
    for (let x = 0; x <= W; x += 20) {
      const yy = y + Math.sin(x * 0.02 + t * 1.2 + i) * 5;
      x === 0 ? context.moveTo(x, yy) : context.lineTo(x, yy);
    }
    context.stroke();
  }
}

export function drawShip(s: Ship) {
  if (!ctx || !s.alive) return;

  const context = ctx;
  const L = s.len, Wd = s.wid;
  const bow = 26;

  context.save();
  context.translate(s.x, s.y);
  context.rotate(s.angle);

  context.save();
  context.globalAlpha = 0.25;
  context.fillStyle = '#000';
  context.beginPath();
  context.ellipse(0, Wd * 0.6, L * 0.5, Wd * 0.5, 0, 0, TAU);
  context.fill();
  context.restore();

  const pts = [
    [-L / 2, -Wd / 2],
    [ L / 2 - bow, -Wd / 2],
    [ L / 2, 0],
    [ L / 2 - bow, Wd / 2],
    [-L / 2, Wd / 2]
  ];
  const hullPath = () => {
    context.beginPath();
    pts.forEach(([px, py], i) => i === 0 ? context.moveTo(px, py) : context.lineTo(px, py));
    context.closePath();
  };

  hullPath();
  const grd = context.createLinearGradient(0, -Wd / 2, 0, Wd / 2);
  grd.addColorStop(0, s.light);
  grd.addColorStop(1, s.dark);
  context.fillStyle = grd;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = 'rgba(0,0,0,.45)';
  context.stroke();

  context.fillStyle = 'rgba(255,255,255,.10)';
  context.fillRect(-L / 2 + 8, -Wd / 2 + 5, L - 42, Wd - 10);

  context.fillStyle = 'rgba(255,255,255,.22)';
  context.fillRect(-8, -Wd / 2 + 3, 26, Wd - 6);
  context.fillStyle = 'rgba(0,0,0,.28)';
  context.fillRect(-4, -Wd / 2 + 6, 18, Wd - 12);

  context.fillStyle = '#1b2733';
  context.fillRect(-24, -Wd / 2 + 2, 6, Wd - 4);

  if (s.hitFlash > 0) {
    context.globalAlpha = s.hitFlash * 0.75;
    context.fillStyle = '#fff';
    hullPath();
    context.fill();
    context.globalAlpha = 1;
  }

  context.restore();

  const e = s.findTarget();
  if (e) {
    const ang = Math.atan2(e.y - s.y, e.x - s.x);
    context.save();
    context.translate(s.x, s.y);
    context.rotate(ang);
    const rec = s.recoil * 5;
    context.fillStyle = '#2a3644';
    context.fillRect(-4 - rec, -3.5, 34, 7);
    context.beginPath();
    context.arc(-4 - rec, 0, 9, 0, TAU);
    context.fillStyle = '#3a4a5c';
    context.fill();
    context.restore();
  }

  const bw = 76, bh = 7;
  const bx = s.x - bw / 2;
  const by = s.y - Wd / 2 - 28;

  context.fillStyle = 'rgba(0,0,0,.55)';
  context.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
  context.fillStyle = '#22303d';
  context.fillRect(bx, by, bw, bh);

  const ratio = s.hp / s.maxHp;
  context.fillStyle = ratio > 0.55 ? '#4ade80' : ratio > 0.25 ? '#fbbf24' : '#ef4444';
  context.fillRect(bx, by, bw * ratio, bh);

  context.strokeStyle = 'rgba(255,255,255,.25)';
  context.lineWidth = 1;
  context.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

  context.font = '600 11px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillStyle = s.light;
  context.fillText(s.name, s.x, by - 8);

  if (s.state !== 'normal') {
    context.font = '10px system-ui, sans-serif';
    context.fillStyle = s.state === 'dodge' ? '#fbbf24' : '#7dd3fc';
    context.fillText(
      s.state === 'dodge' ? '⚡ 规避转体 · 全速 · 射速减半' : '↩ 回正中 · 全速 · 射速减半',
      s.x, by + bh + 14
    );
  }
}

export function drawProjectile(p: Projectile) {
  if (!ctx) return;

  const context = ctx;
  if (p.trail.length >= 4) {
    context.beginPath();
    context.moveTo(p.trail[0], p.trail[1]);
    for (let i = 2; i < p.trail.length; i += 2) {
      context.lineTo(p.trail[i], p.trail[i + 1]);
    }
    context.strokeStyle = p.type === 'torp'
      ? 'rgba(120,220,255,.35)'
      : 'rgba(255,200,80,.28)';
    context.lineWidth = p.type === 'torp' ? 4 : 2;
    context.lineCap = 'round';
    context.stroke();
  }

  if (p.type === 'torp') {
    context.save();
    context.translate(p.x, p.y);
    context.rotate(Math.atan2(p.vy, p.vx));
    context.fillStyle = '#8ee7ff';
    context.beginPath();
    context.ellipse(0, 0, 11, 4.5, 0, 0, TAU);
    context.fill();
    context.fillStyle = '#e6fbff';
    context.beginPath();
    context.arc(8, 0, 3, 0, TAU);
    context.fill();
    context.restore();
  } else {
    context.beginPath();
    context.arc(p.x, p.y, 9, 0, TAU);
    context.fillStyle = 'rgba(255,210,100,.22)';
    context.fill();
    context.beginPath();
    context.arc(p.x, p.y, 4.5, 0, TAU);
    context.fillStyle = '#ffe08a';
    context.fill();
  }
}

export function drawParticle(p: Particle) {
  if (!ctx) return;

  const context = ctx;
  const a = Math.max(0, p.life / p.maxLife);
  context.globalAlpha = a;
  context.fillStyle = p.color;
  context.beginPath();
  context.arc(p.x, p.y, p.size * a, 0, TAU);
  context.fill();
  context.globalAlpha = 1;
}

export function drawHUD(game: any) {
  if (!ctx) return;

  const context = ctx;
  context.font = '600 15px system-ui, sans-serif';
  context.textAlign = 'left';
  context.fillStyle = 'rgba(180,215,245,.75)';
  context.fillText('2D 海战 · 自动对战', 22, 32);

  context.textAlign = 'right';
  context.font = '400 13px system-ui, sans-serif';
  context.fillStyle = 'rgba(140,175,205,.6)';
  context.fillText('主炮 10 伤害 · 鱼雷 30 伤害 · 规避转体 90°', W - 22, 32);

  if (game.over) {
    context.fillStyle = 'rgba(4,12,22,.65)';
    context.fillRect(0, 0, W, H);

    context.textAlign = 'center';
    context.font = '700 46px system-ui, sans-serif';
    context.fillStyle = game.winnerTeam === 'red' ? '#ff7b6b'
              : game.winnerTeam === 'blue' ? '#7cc4ff'
              : '#cfe3f5';
    context.fillText(
      game.winnerTeam === 'red'  ? '红方胜利'
    : game.winnerTeam === 'blue' ? '蓝方胜利'
    : '同归于尽',
      W / 2, H / 2 - 10
    );

    context.font = '400 16px system-ui, sans-serif';
    context.fillStyle = 'rgba(200,225,245,.75)';
    context.fillText('点击画面重新开始', W / 2, H / 2 + 40);
  }
}