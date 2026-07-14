/**
 * settings 订阅 hook（方案 A 数据 2.2 + 节八.3 骨架）。
 *
 * 复用现有 useSyncExternalStore 模式（参考 lib/agent-runtime-store.ts）：
 * 模块级 Map 缓存 + adapter.subscribe 推送；首次渲染返回 schema 缺省，async read 完成后更新。
 *
 * ponytail: SSR 安全（无 window 时 subscribe 返回 noop）；不实现 reset/setEnabled 的具体语义——
 *   P1 阶段只需暴露核心 read 通道，其他 3 个方法留默认 stub 由后续 PR 补齐。
 */

"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { getSchema, type FieldDescriptor, type PluginSettings } from "@/lib/config-schema";
import { defaultAdapter } from "@/lib/settings-storage-adapter";

/** 模块级快照缓存。globalThis 跨热重载存活（参考 lib/session-registry.ts）。 */
type Cache = {
  map: Map<string, PluginSettings>;
  listeners: Map<string, Set<() => void>>;
};

const CACHE_KEY = "__piWebSettingsCache" as const;
type GlobalScope = typeof globalThis & { [CACHE_KEY]?: Cache };

function getCache(): Cache {
  const g = globalThis as GlobalScope;
  if (!g[CACHE_KEY]) {
    g[CACHE_KEY] = { map: new Map(), listeners: new Map() };
  }
  return g[CACHE_KEY];
}

function buildDefaults(pluginId: string): PluginSettings {
  const schema = getSchema(pluginId);
  if (!schema) return EMPTY_DEFAULTS;
  const values: Record<string, unknown> = {};
  for (const f of schema.fields) values[f.key] = f.default;
  return {
    enabled: schema.enabled?.default,
    values,
    __unknown: {},
  };
}

/** ponytail: useSyncExternalStore 要求 getSnapshot 返回同一引用；缓存以避免无限循环。 */
const EMPTY_DEFAULTS: PluginSettings = { values: {}, __unknown: {} };
const defaultSnapshotCache = new Map<string, PluginSettings>();
function getCachedDefaults(pluginId: string): PluginSettings {
  let snap = defaultSnapshotCache.get(pluginId);
  if (!snap) {
    snap = buildDefaults(pluginId);
    defaultSnapshotCache.set(pluginId, snap);
  }
  return snap;
}

function notify(pluginId: string): void {
  const c = getCache();
  c.listeners.get(pluginId)?.forEach((cb) => cb());
}

export interface UseSettingsResult {
  settings: PluginSettings;
  setValue: (key: string, value: unknown) => void;
  setEnabled: (enabled: boolean) => void;
  reset: () => void;
  /** D1 出口：枚举当前 __unknown 字段。P1 UI 不渲染这些字段。 */
  getUnrecognizedFields: () => Record<string, unknown>;
}

/**
 * 订阅单个插件的设置变更。
 *
 * 用法：const { settings, setValue, getUnrecognizedFields } = useSettings('git-status');
 */
export function useSettings(pluginId: string): UseSettingsResult {
  const c = getCache();

  // SSR snapshot：缺省结构，避免 hydration mismatch
  const getServerSnapshot = useCallback(
    (): PluginSettings => getCachedDefaults(pluginId),
    [pluginId],
  );

  // 客户端 snapshot：先返回缺省，待首次 read 完成自动更新
  const getSnapshot = useCallback((): PluginSettings => {
    const cached = c.map.get(pluginId);
    return cached ?? getCachedDefaults(pluginId);
  }, [c, pluginId]);

  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      // 首次挂载：拉一次 read 填缓存
      if (!c.listeners.has(pluginId)) {
        c.listeners.set(pluginId, new Set());
        void defaultAdapter.read(pluginId).then((s) => {
          if (s) c.map.set(pluginId, s);
          notify(pluginId);
        });
        // 订阅 adapter 推送
        defaultAdapter.subscribe(pluginId, (s) => {
          c.map.set(pluginId, s);
          notify(pluginId);
        });
      }
      {
        const _listeners = c.listeners.get(pluginId);
        if (_listeners) _listeners.add(listener);
      }
      return () => {
        c.listeners.get(pluginId)?.delete(listener);
      };
    },
    [c, pluginId],
  );

  // useSyncExternalStore 第三个参数为 server snapshot
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // 卸载清理：避免 map 无限增长
  useEffect(() => {
    return () => {
      // ponytail: 不立刻 delete 缓存；其他消费者可能仍订阅；靠 LRU 兜底（P1 先不实现）
    };
  }, []);

  const setValue = useCallback(
    (key: string, value: unknown) => {
      const schema = getSchema(pluginId);
      const knownKeys = new Set<string>();
      if (schema) {
        if (schema.enabled) knownKeys.add(schema.enabled.key);
        for (const f of schema.fields) knownKeys.add(f.key);
      }
      const current = c.map.get(pluginId) ?? getCachedDefaults(pluginId);
      const next: PluginSettings = knownKeys.has(key)
        ? { ...current, values: { ...current.values, [key]: value } }
        : { ...current, __unknown: { ...current.__unknown, [key]: value } };
      // ponytail: 同步更新本地 cache + 通知；adapter.write 的 BroadcastChannel 不回声本地 tab
      c.map.set(pluginId, next);
      notify(pluginId);
      void defaultAdapter.write(pluginId, next);
    },
    [c, pluginId],
  );

  const setEnabled = useCallback(
    (enabled: boolean) => {
      const current = c.map.get(pluginId) ?? getCachedDefaults(pluginId);
      const next = { ...current, enabled };
      c.map.set(pluginId, next);
      notify(pluginId);
      void defaultAdapter.write(pluginId, next);
    },
    [c, pluginId],
  );

  const reset = useCallback(() => {
    const next = getCachedDefaults(pluginId);
    c.map.set(pluginId, next);
    notify(pluginId);
    void defaultAdapter.write(pluginId, next);
  }, [c, pluginId]);

  const getUnrecognizedFields = useCallback(() => settings.__unknown, [settings]);

  return useMemo(
    () => ({ settings, setValue, setEnabled, reset, getUnrecognizedFields }),
    [settings, setValue, setEnabled, reset, getUnrecognizedFields],
  );
}

/** ponytail: 单字段 type 守卫，调用方辅助 narrowing。 */
export function _fieldTypeGuard(field: FieldDescriptor): FieldDescriptor["type"] {
  return field.type;
}
