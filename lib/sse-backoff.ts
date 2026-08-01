/**
 * SSE 重连退避纯逻辑（无 DOM 依赖，可由 node:test 覆盖）。
 */

export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 30_000;

/**
 * 计算下一次重连延迟：指数退避并封顶，避免断网期间重连风暴拖垮服务端。
 * 传入上一次延迟；非法值（NaN / <=0）回退到基准延迟。
 */
export function nextReconnectDelay(prevMs: number): number {
  if (!Number.isFinite(prevMs) || prevMs <= 0) return RECONNECT_BASE_MS;
  return Math.min(prevMs * 2, RECONNECT_MAX_MS);
}
