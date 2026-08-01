"use client";

// 把约束引擎的 findings 暴露给 React 组件（useSyncExternalStore）。
// 引擎在 findings 变化时仅替换缓存数组引用并递增版本号，因此 getSnapshot 稳定，
// 不会触发无限重渲染。

import { useSyncExternalStore } from "react";
import { getConstraintEngine } from "./index";
import type { ConstraintFinding } from "./types";

export interface ConstraintSummary {
  findings: ConstraintFinding[];
  errors: ConstraintFinding[];
  warns: ConstraintFinding[];
  infos: ConstraintFinding[];
  hasBlocking: boolean;
  recheck: () => void;
}

export function useConstraints(): ConstraintSummary {
  const engine = getConstraintEngine();
  useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const findings = engine.getFindings();
  const errors = findings.filter((f) => f.severity === "error");
  const warns = findings.filter((f) => f.severity === "warn");
  const infos = findings.filter((f) => f.severity === "info");
  return {
    findings,
    errors,
    warns,
    infos,
    hasBlocking: engine.hasViolation("error"),
    recheck: () => engine.evaluateAll(),
  };
}
