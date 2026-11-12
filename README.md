# 舰艇模拟战

基于 Vite、React、TypeScript 和 Babylon.js 的俯视角海战模拟游戏。玩家可以观察红蓝两支舰队自动交战，也可以选择舰船下达航行和攻击指令。

## 当前功能

- 红蓝双方各有两艘舰船；舰船巡航寻找敌舰，并自动使用主炮和鱼雷交战。
- 鱼雷会触发舰船规避机动；舰船受损时会冒烟，生命值越低，烟雾出现越频繁。
- 舰船互相碰撞时会被推开；命中、爆炸、炮弹落海和烟雾均有粒子效果。
- 舰船有生命条、选中圈、炮塔转向、命中闪光和规避状态显示。
- 一方被全歼后仍会结算飞行中的弹药，并等待 3 秒再判定胜负；若等待期间双方全灭则判为平局。
- 游戏结束后点击画面重新开始。
- 支持中英文界面。默认海域为浅海；海洋测试页可预览和切换海域类型。

## 操作

- 左键选择舰船；按住 Shift 并左键可多选。
- 右键点击海面，让选中的舰船驶向目标位置。
- 将鼠标移到目标位置后按 F，命令选中舰船向该位置齐射；手动攻击有 2.5 秒公共冷却。
- 游戏结束后点击画面重新开始。

## 页面

- `/`：主战场。
- `/hub`：HUD 预览与测试。
- `/expanse`：海域外观测试及海域类型切换。
- `/weapons`：武器参数与弹道测试。
- `/ship`：舰船行为和外观测试。

## 技术栈

- React 19、TypeScript 7、Vite 8。
- Babylon.js：正交俯视场景、舰船与粒子渲染；部分绘图资源使用 `DynamicTexture`。
- React Router：页面路由。
- i18next、react-i18next：中英文界面，默认中文。
- pnpm：包管理。

## 安装与运行

```bash
pnpm install
pnpm dev       # 本地开发服务器，默认 http://localhost:5173
pnpm build     # 生产构建
pnpm preview   # 预览生产构建
pnpm lint      # 格式检查和 Oxlint
```

## 主要代码入口

- `src/game/Game.ts`：对局初始化、更新循环、碰撞、粒子和结束判定。
- `src/game/utils.ts`：战场尺寸及舰船移动、转向、规避等参数 `P`。
- `src/weapons/spec.ts`：主炮和鱼雷的伤害、射程、速度、冷却等武器参数。
- `src/ship/index.ts`：舰船 AI、伤害和受损烟雾。
- `src/game/render.ts`、`src/ship/render-visual.ts`：Babylon.js 场景同步和舰船视觉资源。
- `src/expanse/`：海域状态、海面渲染和海洋着色器。
- `src/playground/`：HUD、海域、武器和舰船测试页面。

项目目前没有单独配置自动化测试脚本；可用 `pnpm build` 和 `pnpm lint` 检查构建与代码规范。
