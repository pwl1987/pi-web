import assert from "node:assert/strict";
import test from "node:test";

// Minimal localStorage mock. We install it on globalThis.window BEFORE the
// subject module is imported so its availability probe sees a real store.
class MockStorage {
  constructor() {
    this.map = new Map();
    // When true, setItem throws (simulates Safari private mode / quota).
    this.throwOnSet = false;
  }
  getItem(key) {
    if (this.map.has(key)) return this.map.get(key);
    return null;
  }
  setItem(key, value) {
    // Simulate a quota error only for payloads that still carry the large
    // image data; the text-only fallback (no image) must succeed.
    if (this.throwOnSet && value.includes("BIGBASE64")) {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    }
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

const storage = new MockStorage();
globalThis.window = { localStorage: storage };

async function loadSubject() {
  return import("./draft-store.ts");
}

test("round-trips value + images + caret position", async () => {
  const { setDraft, getDraft } = await loadSubject();
  storage.clear();
  setDraft("k1", {
    value: "hello world",
    images: [{ data: "abc", mimeType: "image/png" }],
    selectionStart: 5,
    selectionEnd: 5,
  });
  const draft = getDraft("k1");
  assert.equal(draft.value, "hello world");
  assert.equal(draft.images.length, 1);
  assert.equal(draft.selectionStart, 5);
  assert.equal(draft.selectionEnd, 5);
});

test("hydrates from storage after the in-memory cache is empty (refresh)", async () => {
  const { getDraft } = await loadSubject();
  // Seed storage directly, simulating a previous session that saved a draft.
  storage.clear();
  storage.setItem(
    "pi-web:draft:k-refresh",
    JSON.stringify({ value: "restored text", images: [], selectionStart: 8, selectionEnd: 8 }),
  );
  const draft = getDraft("k-refresh");
  assert.equal(draft.value, "restored text");
  assert.equal(draft.selectionStart, 8);
  assert.equal(draft.selectionEnd, 8);
});

test("empty draft is not persisted and clearDraft removes it", async () => {
  const { setDraft, getDraft, clearDraft } = await loadSubject();
  storage.clear();
  setDraft("k-empty", { value: "", images: [] });
  assert.equal(getDraft("k-empty"), null);
  assert.equal(storage.getItem("pi-web:draft:k-empty"), null);

  setDraft("k2", { value: "x", images: [] });
  clearDraft("k2");
  assert.equal(getDraft("k2"), null);
  assert.equal(storage.getItem("pi-web:draft:k2"), null);
});

test("quota-exceeded falls back to text-only (images dropped, value+caret kept)", async () => {
  const { setDraft, getDraft } = await loadSubject();
  storage.clear();
  storage.throwOnSet = true; // first setItem throws
  try {
    setDraft("k-quota", {
      value: "keep me",
      images: [{ data: "BIGBASE64", mimeType: "image/jpeg" }],
      selectionStart: 4,
      selectionEnd: 4,
    });
    // Second write (text-only) must succeed.
    const raw = storage.getItem("pi-web:draft:k-quota");
    assert.ok(raw, "draft should still be persisted without images");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.value, "keep me");
    assert.deepEqual(parsed.images, []);
    assert.equal(parsed.selectionStart, 4);
    const draft = getDraft("k-quota");
    assert.equal(draft.value, "keep me");
  } finally {
    storage.throwOnSet = false;
  }
});

test("corrupt JSON in storage is treated as no draft (no throw)", async () => {
  const { getDraft } = await loadSubject();
  storage.clear();
  storage.setItem("pi-web:draft:k-corrupt", "{not valid json");
  assert.equal(getDraft("k-corrupt"), null);
});

test("getItem throwing is swallowed (returns null, no crash)", async () => {
  const { getDraft } = await loadSubject();
  const realGet = storage.getItem.bind(storage);
  storage.getItem = () => {
    throw new Error("blocked");
  };
  try {
    assert.equal(getDraft("k-blocked-read"), null);
  } finally {
    storage.getItem = realGet;
  }
});
