// 海面着色器源码（GLSL）
// 全部程序化生成，不再依赖 Canvas 2D 绘制的动态贴图：
// - 主体涌浪：多列方向波叠加，顶点做位移、片元做解析法线
// - 细浪：只扰动法线，制造细碎的高光闪烁
// - 焦散 / 白沫 / 浮游闪烁：片元里按海域参数生成
// - 动态高光：Blinn-Phong 半程向量，坡度变化直接反映到高光上

// 波形场公共代码：顶点、片元共用
const WAVE_CHUNK = `
  // 叠加一列方向波，返回 vec3(高度, dh/dx, dh/dy)
  vec3 addWave(vec3 acc, vec2 p, vec2 dir, float freq, float amp, float speed, float t, float warp) {
    float phase = dot(p, dir) * freq + t * speed + warp;
    float s = sin(phase);
    float c = cos(phase);
    return vec3(acc.x + amp * s, acc.y + amp * freq * c * dir.x, acc.z + amp * freq * c * dir.y);
  }

  // 主浪方向与参数（波峰线、白沫都按它算，保证成带状而不是碎斑）
  const vec2 WAVE_MAIN_DIR = vec2(0.120, 0.993);
  const float WAVE_MAIN_FREQ = 0.017;
  const float WAVE_MAIN_SPEED = 1.05;

  // 低频相位扰动：波峰线自然蜿蜒，而不是规则网格
  float waveWarp(vec2 p, float t) {
    return 0.90 * sin(dot(p, vec2(0.210, 0.980)) * 0.0035 + t * 0.15)
         + 0.60 * sin(dot(p, vec2(-0.630, 0.780)) * 0.0024 - t * 0.11);
  }

  // 主体涌浪：不同方向/波长/速度的四列行波
  vec3 waveSwell(vec2 p, float t) {
    float warp = waveWarp(p, t);
    vec3 acc = vec3(0.0);
    acc = addWave(acc, p, WAVE_MAIN_DIR, WAVE_MAIN_FREQ, 7.00, WAVE_MAIN_SPEED, t, warp);
    acc = addWave(acc, p, vec2(0.851, 0.525), 0.029, 3.20, 1.55, t, warp * 0.6);
    acc = addWave(acc, p, vec2(-0.548, 0.836), 0.047, 1.50, 2.10, t, warp * 0.4);
    acc = addWave(acc, p, vec2(0.955, -0.297), 0.081, 0.70, 2.90, t, 0.0);
    return acc;
  }

  // 波峰线：主浪相位 + 缓慢摆动，泡沫沿着这条线走
  float waveCrest(vec2 p, float t) {
    float phase = dot(p, WAVE_MAIN_DIR) * WAVE_MAIN_FREQ + t * WAVE_MAIN_SPEED + waveWarp(p, t);
    phase += 0.18 * sin(dot(p, vec2(-0.548, 0.836)) * 0.018 + t * 1.4);
    return sin(phase);
  }

  // 波峰带：主浪为主、次浪轻微扰动，0（谷）到 1（峰）
  float waveBand(vec2 p, float t) {
    float main1 = waveCrest(p, t);
    float main2 = sin(dot(p, vec2(0.851, 0.525)) * 0.029 + t * 1.55);
    return clamp(0.80 * main1 + 0.20 * main2, -1.0, 1.0) * 0.5 + 0.5;
  }

  // 细浪：只用来扰动法线，让高光碎成细密的光点
  vec3 waveRipple(vec2 p, float t) {
    vec3 acc = vec3(0.0);
    acc = addWave(acc, p, vec2(0.310, 0.950), 0.090, 0.045, 4.20, t, 0.0);
    acc = addWave(acc, p, vec2(-0.870, 0.490), 0.140, 0.020, 5.60, t, 0.0);
    return acc;
  }
`;

// 噪声 / 焦散 / 闪烁：仅片元使用
const DETAIL_CHUNK = `
  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // 焦散：两族互相牵引的细线，交点处最亮，像浅水折射的光网
  float caustic(vec2 p, float t) {
    float a = abs(sin(p.x * 0.080 + t * 0.70 + sin(p.y * 0.050 - t * 0.40) * 2.0));
    float b = abs(sin(p.y * 0.070 - t * 0.50 + sin(p.x * 0.045 + t * 0.30) * 2.0));
    float v = min(a, b);
    return pow(1.0 - v, 8.0);
  }

  // 浮游闪烁：固定网格上的随机光点，按时间明灭
  float sparkle(vec2 p, float t) {
    vec2 cell = floor(p * 0.28);
    float h = hash21(cell);
    float tw = 0.5 + 0.5 * sin(t * 3.2 + h * 62.8);
    return step(0.955, h) * tw * tw;
  }
`;

