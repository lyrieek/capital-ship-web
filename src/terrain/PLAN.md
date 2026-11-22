# terrain 模块设计（岛屿 / 礁石 / 船厂）

> 状态：**第四轮**。岛屿 / 礁石 / 船厂都是 Babylon 原生网格；舰船与地物的碰撞走 `game/collision.ts` 的纯 2D 胶囊 vs 圆；
> 舰船遇到岛礁会**提前避让**；船厂有「同时靠海 + 靠陆」的进厂检测；小地图已经画出地形与船坞。

## 1. 为什么不用 Canvas 贴图（本模块最重要的决定）

第一版用 `DynamicTexture` + Canvas 2D 画贴图，这是**错的**：

- 现在是正交俯视，贴图看不出问题；
- 但以后相机会抬高、切成斜视角 / 环绕视角，贴图立刻变成「贴」在海面上的一张纸片——没有体积、没有遮挡、也接不住炮弹和舰船；
- 贴图也拿不到真实法线，光照、阴影、雾化全都对不上。

现在全部改成 **Babylon 原生网格 + 顶点色**：

| 地物 | 几何                                              | 材质                                           |
| ---- | ------------------------------------------------- | ---------------------------------------------- |
| 岛屿 | 自建 `VertexData`（同心环 + 抖动岸线 + 高度剖面） | `StandardMaterial` + 顶点色（沙滩/草地）+ 受光 |
| 礁石 | 4 个 `CreatePolyhedron` 压扁后 `Mesh.MergeMeshes` | `StandardMaterial` 湿岩灰                      |
| 船厂 | 码头 / 船台 / 吊车 / 船坞检测框，`CreateBox` 合并 | 顶点色（混凝土 / 警示黄 / 亮青）+ 受光         |

## 2. 目录与职责

```
src/terrain/
  index.ts          // barrel
  types.ts          // TerrainKind、TerrainItem、TerrainBounds：不依赖 Babylon / 游戏层
  spec.ts           // TERRAIN_SPECS：半径、高度、碰撞半径、占位配色
  layout.ts         // TerrainPlacement（含 rotation）+ DEFAULT_TERRAIN_LAYOUT + createTerrainItems()
  shipyard-zone.ts  // 船厂检测区（纯数学）：矩形、世界↔本地坐标、点是否在区内
  field.ts          // TerrainField：isBlockedCircle / distanceToLand / checkShipyard / 避让
  island.ts         // 岛屿网格 + 材质 + islandRadiusAt()（渲染与小地图共用岸线）
  reef.ts           // 礁石网格 + 材质
  shipyard.ts       // 船厂网格 + 材质（检测框就是 shipyardZoneLocal()）
  render.ts         // createTerrainRender()：Mesh 增删、变换、材质冻结、dispose（光照在 babylon/scene.ts）
```

新增一种地物 = 加 kind + 一条 spec + 一个文件 + 在 `render.ts` 的 `FACTORIES` 里登记。

## 3. 坐标约定

- 世界坐标：原点左上、Y 向下，1 世界单位 ≈ 1 屏幕像素。
- 场景坐标：居中、Y 向上，由 `babylon/coords.ts` 的 `worldToScene()` 换算。
- **高度轴是 Z**：海平面是 XY 平面，相机在 `-Z`（`positionZ = -100`）看向 `+Z`，
  所以「越高」= Z 越小（更靠近相机）。岛屿几何的 z 从 `0`（岸线）一直负到 `-height`（岛顶）。
- 旋转用 `rotation.z`：绕 Z 转 = 在海平面内打转。

## 4. 船厂

### 4.1 为什么这么画

进厂检测的判定是**同时靠海 + 靠陆**，所以几何本身按这个逻辑摆：

```
        陆地（岛）                 水面
   ┌──────────────┐   ┌───────────────────────┐
   │  船台 / 仓库  │   │                       │
   │  码头  吊车  │   │      船坞（检测区）    │  ← +X 朝水
   └──────────────┘   └───────────────────────┘
        -X 侧                 +X 侧
```

