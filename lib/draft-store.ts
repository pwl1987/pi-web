export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
  // Caret position captured at save time so a restored draft can re-place the
  // cursor exactly where the user left off. Clamped to the restored length on
  // load, so a stale/longer range never throws.
  selectionStart?: number | null;
  selectionEnd?: number | null;
}

const STORAGE_PREFIX = "pi-web:draft:";
const drafts = new Map<string, ChatDraft>();

// localStorage availability is probed once and cached. Private-mode Safari and
// some embedded webviews throw on access, so we fall back to in-memory only.
let storageCache: Storage | null | undefined;

function getStorage(): Storage | null {
  if (storageCache !== undefined) return storageCache;
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      storageCache = null;
      return null;
    }
    const probe = "__pi_draft_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    storageCache = window.localStorage;
  } catch {
    storageCache = null;
  }
  return storageCache;
}

function storageKey(key: string): string {
  return STORAGE_PREFIX + key;
}

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
    images: draft.images.map((image) => ({ ...image })),
    selectionStart: draft.selectionStart ?? null,
    selectionEnd: draft.selectionEnd ?? null,
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value && draft.images.length === 0;
}

interface SerializedDraft {
  value: string;
  images: ChatDraftImage[];
  selectionStart?: number | null;
  selectionEnd?: number | null;
}

function loadFromStorage(key: string): ChatDraft | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SerializedDraft>;
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      value: typeof parsed.value === "string" ? parsed.value : "",
      images: Array.isArray(parsed.images)
        ? parsed.images
            .filter(
              (img): img is ChatDraftImage =>
                !!img && typeof img.data === "string" && typeof img.mimeType === "string",
            )
            .map((img) => ({ data: img.data, mimeType: img.mimeType }))
        : [],
      selectionStart: typeof parsed.selectionStart === "number" ? parsed.selectionStart : null,
      selectionEnd: typeof parsed.selectionEnd === "number" ? parsed.selectionEnd : null,
    };
  } catch {
    // Corrupt JSON or blocked read — treat as no draft rather than crashing.
    return null;
  }
}

function saveToStorage(key: string, draft: ChatDraft): void {
  const storage = getStorage();
  if (!storage) return;
  const payload: SerializedDraft = {
    value: draft.value,
    images: draft.images,
    selectionStart: draft.selectionStart ?? null,
    selectionEnd: draft.selectionEnd ?? null,
  };
  try {
    storage.setItem(storageKey(key), JSON.stringify(payload));
  } catch {
    // Quota exceeded (large base64 images) or write blocked. Retry without the
    // images so the typed text + caret still survive the refresh.
    try {
      storage.setItem(
        storageKey(key),
        JSON.stringify({
          value: draft.value,
          images: [],
          selectionStart: draft.selectionStart ?? null,
          selectionEnd: draft.selectionEnd ?? null,
        }),
      );
    } catch {
      // Give up silently — the in-memory draft still works for this session.
    }
  }
}

function removeFromStorage(key: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(key));
  } catch {
    // ignore
  }
}

export function getDraft(key: string): ChatDraft | null {
  const cached = drafts.get(key);
  if (cached) return cloneDraft(cached);
  // Memory miss — hydrate from storage. After a page refresh the module-level
  // Map is reset, but localStorage still holds the last saved draft, so this
  // is what makes the input auto-restore on reload.
  const stored = loadFromStorage(key);
  if (stored) {
    drafts.set(key, stored);
    return cloneDraft(stored);
  }
  return null;
}

export function setDraft(key: string, draft: ChatDraft): void {
  if (isEmptyDraft(draft)) {
    drafts.delete(key);
    removeFromStorage(key);
    return;
  }
  const clone = cloneDraft(draft);
  drafts.set(key, clone);
  saveToStorage(key, clone);
}

export function clearDraft(key: string): void {
  drafts.delete(key);
  removeFromStorage(key);
}
