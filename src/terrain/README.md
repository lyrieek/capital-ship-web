# terrain 模块说明

状态：岛屿 / 礁石 / 船厂都是 Babylon 原生网格；舰船与地物碰撞走纯 2D 几何；船厂落位在**地图加载时**校验，配置错误直接抛 `MapConfigError`。

## 1. 最重要的几个决定

1. **不用 Canvas 贴图，用真实网格 + 顶点色。**
   正交俯视下贴图看起来没问题，但相机一旦抬高或切成斜视角，贴图就会变成贴在海面上的一张纸片：没有体积、没有遮挡，也接不住光照和炮弹。现在岛屿、礁石、船厂都是真实网格。

2. **玩法层与渲染层分离。**
   碰撞、摆船、进厂检测、船厂校验全部使用纯数学数据（`TerrainField` / `TerrainItem`），不依赖 Babylon；Babylon 只负责把数据画出来。这样碰撞和校验可以单独跑、单独测，也不用为了检查一个配置去启动渲染。

3. **岸线只有一份实现。**
   岛屿 3D 网格、小地图、船厂落位校验都调用 `coastline.ts` 的 `islandRadiusAt()`。不要在小地图或校验器里另写一套近似圆，否则“小地图正确、大地图错误”的 bug 会反复出现。

4. **船厂占地只有一份实现。**
   `shipyard-zone.ts` 同时定义陆域设施占地（`SHIPYARD_LAND_BOXES`）和船坞检测区（`SHIPYARD_ZONE`）。主场景渲染、小地图、落位校验都引用这份数据。

## 2. 目录与职责

```
src/terrain/
  index.ts          // barrel
  types.ts          // TerrainKind、TerrainItem、TerrainBounds：不依赖 Babylon / 游戏层
  spec.ts           // TERRAIN_SPECS：半径、高度、碰撞半径、配色
  coastline.ts      // 岸线参数化函数（纯数学，无 Babylon）
  layout.ts         // 归一化摆位、三张地图的地形布局、createTerrainItems()
  shipyard-zone.ts  // 船厂陆域占地、船坞矩形、本地↔世界坐标
  shipyard-check.ts // 船厂落位校验：陆域在陆、船坞在水、接缝贴岸
  field.ts          // TerrainField：陆地查询、距离、船厂进厂检测、避让
  island.ts         // 岛屿网格 + 材质；重新导出 islandRadiusAt()
  reef.ts           // 礁石网格 + 材质
  shipyard.ts       // 船厂网格 + 材质（使用 shipyard-zone.ts 的占地）
  render.ts         // createTerrainRender()：Mesh 增删、变换、冻结、dispose
```

新增一种地物 = 加 kind + 一条 spec + 一个网格文件 + 在 `render.ts` 的 `FACTORIES` 里登记。

## 3. 坐标约定（踩过坑，重点看）

- 世界坐标：原点左上，**Y 向下**，1 世界单位 ≈ 1 屏幕像素。
- 场景坐标：原点居中，**Y 向上**，由 `babylon/coords.ts` 的 `worldToScene()` 换算。
- 高度轴是 Z：海平面是 XY 平面，相机在 `-Z` 看向 `+Z`，所以“越高”= Z 越小。岛屿几何的 z 从 `0`（岸线）到 `-height`（岛顶）。
- 平面旋转统一用世界角度（Y 向下、顺时针为正）。**应用到 Babylon 网格时必须取反**：

```ts
mesh.rotation.z = -(item.rotation ?? 0);
```

漏掉这个负号的后果：位置由 `worldToScene()` 正确翻转，但朝向没有翻转，船厂会在地图里镜像——靠陆的一侧跑到水里，靠海的一侧跑到岸上。小地图用世界坐标绘制，所以小地图正确、大地图错误。校验器也用世界坐标，因此同样看不出这个问题。

## 4. 地形数据与摆位

- `layout.ts` 中的 `TerrainPlacement` 使用归一化坐标 `u/v`（0..1），与具体世界尺寸解耦。
- `createTerrainItems(worldWidth, worldHeight, layout)` 把归一化摆位展开成世界坐标的 `TerrainItem`。
- `seed` 缺省由摆位顺序派生，保证同一个布局每次生成的岛形完全一致。
- 三张内置地图分别使用 `DEFAULT_TERRAIN_LAYOUT`、`STRAIT_TERRAIN_LAYOUT`、`ARCHIPELAGO_TERRAIN_LAYOUT`。
- 摆位注意事项：
  - 不要压住双方出生带（`game/RestrictAreaImpl` 的 `SPAWN_BAND_X / SPAWN_BAND_Y`）；
  - 中央至少保留一条可通行航道；
  - 船厂必须跨在岸线上，不能浮在海里或整座埋进岛里。

