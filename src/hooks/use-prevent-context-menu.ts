import { useEffect, type RefObject } from "react";

// 屏蔽 Canvas 上的浏览器默认右键菜单，避免右键移动/开火等交互时弹出系统菜单。
// 主游戏与 playground 中重复出现的 contextmenu 监听逻辑统一到这里。
export function usePreventContextMenu(canvasRef: RefObject<HTMLCanvasElement | null>): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const prevent = (event: MouseEvent) => event.preventDefault();
    canvas.addEventListener("contextmenu", prevent);

    return () => {
      canvas.removeEventListener("contextmenu", prevent);
    };
  }, [canvasRef]);
}
