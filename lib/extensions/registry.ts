// Extension registry — the singleton that holds all loaded extensions and their
// qualified contributions. Extensions are registered once on page load via
// activate(), then queried on every UI render via getActions/getWorkspacePanels/
// getWorkspaceLabelItems.
//
// No deactivate: disabling an extension means it's not imported on next page load.

import type {
  ExtensionAction,
  ExtensionId,
  ExtensionRuntimeContext,
  LoadedExtensionInfo,
  LocalContributionId,
  PiWebExtension,
  QualifiedAction,
  QualifiedLabelContribution,
  QualifiedPanel,
  WorkspaceLabelContribution,
  WorkspaceLabelContext,
  WorkspaceLabelItem,
  WorkspacePanelContribution,
} from "./types";
import { isPiWebExtension } from "./types";

const ID_RE = /^[a-z][a-z0-9.-]*$/;

interface RegisteredExtension {
  id: ExtensionId;
  name: string;
  source: string;
  actions: QualifiedAction[];
  panels: QualifiedPanel[];
  labels: QualifiedLabelContribution[];
}

class ExtensionRegistry {
  private extensions = new Map<ExtensionId, RegisteredExtension>();
  private listeners = new Set<() => void>();
  /** Bumped on every register/unregister, so useSyncExternalStore consumers re-render. */
  private version = 0;

