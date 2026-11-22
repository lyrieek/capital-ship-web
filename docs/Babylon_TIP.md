# Babylon.js 实战经验（capital-ship-web2）

> 版本：`@babylonjs/core@9.31.0` / `@babylonjs/gui@9.31.0`
> 场景：正交俯视 2D 海战，世界坐标原点左上、Y 向下，场景坐标由 `babylon/coords.ts` 统一换算。
> 这份文档记录的是「踩过一次、以后不要再踩」的经验，不是 API 手册。

---

## 0. 三条总原则

1. **每帧只改变换，不重建对象。** 会动的零件用 `TransformNode` / `instance` / 粒子系统；不要每帧 `dispose` + `Create`，也不要每帧重绘贴图再上传。
2. **权威数据留在游戏层。** `ship.x/y`、弹道、伤害都在纯逻辑里；渲染层只读它、表现它，不要把 Mesh 的位置当成游戏状态（碰撞回写那种混合方案最容易出时序 bug）。
3. **一套规则只解决一件事。** 图层要么用 `renderingGroupId`，要么用世界 Z，不要同时用；时间要么用游戏 `dt`，要么用引擎 delta，不要混。

判断一个地方该不该改，用三条同时衡量：

- Babylon 有成熟现成系统；
- 当前实现是在重新发明它，或者和引擎设计方向相反；
- 换掉能**同时**降低代码量、CPU 开销或 bug 面积。

只是「看起来更 Babylon」不算理由。

---

## 1. 粒子：用 `SolidParticleSystem`，但注意它的初始化顺序

### 1.1 `buildMesh()` 不会调用 `initParticles()`

这是本项目实际踩过的空指针：

```text
Cannot read properties of null (reading 'x') at sps.updateParticle
```

原因：`SolidParticleSystem` 只有 `start()` 会调用 `initParticles()`，`buildMesh()` 不会。
所以「`addShape` → `buildMesh` → `setParticles`」之后，`particle.props` 仍然是 `null`。

正确顺序：

```ts
const sps = new SolidParticleSystem("fx", scene, { updatable: true });
sps.addShape(model, CAPACITY);
sps.initParticles = () => { /* 给每个 particle.props / color / scaling 赋初值 */ };
sps.updateParticle = (p) => { /* ... */ };
const mesh = sps.buildMesh();

sps.initParticles();   // 必须手动调一次
sps.setParticles();
```

另外在 `updateParticle` 里加一道兜底，避免以后再次因为初始化顺序崩掉：

```ts
sps.updateParticle = (p) => {
  if (!p.isVisible) return p;
  const props = p.props as FxParticleProps | null;
  if (!props) return p;
  // ...
};
```

### 1.2 逐粒子颜色：`StandardMaterial` 的 emissive 不乘顶点色

`SolidParticleSystem` 会把 `particle.color` 写进顶点色，但 `StandardMaterial` 的着色器里：

- `vColor` 只乘到 `baseColor`（diffuse）；
- `emissive` 是单独相加的，不会被 `vColor` 染色；
- 如果材质是 `disableLighting = true` + `emissiveTexture`（项目里原来的精灵材质），顶点色对最终颜色基本无效。

所以要么：

- 用 `StandardMaterial` 时让粒子走 diffuse（给一盏均匀光，或在材质里自行处理），
- 要么直接写一个很小的 unlit `ShaderMaterial`：

```glsl
// vertex
attribute vec4 color;
varying vec4 vColor;
varying vec2 vUV;
void main(void) {
  vColor = color;
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}

// fragment
uniform sampler2D particleTexture;
void main(void) {
  vec4 tex = texture2D(particleTexture, vUV);
  gl_FragColor = vec4(tex.rgb * vColor.rgb, tex.a * vColor.a);
}
```

本项目选了后者（`src/game/particle-fx.ts`），顺带把「一张贴图 + 一份材质 + 一个 Mesh」做到了。

### 1.3 其他 SPS 要点