/** 顶点着色器：沿视线方向（-Z）做波浪位移 */
export const OCEAN_VERTEX_SHADER = `
  precision highp float;

  attribute vec3 position;

  uniform mat4 worldViewProjection;
  uniform float uTime;
  uniform float uAmplitude;

  varying vec3 vPosition;

  ${WAVE_CHUNK}

  void main(void) {
    vec3 w = waveSwell(position.xy, uTime);
    // 波峰朝相机方向（-Z）隆起
    vPosition = vec3(position.xy, -w.x * uAmplitude);
    gl_Position = worldViewProjection * vec4(vPosition, 1.0);
  }
`;

/** 片元着色器：底色渐变 + 焦散 + 白沫 + 动态高光 + 闪烁 */
export const OCEAN_FRAGMENT_SHADER = `
  precision highp float;

  varying vec3 vPosition;

  uniform float uTime;
  uniform float uAmplitude;
  uniform float uHalfHeight;
  uniform vec3 uColorEdge;
  uniform vec3 uColorCenter;
  uniform vec3 uSkyColor;
  uniform vec3 uLightDir;
  uniform float uSpecPower;
  uniform float uSpecStrength;
  uniform float uFoamAmount;
  uniform float uCausticAmount;
  uniform float uSparkleAmount;

  ${WAVE_CHUNK}
  ${DETAIL_CHUNK}

  void main(void) {
    vec2 p = vPosition.xy;

    // 解析法线：涌浪 + 细浪一起算
    vec3 swell = waveSwell(p, uTime);
    vec3 ripple = waveRipple(p, uTime);
    vec2 grad = (swell.yz + ripple.yz) * uAmplitude;
    float slope = length(grad);

    // 相机固定在 -Z 俯视，法线朝向相机
    vec3 N = normalize(vec3(-grad.x, -grad.y, -1.0));
    vec3 V = vec3(0.0, 0.0, -1.0);
    vec3 L = normalize(uLightDir);
    vec3 H = normalize(L + V);

    float ndl = max(dot(N, L), 0.0);
    float ndh = max(dot(N, H), 0.0);
    float spec = pow(ndh, uSpecPower) * uSpecStrength;
    float sheen = pow(ndh, 4.0) * 0.20 * uSpecStrength;

    // 底色：上下渐变
    float vgrad = clamp(abs(p.y) / max(uHalfHeight, 1.0), 0.0, 1.0);
    vec3 base = mix(uColorCenter, uColorEdge, vgrad);

    // 波峰带：亮带随浪走，是画面里最显眼的结构
    float band = waveBand(p, uTime);
    base *= mix(0.90, 1.10, band);

    // 坡面反光：坡度越大越偏天空色
    base = mix(base, uSkyColor, clamp(slope * 0.4, 0.0, 0.16));

    // 焦散（浅海）
    base += caustic(p, uTime) * uCausticAmount * uColorCenter * 0.22;

    // 白沫（浅海）：落在波峰线上，边缘柔和、浓淡不均
    float foam = smoothstep(0.90, 1.0, waveCrest(p, uTime)) * uFoamAmount;
    foam *= 0.30 + 0.70 * valueNoise(p * 0.06 + vec2(uTime * 0.30, uTime * 0.12));
    base = mix(base, vec3(0.82, 0.92, 0.98), clamp(foam, 0.0, 1.0));

    // 漫反射 + 高光
    vec3 color = base * (0.62 + 0.38 * ndl);
    color += vec3(1.0, 0.97, 0.90) * (spec + sheen);

    // 浮游闪烁（深海）：只在高光附近显现
    float glint = sparkle(p, uTime) * uSparkleAmount;
    color += vec3(0.75, 0.90, 1.0) * glint * (0.20 + spec * 2.0);

    gl_FragColor = vec4(color, 1.0);
  }
`;
