// 运行时渲染视口：跟随浏览器可用空间，固定 16:9，最低 MIN_VIEW_W x MIN_VIEW_H。
import { MIN_VIEW_H, MIN_VIEW_W, VIEW_ASPECT_H, VIEW_ASPECT_W } from "./world";

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * 把可用区域（CSS 像素）按 16:9 等比放到最大。
 * 可用区域无效或小于最低要求时返回 null，调用方应拒绝渲染并提示用户。
 */
export function fitViewport(availableWidth: number, availableHeight: number): ViewportSize | null {
  if (!(availableWidth > 0) || !(availableHeight > 0)) return null;

  const scale = Math.min(availableWidth / VIEW_ASPECT_W, availableHeight / VIEW_ASPECT_H);
  const width = Math.floor(scale * VIEW_ASPECT_W);
  const height = Math.floor(scale * VIEW_ASPECT_H);
  if (width < MIN_VIEW_W || height < MIN_VIEW_H) return null;
  return { width, height };
}