- **`updatable: true`**：`setParticles()` 每帧直接更新顶点缓冲，必须可更新。
- `particle.isVisible = false` 后，SPS 会把该粒子顶点归零并标记 `_stillInvisible`；再次设 `isVisible = true` 就能恢复，不需要重建 Mesh。
- `particle.scaling.setAll(0)` 可以进一步避免透明区域填充。
- 不要用 `start()`：它会在 `scene.onBeforeRenderObservable` 里自己 `setParticles()`，会和游戏固定步长/倍速打架。项目是手动 `sync(dt)` 调 `setParticles()`，`dt` 与 `gameSpeed` 同一份。
- 表现事件和游戏状态解耦：玩法层只发 `emitBurst/emitSmoke`，`GameState` 里不再保存粒子数组。这样回放/固定步长时粒子不会影响战斗结果。

---

## 2. 动态线与合批：`LinesMesh` 的 `instance`、`ThinInstance`

### 2.1 点位更新用 `instance`，不要每帧重建

`CreateDashedLines` 支持 `updatable` + `instance`，前提是**点数量不变**（导航线固定两个点，正好满足）：

```ts
// 第一次
visual.line = MeshBuilder.CreateDashedLines(name, {
  points: [start, end],
  dashNb: 24,
  gapSize: 5,
  dashSize: 5,
  updatable: true,
}, scene);

// 之后每帧
MeshBuilder.CreateDashedLines(visual.line.name, {
  points: [start, end],
  instance: visual.line,
}, scene);
```

`instance` 更新时不要再传 `dashNb/gapSize/dashSize`，Babylon 会警告并忽略它们。
需要更粗/可发光的线时用 `GreasedLine`（`CreateGreasedLine` + `setPoints`），它是 Babylon 现在推荐的增强线方案。

### 2.2 `LinesMesh` 自带 `color / alpha / isPickable`

给 `LinesMesh` 挂一整份 `StandardMaterial` 只为改颜色是浪费：

```ts
line.color = Color3.FromHexString("#4ade80");
line.alpha = 0.6;
line.isPickable = false;
```

Babylon 9 确实会尊重赋给 `LinesMesh` 的材质（内部会把 `fillMode` 设为 `LineListDrawMode`），但原生属性更轻，也不会多出一份材质。

### 2.3 重复精灵：`ThinInstance`，而不是每发一个 Mesh

弹药这种「同几何、同材质、数量随场景变化」的对象，用一个 Plane + 每实例矩阵缓冲就够了：

```ts
mesh.thinInstanceSetBuffer("matrix", buffer, 16, false);

// 每帧
Matrix.ComposeToRef(scale, rotation, position, matrix);
matrix.copyToArray(buffer, index * 16);
mesh.thinInstanceCount = count;
mesh.thinInstanceBufferUpdated("matrix");
```

要点：

- 矩阵用 `Matrix.ComposeToRef(scale, quaternion, position)` 组合，和 Mesh 的 `scaling/rotation/position` 等价。只想绕 Z 转时用 `Quaternion.RotationYawPitchRollToRef(0, 0, angle, q)`，不要自己猜轴角符号。
- 容量按需翻倍即可；换缓冲时重新 `thinInstanceSetBuffer`，然后重写本帧所有矩阵。
- `mesh.alwaysSelectAsActiveMesh = true`，避免实例移动后包围盒裁剪把整批剔掉。
- `thinInstanceCount = 0` 就是隐藏整批，不需要销毁 Mesh。
- 一个批次一次 draw call；按材质分组（本项目按武器类型分成 shell / torp 两批）。

---

## 3. 会动的零件：拆 `TransformNode`，不要重绘贴图

本项目原来的舰船把舰体和炮塔画在同一张 `DynamicTexture` 上，炮管一转就整张重绘 + `texture.update()`。正确做法是：

- **舰体贴图只画静态部分**（舰体、甲板、涂装），创建时画一次，之后不再重绘；
- **炮塔单独一张贴图 + 子 Mesh**，用 `TransformNode` 做转向；
- **后坐**用子 Mesh 的局部 `position.x` 表达，不需要重画炮管。