- 码头 / 船台 / 吊车压在岸线上（本地 `-X`），`solid = false`，靠岛的碰撞挡住船；
- 船坞朝水面（本地 `+X`），**必须能开进去**，所以船厂整体 `solid = false`；
- 船坞四周的亮青色框就是检测区，用的是 `shipyardZoneLocal()`，和 `field.checkShipyard()` 判定的是同一个矩形。

### 4.2 检测规则

`TerrainField.checkShipyard(x, y)` 返回四项：

| 字段       | 含义           | 判定                                                          |
| ---------- | -------------- | ------------------------------------------------------------- |
| `inZone`   | 在船坞检测区里 | 点落在 `shipyardZoneLocal()` 矩形内（跟着 `rotation` 一起转） |
| `onWater`  | **靠海**       | 船心不在任何 `solid` 地物上（`!isBlockedCircle(x, y, 0)`）    |
| `nearLand` | **靠陆**       | 到最近岸线的距离 ≤ `QUAY_RANGE`（150）                        |
| `docked`   | 进厂           | `inZone && onWater && nearLand` —— **缺一个都不成立**         |

实测（`shipyard` 在岛 A 水线外）：

| 位置     | inZone | onWater | nearLand      | docked |
| -------- | ------ | ------- | ------------- | ------ |
| 船坞中心 | ✅     | ✅      | ✅（离岸 50） | ✅     |
| 码头上   | ❌     | ❌      | ✅            | ❌     |
| 外海     | ❌     | ✅      | ❌            | ❌     |

- 只靠海不靠陆 → 那是路过门口的船，不算进厂；
- 只靠陆不靠海 → 那是搁在岸上的残骸，也不算。

### 4.3 摆位

`layout.ts` 里两个船厂分别贴在岛 A / 岛 C 靠地图中心的一侧：

```
位置 = 岛心 + 「从岛指向地图中心」的单位向量 × 175
rotation = 同一个方向角（本地 +X 朝水）
```

175 ≈ 岛的水下坡外缘，所以码头刚好压在岸线上、船坞朝外。

## 5. 碰撞与避让

### 5.1 两套系统分工

| 场景                   | 谁负责                                                           |
| ---------------------- | ---------------------------------------------------------------- |
| 航行时贴岸、被岛挡住   | **2D 碰撞**：`game/collision.ts` 的舰船胶囊 vs `TerrainField` 圆 |
| 撞上去**之前**提前拐弯 | `TerrainField.avoidAngle()` / `avoidSide()`（本模块，纯数学）    |
| 炮弹落点               | 以后在 `weapons/update.ts` 调 `field.isBlocked(x, y)`            |

碰撞不再依赖 Babylon 的 Mesh 扫掠：模拟层用「胶囊 vs 圆」每帧推出重叠，渲染层只读 `ship.x/y`。
避让仍然发生在撞上之前，避免船一头顶死在岸上。

### 5.2 提前避让

**A. 手动航行指令**（`game/movement.ts` 的 `updateSailOrder`）

```
期望角 = atan2(目标 - 当前位置)
实际角 = field.avoidAngle(当前位置, 期望角, 半舰宽 + 12)
```

`avoidAngle()` 依次尝试 `0 / ±25° / ±50° / ±75° / ±100°`，返回第一个前方通畅的角度；
全部挡住时返回期望角，交给 `game/collision.ts` 的推出兜底（至少不会卡死）。

**B. 自动巡航**（`ship/index.ts` 的 `applyTerrainAvoidance`）

`normal` 状态只沿 X 走，所以「拐弯」体现为**提前横移换一条水道**：

```
side = field.avoidSide(x, y, dir, 半舰宽 + 12, 前视 170, yMin, yMax)  // -1 / 0 / 1
y += side * 速度 * dt
baseY = y   // 把新水道记成基准航线，否则回正时会把船拽回原来的航线，又撞回岛上
```

- 必须放在 `steerTowardTarget()` **之后**，否则向目标车道靠拢的位移会把船又推回岛前；
- 前视距离 `TERRAIN_AVOID_LOOK_AHEAD = 170`（约 2.8 秒航程，足够转完一个弯）。

