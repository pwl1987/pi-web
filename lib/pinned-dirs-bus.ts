// Lightweight pub/sub for pinned-directory changes.
//
// Components that display the pin list (sidebar) and components that mutate
// it (Pin button in the cwd picker) live in different subtrees. The bus lets
// them share state without React Context — mutations fire here, subscribers
// re-fetch.
//
// Same globalThis-singleton pattern as lib/extensions/event-bus.ts.

type Listener = () => void;

class PinnedDirsBus {
  private listeners = new Set<Listener>();

  /** Subscribe to any pin-list mutation. Returns an unsubscribe function. */
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Fire after a POST / DELETE / alias change so subscribers re-fetch. */
  emit(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
        // Listener errors are non-fatal; keep the rest of the bus alive.
      }
    }
  }
}

declare global {
  var __piWebPinnedDirsBus: PinnedDirsBus | undefined;
}

export function getPinnedDirsBus(): PinnedDirsBus {
  if (!globalThis.__piWebPinnedDirsBus) {
    globalThis.__piWebPinnedDirsBus = new PinnedDirsBus();
  }
  return globalThis.__piWebPinnedDirsBus;
}