```ts
// pivot 负责转向，mesh 负责显示和后坐
const pivot = new TransformNode(`turretPivot_${name}`, scene);
pivot.parent = hull;              // 挂在舰体上，跟随舰体位置/朝向
pivot.position.x = turretOffset;  // 舰体本地坐标

const plane = createPlane(...);
plane.parent = pivot;             // 本地坐标 (0, 0, z)
plane.isPickable = false;         // 点击穿透到舰体
plane.position.z = -0.1;          // 比舰体更靠近相机

// 每帧
pivot.rotation.z = -(ship.aimAngle - ship.angle);
plane.position.x = -ship.recoil * KICK;
```

关键点：

- **世界矩阵是 `Scale → Rotation → Translation`**（`Matrix.ComposeToRef(scaling, rotation, translation)`）。所以本地轴和世界轴的关系要先想清楚：`rotation.x = PI/2` 后，本地 Z 才对应世界 Y。
- 父子局部旋转 = 世界角之差：舰体旋转 `-ship.angle`，炮塔目标世界旋转 `-ship.aimAngle`，所以 pivot 本地旋转 `-(aimAngle - angle)`。
- 子 Mesh 的拾取默认应该关掉（`isPickable = false`），否则点击炮塔时拿到的是没有 `ActionManager` 的子 Mesh。
- 透明精灵片（炮塔平面大部分是透明的）建议 `material.disableDepthWrite = true`，避免透明区域写深度挡住后面的东西。
- 共享材质/贴图的多个子 Mesh，销毁时只释放一次：`pivot.dispose()` 会带走子 Mesh，但不会带走材质/贴图。

---

## 4. 图层与深度（正交俯视）

### 4.1 图片层只留一套规则

项目里曾经同时存在：

- `SHIP_Z = -1`、`RING_Z = -0.5` 这种用世界 Z 当图层；
- `renderingGroupId` 分组；
- 海面顶点着色器又把波峰朝相机方向推最多约 12 个世界单位。

结果波峰会比舰船更靠近相机，深度测试把舰船盖掉，只能用渲染分组打补丁。

经验：

- **组间用 `renderingGroupId`，组内用 `alphaIndex`。** 本项目：0 = 海面，1 = 地物 + 舰船/选中圈/炮塔，2 = 弹药/粒子/导航线；组内 `alphaIndex` 固定为 选中圈 0 → 舰体 1 → 炮塔 2（Babylon 先按 `mesh.alphaIndex` 升序，再按距离排序透明子网格）。
- 世界 Z 只表示真实 3D 高度（地形）和必要的共面深度偏移，**不要再用 Z 当图层序号**。
- 最底层的海面材质可以 `disableDepthWrite = true`，它本就不该遮挡任何东西；
- 正交相机收紧 `minZ/maxZ`（本项目相机在 `z=-100`，实际只用到 `[88, 100]`，旧默认 `0.1/1000` 精度很浪费；现在默认 `1/200`）；
- 如果不想依赖分组，把海浪位移改成朝 +Z（远离相机）也能从几何上保证海面永远在舰船后面。

### 4.2 透明材质

- 透明精灵（舰船、炮塔、选中圈、粒子、弹药）统一 `disableDepthWrite = true`，避免透明像素写深度。本项目直接放在精灵材质工厂 `createSpriteMaterial` 里，一次搞定所有 2D 精灵。
- 不写深度后，共面的精灵不会 z-fighting，也不需要为了层级给炮塔加 Z 偏移；顺序完全由 `renderingGroupId` + `alphaIndex` 决定。
- 透明网格按相机距离排序；子 Mesh 的包围球中心会影响排序，必要时显式设置 `alphaIndex`。
- `LinesMesh`、`ShaderMaterial`、`StandardMaterial` 的 `disableDepthWrite` 都来自 `Material`，可以统一用。

### 4.3 GUI 图层顺序