## 5. 船厂

### 5.1 几何

本地坐标 `+X` 指向水面，`-X` 指向陆地：

```
        陆地（岛）                 水面
   ┌──────────────┐   ┌───────────────────────┐
   │  船台 / 仓库  │   │                       │
   │  码头  吊车  │   │      船坞（检测区）    │  ← +X 朝水
   └──────────────┘   └───────────────────────┘
        -X 侧                 +X 侧
```

- 陆域设施：码头、两座船台/仓库、吊车基座。占地由 `SHIPYARD_LAND_BOXES` 定义。
- 吊车吊臂伸向水面，属于水上结构，不计入陆域占地。
- 船坞检测区：`SHIPYARD_ZONE`，由 `shipyardZoneLocal()` 换算成世界单位。
- 船厂整体 `solid = false`，因为船坞必须能让船开进去；靠陆的一侧由岛的碰撞挡住。
- **渲染和校验共用占地数据**：`shipyard.ts` 直接遍历 `SHIPYARD_LAND_BOXES` 建盒子，小地图和 `shipyard-check.ts` 也使用同一份。不要在主场景里另写 `0.45r / 0.9r` 之类的魔法数。

船厂网格使用**未缩放**的本地坐标，`item.scale` 由渲染层的 `mesh.scaling` 统一处理。不要在 `createShipyardMesh()` 里提前乘 scale，否则会缩放两次。

### 5.2 进厂检测（玩法）

`TerrainField.checkShipyard(x, y)` 返回：

| 字段 | 含义 | 判定 |
| --- | --- | --- |
| `inZone` | 在船坞检测区里 | 点落在 `shipyardZoneLocal()` 矩形内（跟着 rotation 旋转） |
| `onWater` | 靠海 | 船心不在任何 solid 地物上 |
| `nearLand` | 靠陆 | 到最近岸线距离 ≤ `QUAY_RANGE`（150） |
| `docked` | 进厂 | `inZone && onWater && nearLand` |

只靠海不靠陆 = 路过门口的船；只靠陆不靠海 = 搁在岸上的残骸；两个都不算进厂。

### 5.3 落位校验（地图加载期）

`shipyard-check.ts` 不靠视觉截图，也不等场景建立。它使用与 3D 网格相同的参数化岸线做解析采样：

1. **陆域在陆**：对每个陆域占地矩形的多个采样点，要求落在岛上；允许极小越界（默认 8 世界单位），用于吸收“碰撞半径比视觉岸线大”的差值。
2. **船坞在水**：船坞矩形采样点必须避开所有 solid 地物的碰撞半径（默认留 2 单位），同时不能压进实际海岸线（默认容差 5）。
3. **紧贴**：
   - 陆域占地的最外缘和船坞内缘必须共用同一条边（几何不变量，留缝或重叠都会报错）；
   - 陆域/船坞接缝到实际岸线的偏差不能超过阈值（默认 18）。

默认阈值在 `ShipyardCheckOptions` 里，可按地图调整；校验错误会带上具体设施、采样点和距离。

`GameMap` 构造时会调用 `validateTerrainLayout()`，三张内置地图只要船厂摆错，**应用加载时就会抛 `MapConfigError`**，不会等到进游戏才看到船厂漂在水里。

Babylon 的 `scene.pick` / 射线拾取 / `mesh.intersectsMesh` 当然能做网格级检查，但它们需要已建立的场景和渲染网格，不适合地图加载期的配置校验。这里的解析几何使用与网格相同的岸线函数，结果确定、速度快，而且能在场景创建前失败。

### 5.4 摆位经验

- 船厂不要再按固定的“岛心 + 175”拍脑袋放。实际岸线有抖动，碰撞半径又比视觉岸线大，固定偏移很容易让码头压水或船坞埋进沙滩。
- 当前做法：以岛屿中心为基准，沿朝水面方向调整距离和旋转，再用 `shipyard-check.ts` 校验通过后才写回布局。
- 调整船厂后，至少检查三件事：
  1. `validateTerrainLayout()` 返回 OK；
  2. 小地图上的船厂朝向与主场景一致；
  3. 主场景里青色船坞框完整落在水面上，陆域设施不悬空。

## 6. 碰撞与避让

| 场景 | 负责模块 |
| --- | --- |
| 航行时贴岸、被岛挡住 | `game/collision.ts`：舰船胶囊 vs `TerrainField` 圆 |
| 撞上之前提前拐弯 | `TerrainField.avoidAngle()` / `avoidSide()` |
| 炮弹撞岛 / 落水 | `weapons/update.ts` 查询 `field.isBlockedCircle()` |