  // --- External store API (for useSyncExternalStore) ---

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };

  getSnapshot = (): number => this.version;

  private notify(): void {
    this.version++;
    this.listeners.forEach((cb) => cb());
  }

  // --- Registration ---

  /**
   * Register an extension. Validates apiVersion, calls activate(), qualifies all
   * contribution ids. Throws on invalid apiVersion, bad ids, or duplicate ids.
   * Individual failures are caught by the caller (loader) so one bad extension
   * doesn't block others.
   */
  register(ext: PiWebExtension, meta: { id: ExtensionId; source: string }): void {
    const { id, source } = meta;

    if (!ID_RE.test(id)) {
      throw new Error(`Invalid extension id: "${id}" (must match ${ID_RE})`);
    }
    if (ext.apiVersion !== 1) {
      throw new Error(`Unsupported extension API version for "${id}": ${ext.apiVersion}`);
    }
    if (this.extensions.has(id)) {
      throw new Error(`Duplicate extension id: "${id}"`);
    }

    const result = ext.activate({ apiVersion: 1, extensionId: id });
    const contributions = result ?? {};

    const actions = this.qualifyActions(id, contributions.actions ?? []);
    const panels = this.qualifyPanels(id, contributions.workspacePanels ?? []);
    const labels = this.qualifyLabels(id, contributions.workspaceLabels ?? []);

    this.extensions.set(id, { id, name: ext.name, source, actions, panels, labels });
    this.notify();
  }

  /** Remove an extension (used when reloading after disable). */
  unregister(id: ExtensionId): void {
    if (this.extensions.delete(id)) this.notify();
  }

  /** Check if a module export looks like a valid extension. */
  isValid(ext: unknown): ext is PiWebExtension {
    return isPiWebExtension(ext);
  }

  // --- Query API (called on every UI render) ---

  /**
   * Get all actions for the command palette. Includes disabled ones that have a
   * disabledReason (shown greyed out). The caller checks getActionDisabledReason
   * to decide styling and whether run() should be called.
   */
  getActions(ctx: ExtensionRuntimeContext): QualifiedAction[] {
    const result: QualifiedAction[] = [];
    for (const ext of this.extensions.values()) {
      for (const action of ext.actions) {
        const enabled = action.enabled?.(ctx) ?? true;
        if (enabled) {
          result.push(action);
        } else if (action.disabledReason?.(ctx)) {
          // Keep disabled actions visible (greyed) if they have a reason.
          result.push(action);
        }
      }
    }
    return result.sort((a, b) => a.title.localeCompare(b.title));
  }

  getActionDisabledReason(action: QualifiedAction, ctx: ExtensionRuntimeContext): string | undefined {
    if (action.enabled?.(ctx) ?? true) return undefined;
    return action.disabledReason?.(ctx);
  }

  getWorkspacePanels(): QualifiedPanel[] {
    return [...this.extensions.values()]
      .flatMap((ext) => ext.panels)
      .sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.title.localeCompare(b.title));
  }

  getWorkspaceLabelItems(ctx: WorkspaceLabelContext): { qualifiedId: string; item: WorkspaceLabelItem }[] {
    const result: { qualifiedId: string; item: WorkspaceLabelItem }[] = [];
    for (const ext of [...this.extensions.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      for (const label of ext.labels) {
        if (label.visible?.(ctx) === false) continue;
        const items = label.items(ctx);
        for (const item of items) {
          result.push({ qualifiedId: label.qualifiedId, item });
        }
      }
    }
    return result;
  }

  /** List loaded extensions for the config UI. */
  list(): LoadedExtensionInfo[] {
    return [...this.extensions.values()].map((ext) => ({
      id: ext.id,
      name: ext.name,
      source: ext.source as "bundled" | "local",
      actionCount: ext.actions.length,
      panelCount: ext.panels.length,
      labelCount: ext.labels.length,
    }));
  }

  get isLoaded(): boolean {
    return this.extensions.size > 0;
  }

  // --- Internal qualification helpers ---

  private qualifyActions(extId: ExtensionId, actions: ExtensionAction[]): QualifiedAction[] {
    const seen = new Set<string>();
    return actions.map((a) => {
      this.validateLocalId(a.id, extId);
      const qualifiedId = `${extId}:${a.id}`;
      if (seen.has(qualifiedId)) throw new Error(`Duplicate contribution id: "${qualifiedId}"`);
      seen.add(qualifiedId);
      return {
        qualifiedId,
        extensionId: extId,
        title: a.title,
        description: a.description,
        shortcut: a.shortcut,
        enabled: a.enabled,
        disabledReason: a.disabledReason,
        run: a.run,
      };
    });
  }

  private qualifyPanels(
    extId: ExtensionId,
    panels: WorkspacePanelContribution[],
  ): QualifiedPanel[] {
    const seen = new Set<string>();
    return panels.map((p) => {
      this.validateLocalId(p.id, extId);
      const qualifiedId = `${extId}:${p.id}`;
      if (seen.has(qualifiedId)) throw new Error(`Duplicate contribution id: "${qualifiedId}"`);
      seen.add(qualifiedId);
      return {
        qualifiedId,
        extensionId: extId,
        title: p.title,
        icon: p.icon,
        order: p.order,
        visible: p.visible,
        badge: p.badge,
        render: p.render,
      };
    });
  }

  private qualifyLabels(
    extId: ExtensionId,
    labels: WorkspaceLabelContribution[],
  ): QualifiedLabelContribution[] {
    const seen = new Set<string>();
    return labels.map((l) => {
      this.validateLocalId(l.id, extId);
      const qualifiedId = `${extId}:${l.id}`;
      if (seen.has(qualifiedId)) throw new Error(`Duplicate contribution id: "${qualifiedId}"`);
      seen.add(qualifiedId);
      return {
        qualifiedId,
        extensionId: extId,
        order: l.order ?? 1000,
        visible: l.visible,
        items: l.items,
      };
    });
  }

  private validateLocalId(localId: LocalContributionId, extId: ExtensionId): void {
    if (!ID_RE.test(localId)) {
      throw new Error(`Invalid contribution id "${localId}" in extension "${extId}" (must match ${ID_RE})`);
    }
  }
}

/** Singleton registry. Survives hot-reload via globalThis. */
declare global {
  var __piWebExtensionRegistry: ExtensionRegistry | undefined;
}

export function getExtensionRegistry(): ExtensionRegistry {
  if (!globalThis.__piWebExtensionRegistry) {
    globalThis.__piWebExtensionRegistry = new ExtensionRegistry();
  }
  return globalThis.__piWebExtensionRegistry;
}