- 多个 `AdvancedDynamicTexture` 的上下关系就是 `scene.layers` 数组顺序；`CreateFullscreenUI(name, foreground)` 的 `foreground` 只决定「场景前 / 场景后」，不能解决多个前景层之间的顺序。
- 不要用 layer 名字前缀（如 `startsWith("model")`）猜层级。用显式的 `registerGuiLayer(adt, role)`，按 `shipHud(0) / hud(1) / modal(2)` + 注册顺序重排。
- 注册的 ADT 必须在 `root.dispose()` 之前 `unregisterGuiLayer(root)`，否则 registry 会保留失效的 layer 引用。
- 如果以后 UI 层继续变多，首选合并成一个全屏 ADT + 容器 `moveToTop()`；多 ADT 每张都是全屏纹理 + 全屏绘制。

---

## 5. 碰撞、拾取与输入

### 5.1 2D 碰撞留在模拟层

- 俯视海战的权威状态是 `x / y / heading`，碰撞就用 XY 的圆、胶囊或凸多边形；不要用渲染 Mesh 的 `moveWithCollisions` 反过来修正游戏状态。
- 碰撞放进渲染层的代价：需要维护「必须在 sync 之前 / 必须在读 ship 之前」的隐式顺序；`ship.x/y` 和 `mesh.position` 两个权威源会在 reset、摆船、互推、传送时短暂不一致；也基本没法做纯逻辑单测。
- 舰船用胶囊（船头/船尾两个圆 + 半舰宽），地形用圆；每帧「舰船互推 → 地形推出 → 边界 clamp」。纯函数放 `game/collision.ts`，可以单测、可以固定步长。
- 低面数 3D 船模 / 3D 岛不会逼你上 3D 碰撞；只要玩法不需要垂直交互，2D 碰撞仍然正确。3D 视觉只是 `ship.x/y/angle` 的子节点。
- **注意**：每帧推出重叠不是连续扫掠。障碍很薄、或固定步长把 dt 调大时，要补 segment-sweep 防穿模。

#### 5.1.1 未来上 3D 素材怎么选

先分清「表现几维」和「模拟几维」：3D 船模 / 3D 岛只要玩法仍在海平面，碰撞就仍然用 XY 的胶囊 / 凸多边形；低面数也不代表碰撞要用渲染网格。真正需要 3D 碰撞的是垂直交互（潜艇/飞机/多层甲板/堆叠/真实翻沉/模块级命中/桥洞）。

| 未来需求 | 碰撞方案 | 说明 |
| --- | --- | --- |
| 3D 船模、3D 岛，但玩法在水平面 | **保持 2D 碰撞（推荐）** | 船用胶囊/凸多边形，岛用海岸线多边形；3D Mesh 只是 `ship.x/y/angle` 的视觉子节点 |
| 潜艇/飞机/导弹高度、飞越岛屿 | **2.5D**：XY + height/layer | 碰撞仍按 XY，命中/遮挡加一次高度判断；不需要 Havok |
| 真实翻沉、堆叠、模块破坏、3D ramming | Havok 或自写 2D 刚体 | 先确认是否真的需要；多数海战玩法用 2D 刚体 + 视觉倾斜就够 |

一句话：**决定碰撞维度的是玩法是否需要垂直交互，不是模型面数。**

### 5.2 拾取：射线 + 平面

- 用 `scene.createPickingRay(x, y, Matrix.Identity(), camera)` + `ray.intersectsPlane(new Plane(0, 0, 1, 0))` 求海平面点；相机倾斜/摆动时也准确。
- 坐标空间：`scene.pick` / `createPickingRay` 接受的是 **canvas CSS 像素**（`clientX - rect.left`），不是 render-buffer / DPR 像素；Babylon 的 InputManager 内部也是这么算的。
- 对象选择用 `scene.pick(x, y, (mesh) => mesh.isPickable && mesh.metadata !== null)`，一个 predicate 决定谁可点。
- 正交相机下 `scene.pick` 拿到的是 CPU 端几何的交点；顶点着色器里的位移不会反映到 `pickedPoint`，但俯视场景的 XY 通常仍然正确。
- `Scene` 构造函数里会自动 `attachControl()`（`scene.pure.js`），指针 / 键盘事件不需要额外 attach。
- `applyCamera()` 每帧先 `camera.setTarget(...)`，`updateCameraEffect()` 再叠加旋转，这是隐式契约。最好把「相机最终姿态」收敛到一个函数里：先算 target，再叠加 effect。

