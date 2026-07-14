/**
 * 持久化抽象层（方案 A 数据 2.2 方案 3）。
 *
 * P1 默认实现：localStorage + BroadcastChannel（跨标签实时同步）。
 * 未来切换：new RouteHandlerSettingsAdapter('/api/settings')，hooks/useSettings.ts
 * 零业务改动。
 *
 * ponytail: 不实现 RouteHandlerAdapter stub——P1 仅留接口位，等真正服务端化需求出现
 *   再迭代；当前 lib/api-types.ts 也没契约。
 */

import type { PluginSettings } from "./config-schema";

const STORAGE_NAMESPACE = "pi-web:settings:";
const CHANNEL_NAME = "pi-web:settings";

/** 持久化层契约。read/write 是异步（未来服务端化统一签名），subscribe 同步订阅。 */
export interface SettingsStorageAdapter {
  /** 返回 null 表示该插件尚未写入过任何设置（区别于"空对象"）。 */
  read(pluginId: string): Promise<PluginSettings | null>;
  /** 写入前在 adapter 边界兜底 __unknown / values 字段。 */
  write(pluginId: string, settings: PluginSettings): Promise<void>;
  /**
   * 订阅同一浏览器跨标签 / 同标签内的变更。
   * 返回 unsubscribe 闭包，调用一次永久移除监听。
   */
  subscribe(pluginId: string, listener: (settings: PluginSettings) => void): () => void;
}

/** ponytail: SSR 安全检测，server 端无 window/localStorage 时 channel 返回 null */
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(CHANNEL_NAME);
}

/** 兜底缺省结构，避免下游拿到 undefined.xxx 的运行时炸裂。 */
function normalize(raw: unknown): PluginSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<PluginSettings>;
  return {
    enabled: obj.enabled,
    values:
      obj.values && typeof obj.values === "object" ? (obj.values as Record<string, unknown>) : {},
    __unknown:
      obj.__unknown && typeof obj.__unknown === "object"
        ? (obj.__unknown as Record<string, unknown>)
        : {},
  };
}

/** P1 默认实现：localStorage 主存 + storage 事件 + BroadcastChannel 双通道。 */
export class LocalStorageAdapter implements SettingsStorageAdapter {
  async read(pluginId: string): Promise<PluginSettings | null> {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_NAMESPACE + pluginId);
    if (!raw) return null;
    try {
      return normalize(JSON.parse(raw));
    } catch {
      // ponytail: 解析失败按"无设置"处理，避免坏数据阻塞 UI 启动
      return null;
    }
  }

  async write(pluginId: string, settings: PluginSettings): Promise<void> {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_NAMESPACE + pluginId, JSON.stringify(settings));
    getChannel()?.postMessage({ pluginId, settings });
  }

  subscribe(pluginId: string, listener: (settings: PluginSettings) => void): () => void {
    if (typeof window === "undefined") return () => {};
    const storageKey = STORAGE_NAMESPACE + pluginId;
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== storageKey || !e.newValue) return;
      const parsed = normalize(JSON.parse(e.newValue));
      if (parsed) listener(parsed);
    };
    const bc = getChannel();
    const onChannel = (e: MessageEvent): void => {
      const data = e.data as { pluginId?: string; settings?: unknown } | null;
      if (data?.pluginId !== pluginId) return;
      const parsed = normalize(data.settings);
      if (parsed) listener(parsed);
    };
    window.addEventListener("storage", onStorage);
    bc?.addEventListener("message", onChannel);
    return () => {
      window.removeEventListener("storage", onStorage);
      bc?.removeEventListener("message", onChannel);
    };
  }
}

/** 全局默认实例。 */
export const defaultAdapter: SettingsStorageAdapter = new LocalStorageAdapter();
