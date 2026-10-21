// 弹道计算：二次贝塞尔曲线
// 主炮改成「曲射」后，炮弹沿曲线飞行；弯曲度为 0 时曲线退化成直线。
export interface Curve2 {
  /** 起点 X */
  x0: number;
  /** 起点 Y */
  y0: number;
  /** 控制点 X */
  cx: number;
  /** 控制点 Y */
  cy: number;
  /** 终点 X */
  x1: number;
  /** 终点 Y */
  y1: number;
}

/** 二维点 */
export interface Point {
  x: number;
  y: number;
}

/** 求曲线上参数 t 处的坐标 */
export function sampleCurve(curve: Curve2, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * curve.x0 + 2 * u * t * curve.cx + t * t * curve.x1,
    y: u * u * curve.y0 + 2 * u * t * curve.cy + t * t * curve.y1,
  };
}

/** 求曲线上参数 t 处的切向量（未除以时长） */
export function curveTangent(curve: Curve2, t: number): Point {
  const u = 1 - t;
  return {
    x: 2 * u * (curve.cx - curve.x0) + 2 * t * (curve.x1 - curve.cx),
    y: 2 * u * (curve.cy - curve.y0) + 2 * t * (curve.y1 - curve.cy),
  };
}

/** 估算曲线长度（分段采样求和） */
export function curveLength(curve: Curve2, samples = 16): number {
  let total = 0;
  let prev = sampleCurve(curve, 0);
  for (let i = 1; i <= samples; i++) {
    const point = sampleCurve(curve, i / samples);
    total += Math.hypot(point.x - prev.x, point.y - prev.y);
    prev = point;
  }
  return total;
}

/**
 * 构造一段带弯曲的弹道
 * @param start 起点
 * @param end 终点
 * @param bend 弯曲度（相对弦长）：0.1 表示控制点偏离中点 10% 弦长
 * @param side 弯曲方向：1 / -1
 */
export function buildCurve(start: Point, end: Point, bend: number, side: 1 | -1): Curve2 {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) {
    return { x0: start.x, y0: start.y, cx: start.x, cy: start.y, x1: end.x, y1: end.y };
  }
  // 弦的法线方向，控制点沿法线偏移形成弧线
  const nx = -dy / len;
  const ny = dx / len;
  const offset = len * bend * side;
  return {
    x0: start.x,
    y0: start.y,
    cx: (start.x + end.x) / 2 + nx * offset,
    cy: (start.y + end.y) / 2 + ny * offset,
    x1: end.x,
    y1: end.y,
  };
}

/** 把曲线采样成点列（用于绘制弹道预览） */
export function sampleCurvePoints(curve: Curve2, samples = 24): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= samples; i++) points.push(sampleCurve(curve, i / samples));
  return points;
}