### 5.3 场景级指针状态机

- 用 `scene.onPointerObservable` + `PointerEventTypes.POINTERDOWN` 做选择/右键，不要每 Mesh 一个 `ActionManager`。
- `POINTERDOWN` 不会像 `OnPickTrigger` 那样被双击分类吞掉，快速 Shift 多选天然成立，也不需要 double-pick 补丁。
- hover 光标在同一个 `POINTERMOVE` 分支里用 `scene.pick` 更新。
- GUI modal 要用显式的 `ui-state` 阻塞标志暂停场景输入；ADT 的 `isPointerBlocker` 对 GUI 自己可靠，但不要假设它一定能阻止 `onPointerObservable` 的其它观察者。
- 以后加框选/拖拽/指令队列，就在这个状态机里加 `pointerDown` / `dragStart`，不要再回到每个 Mesh 一套回调。

---

## 6. 引擎与资源生命周期

- `preserveDrawingBuffer` 只在截图 / `readPixels` 时需要，默认关掉。
- **一个 `ResizeObserver` 观察 canvas 就够了**（比 `window.resize` 准）；不要再叠 window resize 监听或每个 playground 自己再建一个。
- `pivot.dispose()` 默认递归销毁子节点；共享材质/贴图要单独释放且只释放一次。
- `engine.dispose()` 会销毁场景及其资源；但「按对象动态增删」的路径要自己保证材质/贴图不泄漏。

---

## 7. 材质与网格

- **静态材质 `material.freeze()`**：跳过每帧 effect/define 检查；静态网格继续 `freezeWorldMatrix()`。动态材质（舰船、粒子、子弹）不要冻。
- **法线朝向**不要只看第一个法线。用全部法线 Z 分量之和判断，再用 `mesh.flipFaces(true)` 同时翻转法线和绕序：

```ts
let normalZ = 0;
for (let i = 2; i < normals.length; i += 3) normalZ += normals[i];
if (normalZ > 0) mesh.flipFaces(true);
```

- **灯是场景级资源**：在 `babylon/scene.ts` 统一创建（本项目一盏 `HemisphericLight`），不要让某个渲染器偷偷建灯，否则以后容易出现重复灯/漏灯。
- 顶点色 + 受光材质是地物的正确组合；舰船/弹药/粒子用自发光或 unlit，不受场景灯影响。
- `DynamicTexture.hasAlpha` 对 `StandardMaterial` 是必要的；自定义 `ShaderMaterial` 直接读 `tex.a`，不依赖这个标记。
- 纹理尺寸尽量用整数；如果要精确控制「纹理像素 → 世界单位」的映射，先取整纹理尺寸，再反算 `pxPerWorld`，不要两头都取整。

---

## 8. 坐标与数据边界

- 世界坐标 → 场景坐标只在 `babylon/coords.ts` 换算；玩法层（`Game`、`Ship`、`weapons`）不出现 Babylon 类型。这条边界让后期换渲染方式时玩法代码几乎不用动。
- 参数表集中（`weapons/spec.ts`、`terrain/spec.ts`、`game/utils.ts` 的 `P`），渲染尺寸和玩法数值都从表里取，避免「看起来一样、实际两套数」。
- 图形细节（船首长度、炮塔半径、偏移）也建议作为常量导出，让舰体绘制和独立炮塔 Mesh 共用同一份几何定义。

---

## 9. 这些现状是对的，不要为了「更 Babylon」而改

