// 面板宽度布局常量与纯函数（F2 左栏拖拽）。
// 纯逻辑：无 React / 无 @/ 依赖，可被 hook 与 node:test 复用。

export const MOBILE_MAX_WIDTH = 640;
export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;

export function clampPanelWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min;
  if (width < min) return min;
  if (width > max) return max;
  return width;
}

export interface SidebarMaxWidthOptions {
  viewportWidth: number;
}

// 桌面端为聊天区保留最小宽度（320），避免侧栏把聊天挤压到不可读；
// 移动端（<= MOBILE_MAX_WIDTH）不受聊天区约束，直接使用 SIDEBAR_MAX_WIDTH。
export function getSidebarMaxWidth({ viewportWidth }: SidebarMaxWidthOptions): number {
  if (viewportWidth <= MOBILE_MAX_WIDTH) return SIDEBAR_MAX_WIDTH;
  const chatMinWidth = 320;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, viewportWidth - chatMinWidth));
}
