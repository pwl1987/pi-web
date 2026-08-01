// Lazy-loaded heavy config panels + file viewer registry (phase 6.3).
//
// These are only needed when explicitly opened by the user, so deferring them
// via React.lazy() shrinks the initial bundle. Centralized here so AppShell
// stays focused on layout/orchestration and the registry is easy to audit.

import { lazy } from "react";

export const FileViewer = lazy(() =>
  import("./FileViewer").then((m) => ({ default: m.FileViewer })),
);
export const ModelsConfig = lazy(() =>
  import("./ModelsConfig").then((m) => ({ default: m.ModelsConfig })),
);
export const SkillsConfig = lazy(() =>
  import("./SkillsConfig").then((m) => ({ default: m.SkillsConfig })),
);
export const PluginsConfig = lazy(() =>
  import("./PluginsConfig").then((m) => ({ default: m.PluginsConfig })),
);
export const InspectorPanel = lazy(() =>
  import("./InspectorPanel").then((m) => ({ default: m.InspectorPanel })),
);