| 位置 | 做法 | 评价 |
| --- | --- | --- |
| `expanse/ocean-shader.ts` | 自定义 GLSL `ShaderMaterial` 做程序化海浪 | **正确**。`WaterMaterial` 需要反射/折射纹理，是给真实 3D 水面用的；俯视风浪用自定义 shader 更轻、更可控。 |
| `terrain/island.ts`、`reef.ts`、`shipyard.ts` | 真实网格 + 顶点色 | **正确**；斜视角有体积和遮挡，原因见 `terrain/PLAN.md`。 |
| `ship/hud.ts`、`components/Hud.tsx` | `AdvancedDynamicTexture` + `linkWithMesh` | **正确**，GUI 的标准用法。 |
| `weapons/render.ts` 的尾迹 | `CreateLines({ updatable: true, instance })` | **正确示范**；导航线也按这个方式实现。 |
| `game/render.ts` 的 `renderingGroupId` + `alphaIndex` | 组间分组、组内排序 | **正确**；不要再把世界 Z 当图层。 |
| `components/Minimap.tsx` | 原生 Canvas 2D 画小地图 | **合理**。这是 UI 叠加层，用第二个相机 / RTT 反而增加耦合。 |
| `babylon/coords.ts` | 世界↔场景坐标集中换算 | **正确**。继续保持「玩法层不出现 Babylon 坐标」这条边界。 |
| `weapons/spec.ts`、`terrain/spec.ts` | 数值数据驱动 | **正确**，和 Babylon 无关，但值得保持。 |
| `Engine` 第 4 参 `adaptToDeviceRatio=true` | 自动处理 DPR | **正确**。拾取用 canvas CSS 像素，不受 DPR 影响。 |

## 10. 反模式速查

| 症状 | 正解 |
| --- | --- |
| 每帧 `new Mesh` / `dispose` | `instance` / `ThinInstance` / SPS / 变换节点 |
| 每帧重绘 `DynamicTexture` | 静态部分只画一次；会动的拆子 Mesh |
| 每个对象一份 `StandardMaterial` | 共享材质 + `ThinInstance` / `SpriteManager` / SPS |
| 用世界 Z 当图层 | `renderingGroupId` + `alphaIndex` |
| 透明像素写深度 | `material.disableDepthWrite = true` |
| 每个 Mesh 一个 `ActionManager` | 一个 `scene.onPointerObservable` + `pick` |
| 手写屏幕→世界换算 | `scene.pick` / `createPickingRay` + 平面求交 |
| 用 Mesh 碰撞回写 `ship.x/y` | 2D 碰撞留在模拟层（胶囊/圆），渲染层只读 |
| 用 layer 名字前缀排序 | 显式 `registerGuiLayer(adt, role)` 登记顺序 |
| 每个场景/调试页各自 resize | 在 `createBabylonScene` 里一个 `ResizeObserver` |
| 在业务渲染器里 `new Light` | 场景创建处统一建灯 |
| 只看第一个法线判断朝向 | 法线 Z 求和 + `flipFaces(true)` |
| 静态材质每帧重编译 | `material.freeze()` |

---

## 11. 自查命令与三问

```bash
# 每帧 new Mesh / dispose Mesh
rg "Create(Dashed)?Lines|disposeNavLine|MeshBuilder\.Create" src

# 每帧重绘贴图
rg "texture\.update\(\)|DynamicTexture" src

# 每个对象一份材质
rg "createSpriteMaterial\(" src

# 手写坐标换算 / 引擎拾取
rg "screenToWorld|scene\.pick|Unproject|createPickingRay" src

# 渲染层回写游戏状态
rg "moveWithCollisions|ellipsoid|checkCollisions|collisionsEnabled" src
```

**自查三问**：

1. 这个对象是「每帧都在变」还是「只变一次」？每帧变的，优先考虑 `instance` / 粒子 / 变换节点，而不是重建。
2. 这份数据是谁的权威？如果权威在游戏层，就不要让 Mesh 来修正它（反之亦然）。
3. 这个「图层」是用什么表达的？同一个项目里只保留一套（`renderingGroupId` / `alphaIndex` 或 Z），不要混。

---

## 12. 已确认的 Babylon 9.31 行为

