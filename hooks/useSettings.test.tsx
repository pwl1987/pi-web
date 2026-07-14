/**
 * @vitest-environment jsdom
 *
 * Unit tests for hooks/useSettings.ts — getUnrecognizedFields 出口 + setValue 路由。
 * ponytail: 验证两类核心契约——已知字段写 values、未知字段写 __unknown。每个 it 用独立
 *   pluginId 避免 c.map 跨测试状态泄漏。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettings } from "./useSettings";
import type { PluginSettings } from "@/lib/config-schema";
import type { SettingsStorageAdapter } from "@/lib/settings-storage-adapter";

// mock 默认 adapter 避免 localStorage 在 jsdom 中行为差异
vi.mock("@/lib/settings-storage-adapter", async () => {
  const actual = await vi.importActual<SettingsStorageAdapter>("@/lib/settings-storage-adapter");
  const store = new Map<string, PluginSettings>();
  const listeners = new Map<string, Set<(s: PluginSettings) => void>>();
  const mockApi = {
    reset() {
      store.clear();
      listeners.clear();
    },
  };
  (globalThis as unknown as { __mockSettingsAdapter?: typeof mockApi }).__mockSettingsAdapter =
    mockApi;
  return {
    ...actual,
    defaultAdapter: {
      async read(pluginId: string) {
        return store.get(pluginId) ?? null;
      },
      async write(pluginId: string, settings: PluginSettings) {
        store.set(pluginId, settings);
        const ls = listeners.get(pluginId);
        if (ls) ls.forEach((cb) => cb(settings));
      },
      subscribe(pluginId: string, listener: (s: PluginSettings) => void) {
        let set = listeners.get(pluginId);
        if (!set) {
          set = new Set();
          listeners.set(pluginId, set);
        }
        set.add(listener);
        return () => {
          listeners.get(pluginId)?.delete(listener);
        };
      },
    },
  };
});

// 在测试 setup 后动态拿 defaultAdapter（拿 mock 版本）
async function getAdapter() {
  const mod = await import("@/lib/settings-storage-adapter");
  return mod.defaultAdapter;
}

describe("useSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      globalThis as unknown as { __mockSettingsAdapter?: { reset(): void } }
    ).__mockSettingsAdapter?.reset();
  });

  it("getUnrecognizedFields returns empty object when no unknown keys stored", () => {
    const { result } = renderHook(() => useSettings("nonexistent-a"));
    expect(result.current.getUnrecognizedFields()).toEqual({});
  });

  it("setValue routes unknown key into __unknown when schema missing", async () => {
    const { result } = renderHook(() => useSettings("nonexistent-b"));
    await act(async () => {
      result.current.setValue("someUnknownKey", "value");
      await Promise.resolve();
    });
    const unknown = result.current.getUnrecognizedFields();
    expect(unknown.someUnknownKey).toBe("value");
    expect(result.current.settings.values.someUnknownKey).toBeUndefined();
  });

  it("setValue routes unknown key into __unknown even when schema exists", async () => {
    const { result } = renderHook(() => useSettings("npm:context-mode-c"));
    await act(async () => {
      result.current.setValue("notInSchema", "x");
      await Promise.resolve();
    });
    const unknown = result.current.getUnrecognizedFields();
    expect(unknown.notInSchema).toBe("x");
  });

  it("setEnabled persists enabled flag", async () => {
    const { result } = renderHook(() => useSettings("npm:context-mode-d"));
    await act(async () => {
      result.current.setEnabled(false);
      await Promise.resolve();
    });
    const adapter = await getAdapter();
    const stored = await adapter.read("npm:context-mode-d");
    expect(stored?.enabled).toBe(false);
  });

  it("exposes schema defaults on first render when nothing stored", () => {
    const { result } = renderHook(() => useSettings("npm:context-mode"));
    expect(result.current.settings.enabled).toBe(true);
  });
});