**C. 路径探测**

`isPathBlocked()` 在 `0.45 / 0.75 / 1.0` 三个距离采样，避免礁石正好落在采样点和船之间时被漏掉。

实测：岛 A 正前方 80 单位处，`isPathBlocked` = true，`avoidAngle` 从 -90° 偏到 -15°（+75°），成功绕开。

### 5.3 贴岸推出

`game/collision.ts` 的 `resolveShipTerrain()` 把船近似为「沿航向的线段 + 半舰宽」，
逐岛求线段到圆心的最近点；重叠时把船沿法线推出去，多跑几轮处理两座岛夹角。
`resolveCollisions()` 的顺序是：舰船互推 → 地形推出 → 边界 clamp。
这是纯数学、可单测的；以后换成 3D 船模也不需要改这里。

## 6. 渲染管线

- **渲染分组固定 1（`RG_SHIP`）**：组 0 = 海面 → 组 1 = 地物 + 舰船 → 组 2 = HUD / 特效。
- **顶点色**：岛屿的沙滩/草地、船厂的混凝土/警示黄/亮青都烘进顶点色，一份材质搞定。
- **光照**：场景级 `HemisphericLight` 在 `babylon/scene.ts` 创建，方向 `(-0.35, 0.45, -1)`（朝相机侧）；地形渲染器不再自己建灯。
- **静态优化**：`sync` 后 `freezeWorldMatrix()`；冻结后世界矩阵已算好，碰撞系统直接可用。
- **碰撞数据**：地物不挂 Babylon 碰撞；`solid` 只决定它是否参与 `TerrainField` 的 2D 碰撞（船厂 `solid = false`，船坞可进入）。

## 7. 小地图（`components/Minimap.tsx`）

- 顺序：海面 → 地形 → 网格 → 限制区 → 舰船 → 视口；
- 岛屿用 `islandRadiusAt()` 画真实岸线 + 沙滩描边；
- 船厂按 `rotation` 旋转后画「码头实心块 + 船坞检测框」，和主场景同一个矩形；
- 礁石用 `spec.radius` 的简化圆点。

## 8. 后续 TODO（按顺序）

1. **岛屿外形**：现在偏规则，加低频起伏、岬角、内湾。
2. **礁石**：换成有水下部分的几何。
3. **船厂**：加龙门吊、船台滑道、堆场；被击毁时换残骸。
4. **碰撞形状**：圆碰撞换成沿形状的多边形，`spec.collisionRadius` 就能收回 `radius` 附近。
5. **炮弹被陆地挡下**：`weapons/update.ts` 落点判定前加一次 `field.isBlocked(x, y)`。
6. **进厂玩法**：把 `checkShipyard()` 接进 Game（维修 / 补给 / 计时），并在 HUD 上提示「靠海 ✓ 靠陆 ✗」。
7. **playground**：`TestTerrain.tsx` + `App.tsx` 路由 + `locales` 词条。
8. **性能**：地物多时改 thin instance 或静态合批；`game/collision.ts` 目前是每帧全量遍历地物，地物多了要加空间哈希/网格索引。

## 9. 结构重构建议（本次仍未做）

`game/world.ts` → `src/world.ts`、`P` → `src/config/`、`paintHull` → `ship/texture.ts`、
`babylon/sprite.ts` 反向依赖、`ship/ship.d.ts`。这些是纯搬迁 + 改 import，建议单独一轮。

## 10. 约定

- 文件名 kebab-case（oxlint `unicorn/filename-case`），模块内 `index.ts` 做 barrel。
- 参数表集中在 `spec.ts`（对齐 `WEAPON_SPECS`）。
- 中文注释；导出成员用 `/** */`，分段用 `//`。
- 校验命令：`pnpm lint`（= `oxfmt --check` + `oxlint` + `tsc --noEmit`）。
- `oxlint` 的 `no-warning-comments` 会对 TODO 报 warn（warn 级，不阻断），这是有意为之。