- `SolidParticleSystem.buildMesh()` **不会**调用 `initParticles()`，只有 `start()` 会。
- `SolidParticle.props` 默认是 `null`，需要自己初始化。
- `SolidParticleSystem` 在 `isVisible=false` 时会把顶点归零并标记 `_stillInvisible`，再次可见会恢复。
- `StandardMaterial` 的顶点色只影响 diffuse，不影响 emissive。
- `CreateDashedLines` 支持 `updatable` + `instance`，但只能改点位，不能改点数量。
- `LinesMesh` 支持原生 `color / alpha / isPickable`，也会接受外部材质（内部会设 `fillMode`）。
- `Scene` 构造时自动 `attachControl()`。
- `ParticleSystem.particleTexture` 接受 `BaseTexture`（`DynamicTexture` 可直接用）。
- `SpriteManager.texture` 可写，但构造函数只收 URL / 打包图集，不能直接传 `DynamicTexture`。
- `AdvancedDynamicTexture.CreateFullscreenUI(name, foreground)` 的 `foreground` 只控制场景前/后；多个前景 ADT 之间的顺序仍由 `scene.layers` 数组顺序决定。
- Babylon 世界矩阵是 `Scale → Rotation → Translation`（`Matrix.ComposeToRef`），本地轴缩放和世界轴缩放不能想当然。
- 透明子网格排序：先按 `mesh.alphaIndex` 升序，再按到相机距离从远到近（`RenderingGroup.defaultTransparentSortCompare`）。
- ThinInstance 的实例矩阵用 `Matrix.Compose(scale, quaternion, position)` 生成；只绕 Z 转时用 `Quaternion.RotationYawPitchRoll(0, 0, angle)` 与 `mesh.rotation.z` 等价。
- `scene.pick` / `scene.createPickingRay` 的 x/y 是 canvas CSS 像素（`clientX - rect.left`），不是 render-buffer / DPR 像素。
- 多个 `AdvancedDynamicTexture` 的层级顺序就是 `scene.layers` 的数组顺序；`Layer` 没有公开的 moveToTop，显式登记 + 重排最稳。
- GUI 的 `isPointerBlocker` 会设置 `PointerInfo.skipOnPointerObservable`，但该标志主要给 pre-pointer 流程用；不要依赖它自动阻止你自己注册的 `onPointerObservable` 观察者。
- `ParticleSystem.manualEmitCount`、`updateSpeed`、`colorDead` 均存在；`particleTexture` 接受 `BaseTexture`。
- `GreasedLine`（`CreateGreasedLine` + `setPoints`）是 Babylon 现在推荐的粗线/虚线方案，适合需要宽度或发光的线。
- `mesh.thinInstanceCount` 只能设到 `matrix buffer length / 16` 以内；`thinInstanceSetBuffer` 默认会把 count 设成容量，记得自己改回实际数量。

---

## 13. 待办 TODO

- [ ] **碰撞单测与手感**：为 `game/collision.ts` 补 4 个纯逻辑单测（正面撞岛、斜擦岛、船船互推、2x dt 高速），并用现有 `P` 参数 / `collisionRadius` 校准贴岸手感。
- [ ] **海岸线形状**：岛礁仍用 `collisionRadius` 的圆近似，和 `islandRadiusAt()` 的不规则岸线有偏差；以后可以采样成凸多边形做碰撞。
- [ ] **高速扫掠**：当前是「每帧推出重叠」，不是连续扫掠；加很小/很薄的障碍或把固定步长的 dt 调大时，补 segment-sweep 防穿模。
- [ ] **单 ADT（可选）**：GUI 现在是显式 registry 维护多 ADT 顺序；UI 层继续变多时，可合并成一个全屏 ADT + 容器 `moveToTop()`。
- [ ] **GUI 点击穿透**：Modal 已通过 `ui-state.ts` 阻止输入，但 HUD 的小按钮（2x）仍可能把点击透传到场景；真出现误选时，再加「指针是否落在 UI 上」的显式开关。
- [ ] **框选/编队**：`bindPointerInput` 已经是统一状态机入口，Phase 2 的框选、拖拽、右键队列直接在这里扩展。
- [ ] **hover 拾取成本**：`POINTERMOVE` 每次都 `scene.pick`；单位数量上来后加节流或 `scene.skipPointerMovePicking`。
- [ ] **输入源统一**：WASD 用 `globalThis`，F 键用 `scene.onKeyboardObservable`；以后最好只留一套，避免 UI 输入与场景输入互相干扰。
