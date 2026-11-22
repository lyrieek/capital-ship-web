// UI 阻塞计数：模态/遮罩打开时，场景级指针输入应暂停，避免「点 UI 也选了船」。
// 用计数而不是布尔值，允许多个 UI 同时声明阻塞。
let blockers = 0;

export function pushUiBlocker(): void {
  blockers += 1;
}

export function popUiBlocker(): void {
  blockers = Math.max(0, blockers - 1);
}

export function isUiBlocking(): boolean {
  return blockers > 0;
}