- 模拟层不依赖 Babylon Mesh 扫掠：每帧把重叠的船推出地形，渲染层只读 `ship.x/y`。
- 手动航行：先算期望角，再让 `avoidAngle()` 依次尝试 `0 / ±25° / ±50° / ±75° / ±100°`；全部挡住时返回期望角，交给碰撞推出兜底。
- 自动巡航只沿 X 走，所以避让体现为提前换水道；换道后要同步更新 `baseY`，否则回正时会把船拽回原来的航线。
- `isPathBlocked()` 在 `0.45 / 0.75 / 1.0` 三个距离采样，避免礁石正好落在采样点之间被漏掉。

## 7. 渲染

- 渲染分组：组 0 = 海面，组 1 = 地物 + 舰船，组 2 = HUD / 特效。地物必须在组 1，否则会被海面盖住。
- 顶点色烘进网格：岛屿的沙滩/草地、船厂的混凝土/警示黄/亮青，一份材质即可。
- 光照由 `babylon/scene.ts` 的场景级光源负责，地形渲染器不自己建灯。
- 静态优化：`sync` 后冻结世界矩阵；碰撞系统直接使用已经算好的世界坐标数据。
- 地物不挂 Babylon 物理碰撞；`solid` 只决定是否参与 `TerrainField` 的 2D 查询。

## 8. 小地图

- 绘制顺序：海面 → 地形 → 网格 → 限制区 → 舰船 → 视口。
- 岛屿用 `islandRadiusAt()` 绘制真实岸线，并加沙滩描边。
- 船厂按世界角度旋转，陆域设施画 `SHIPYARD_LAND_BOXES`，船坞画 `shipyardZoneLocal()`，和主场景、校验器完全同源。
- 礁石用 `spec.radius` 的简化圆点。
- 可以点击/拖动小地图移动相机；排查船厂时，直接点小地图上的船厂位置，再对比主场景。

## 9. 开发与验证

```bash
pnpm lint      # oxfmt --check + oxlint + tsc --noEmit
pnpm build
```

地图加载时的船厂校验会在 `GameMap` 构造阶段执行。也可以在 Node 里单独跑：

```bash
pnpm dlx tsx -e "import { DEFAULT_TERRAIN_LAYOUT } from './src/terrain/layout.ts'; import { validateTerrainLayout } from './src/terrain/shipyard-check.ts'; console.log(validateTerrainLayout(DEFAULT_TERRAIN_LAYOUT, 5120, 2880));"
```

排查船厂问题的顺序：

1. 看 `MapConfigError` 的具体错误，确认是陆域压水、船坞压陆、船坞离岸太远还是接缝偏移；
2. 检查 `rotation` 是否指向水面；主场景里是否已经取反；
3. 检查是否误用了旧的固定偏移或重复写死的占地尺寸；
4. 修正后重新跑 `validateTerrainLayout()`，再进游戏看小地图与主场景。

## 10. 后续 TODO

1. **岛屿外形**：现在偏规则，可以加低频起伏、岬角、内湾。
2. **礁石**：换成带水下部分的几何，而不是纯水面岩块。
3. **船厂细节**：龙门吊、船台滑道、堆场、被击毁后的残骸。
4. **碰撞形状**：圆碰撞换成沿形状的多边形，`spec.collisionRadius` 可以收回到 `radius` 附近。
5. **进厂玩法**：把 `checkShipyard()` 接进 Game（维修 / 补给 / 计时），HUD 提示“靠海 / 靠陆”。
6. **playground**：补 `TestTerrain.tsx`、路由和词条，方便单独调地形。
7. **性能**：地物多时改 thin instance / 静态合批；`game/collision.ts` 目前每帧全量遍历地物，地物多了要加空间索引。
8. **结构重构**：`game/world.ts` 上移、`P` 进配置目录、`paintHull` 移到 `ship/texture.ts` 等，属于纯搬迁，建议单独一轮做。

## 11. 约定

- 文件名 kebab-case，模块内 `index.ts` 做 barrel。
- 参数表集中在 `spec.ts`（对齐 `WEAPON_SPECS`）。
- 中文注释；导出成员用 `/** */`，分段用 `//`。
- 所有会改变视觉或校验结果的几何常量，必须只保留一份，由渲染、小地图、校验共同引用。
- `oxlint` 的 `no-warning-comments` 会对 TODO 报 warn（不阻断），这是有意保留的。
