# 舰艇模拟战

一个基于Vite + React + TypeScript的2D海军战斗模拟游戏，使用Canvas 2D API进行渲染。

## 项目概述

模拟两支舰队（红方vs蓝方）之间的海战。舰艇具有智能AI：
- 巡逻寻找目标并开火
- 检测来袭威胁进行规避机动
- 从规避状态恢复到正常编队
- 舰艇之间碰撞推开

武器系统：主炮、鱼雷。

当一方全歼或双方同归于尽时游戏结束，点击屏幕重新开始。

## 技术栈

- 框架：Vite + React + Babylon.js
- 渲染：HTML5 Canvas 2D API
- 国际化：i18next（中英双语）
- 构建：Vite
- 包管理：PNPM

## 安装运行

```bash
pnpm install
pnpm dev   # http://localhost:5173
pnpm build
pnpm preview
```

## 自定义

调整 `src/game/utils.ts` 中的 `P` 对象修改游戏难度和武器参数。

