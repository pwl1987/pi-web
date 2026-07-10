# Pi Agent Web - Development Notes

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
Test: `node --test --experimental-strip-types lib/*.test.mjs` (no `npm test` script exists; tests are `node:test` + `node:assert/strict` importing the `.ts` sources directly — Node 22+ strips types natively). Add new tests as `lib/<name>.test.mjs` next to the module.
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running/events ───▶ running id SSE     │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** (read-only): reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
app/api/
  sessions/route.ts               GET  list all sessions
  sessions/[id]/route.ts          GET/PATCH/DELETE session
  sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
  sessions/[id]/export/route.ts   GET exported HTML for a session
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET state | POST any command
  agent/[id]/events/route.ts      GET SSE stream
  agent/running/events/route.ts   GET SSE stream of currently-running session ids
  auth/all-providers/route.ts     GET API-key provider list
  auth/api-key/[provider]/route.ts GET/POST/DELETE provider API key status/storage
  auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts POST OAuth logout
  auth/providers/route.ts         GET OAuth provider list
  cwd/validate/route.ts           POST validate/select a cwd
  default-cwd/route.ts            POST create ~/pi-cwd-YYYYMMDD
  file-index/route.ts            GET git-tracked file index for @ autocomplete
  files/[...path]/route.ts        GET file contents for viewer
  home/route.ts                   GET user home directory
  models/route.ts                 GET { models, modelList, defaultModel }
  models-config/route.ts          GET/PUT — read/write ~/.pi/agent/models.json
  models-config/test/route.ts     POST test a configured model/provider
  plugins/route.ts                GET/POST package plugin management
  skills/route.ts                 GET/PATCH loaded skills and disable-model-invocation
  skills/install/route.ts         POST install skills through npx skills add
  skills/search/route.ts          GET/POST skills.sh search
  worktrees/route.ts              GET/POST/DELETE git worktrees

lib/
  agent-client.ts      typed fetch helper for /api/agent commands
  allowed-roots.ts     in-memory extra browsable roots (globalThis-backed, hot-reload-safe)
  ansi.ts              ANSI escape parsing → styled spans (used by tool output rendering)
  api-types.ts         shared request/response types for plugins + skills search (client+server)
  clipboard.ts         clipboard fallback (navigator → execCommand → reject)
  compaction-summary.ts parse <read-files>/<modified-files> blocks out of compaction summaries
  draft-store.ts       local draft persistence helpers
  file-access.ts       allowed file roots for /api/files and worktrees
  file-fuzzy.ts        @ autocomplete query parsing + ranking (mirrors pi TUI scoreEntry)
  file-links.ts        file:// and relative path parsing for clickable links
  file-paths.ts        client/server path encoding helpers
  file-types.ts        preview size limits + ext→MIME maps (text/image/audio/doc)
  i18n/                lightweight i18n core (index.ts + en.ts + zh.ts) — zero deps
  markdown.ts          shared markdown helpers
  message-display.ts   assistant block filtering (empty thinking, final-answer detection)
  normalize.ts         normalizeToolCalls() — field name mismatch between file format and our types
  npx.ts               npx runner used by skill install
  patch.ts             unified-diff → split-diff cells for file change views
  pi-types.ts          local structural types for pi SDK objects
  rpc-manager.ts       AgentSessionWrapper + registry + startRpcSession
  session-file-references.ts(.core) is a given path referenced by a session's entries (used by delete guards)
  session-reader.ts    SessionManager wrappers + path cache + buildSessionContext adapter
  session-state-store.ts  sidecar (~/.pi/agent/pi-web-state.json) tracking recently active sessions for restart recovery
  tool-presets.ts      PRESET_NONE/DEFAULT/FULL + getPresetFromTools()
  types.ts             shared TypeScript types
  worktree.ts          project/worktree resolution and git worktree operations
  *.test.mjs           node:test suites — co-located with the module they cover

components/
  AppShell.tsx        layout + URL state + tab management
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      chat composition + completion sound wrapper
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  ChatMinimap.tsx     scroll minimap alongside the message list
  MarkdownBody.tsx    markdown renderer
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  PluginsConfig.tsx   modal for installed package plugins
  SkillsConfig.tsx    modal for loaded/search/installable skills
  FileExplorer.tsx    file tree inside sidebar
  FileIcons.tsx       file icon helpers
  FileViewer.tsx      file content in a tab
  TabBar.tsx          tab bar (Chat + open file tabs)

hooks/
  useAgentSession.ts  messages + streaming + SSE + fork/navigate/reconciliation logic
  useAudio.ts         completion sound + browser AudioContext unlock
  useDragDrop.ts      shared drag/drop state
  useI18n.ts          locale binding for React ({ locale, t, toggle } via useSyncExternalStore)
  useIsMobile.ts      responsive breakpoint hook
  useTheme.ts         theme state
```

---

## Conventions & Config

### Path alias
`@/*` → repo root (configured in `tsconfig.json` `paths`). Prefer `@/lib/...` / `@/components/...` over relative imports in app/components/hooks. (Note: files inside `lib/` import each other with relative paths — match the surrounding file.)

### Server-external packages
`@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` are in `next.config.ts` `serverExternalPackages`. They must NOT be bundled into client code — import them only from `app/api/**` route handlers or `lib/rpc-manager.ts`. Their versions also feed `NEXT_PUBLIC_PI_VERSION` for display.

### Lint config (`eslint.config.mjs`)
Next.js core-web-vitals + typescript presets, with three `react-hooks` rules explicitly turned **off**: `immutability`, `refs`, `set-state-in-effect`. Don't re-enable them without discussion.

### Data directory
pi-web reads `~/.pi/agent/sessions` by default. Override with `PI_CODING_AGENT_DIR` to point at a different pi agent directory. Never hardcode the pi home path — go through `lib/session-reader.ts`.

### Internationalization (i18n)
Lightweight, zero-dependency, client-side. Mirrors the `useTheme` pattern (module-level store + `useSyncExternalStore` + `localStorage`).
- `lib/i18n/index.ts` — core: `getSnapshot`/`getServerSnapshot`/`subscribe`/`setLocale`/`translate`. `getSnapshot` reads `<html data-lang>` (stamped by the layout preload script), `getServerSnapshot` always returns `"en"` (SSR-safe, avoids hydration mismatch).
- `lib/i18n/en.ts` + `zh.ts` — flat dotted-key dictionaries (`"namespace.subkey"`). **When translating a component, add keys to BOTH files.**
- `hooks/useI18n.ts` — React binding: `const { locale, t, toggle, setLocale } = useI18n()`. `t("key")` or `t("key", { var })` for `{var}` interpolation.
- Locale persisted as `"pi-language"` in localStorage (`"en" | "zh"`). Toggle button sits in the top bar (AppShell) next to the theme toggle.
- `app/layout.tsx` has a preload `<script>` that reads `pi-language` and sets `data-lang` + `lang` on `<html>` before first paint — no FOUC.

### CLI entrypoint (`bin/pi-web.js`)
Publishes as `@agegr/pi-web` (`bin: pi-web`). Resolves next's CLI directly (not via `.bin` symlinks, which may not exist under `npx`). Honors `--port`/`-p`, `--hostname`/`-H`, and `PORT`/`HOSTNAME` env (default port 30141). This is why `npm run dev` and the published CLI agree on the port.
`pi-web install` / `pi-web uninstall` subcommands register/remove a system service (systemd user unit on Linux, launchd plist on macOS) for auto-start + crash-restart. `ExecStart` uses the absolute bin path (`process.argv[1]`); service files reference `pi-web start` so the server boots the same way interactively and as a service.

### Restart recovery (sidecar)
The Pi SDK already persists all messages/models/compaction to `.jsonl` — nothing to do there. What is *not* in `.jsonl` is the in-memory registry of "which sessions are currently open" (`globalThis.__piSessions`) and the `forceEmptySystemPrompt` flag. `lib/session-state-store.ts` writes a sidecar `~/.pi/agent/pi-web-state.json` recording the last 20 active session ids + their `toolsDisabled` state. On process restart, `restoreActiveSessions()` (triggered lazily from `getRegistry()` on first access) pre-warms the 5 most recent sessions via `SessionManager.open()` and re-applies `toolsDisabled`. Fire-and-forget — failures don't block startup.

### File-access split
`file-access.ts` computes *allowed roots* (session cwds + project roots + `~/pi-cwd-*` + explicitly added roots). `allowed-roots.ts` holds the in-memory additions (globalThis-backed so hot-reload preserves them). `file-types.ts` owns preview size limits and ext→MIME maps. Keep `/api/files` a preview-only viewer, not a general browser.

### Release
See `docs/release.md`. `npm run release` bumps patch, runs `next build --webpack`, and publishes. Never run `release` or `next build` during normal dev.

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

### Fork must destroy the wrapper immediately
`AgentSession.fork()` **mutates the wrapper's inner state in-place** — after fork, `inner.sessionId` is the *new* session's id. If the wrapper stays alive in the registry under the old id, the next request gets the already-forked state and subsequent forks produce a corrupt `parentSession` chain.

**Fix**: `send("fork")` captures `newSessionId`, then calls `this.destroy()` before returning. The next request for the original session reloads a clean AgentSession from the original file.

### Two kinds of branching — don't confuse them
- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** (Continue button / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()` (streaming).

### New session tool preset
Tool names are passed at session creation (`POST /api/agent/new` → `toolNames[]`). For existing sessions, the active preset is inferred on mount via `get_tools` → `getPresetFromTools()`. When tools are fully disabled (`toolNames = []`), `rpc-manager.ts` passes an empty tool allow-list and forces `agent.state.systemPrompt = ""` after startup/reload/resource discovery.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Running state SSE + reconciliation
- The sidebar listens to `/api/agent/running/events`, backed by `subscribeRunningSessions()` in `lib/rpc-manager.ts`, so running badges update without polling.
- `useAgentSession` still treats per-session SSE as primary for chat events, but while a run is active it periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed `agent_end` events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.

### File access allow-list
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/pi-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.

### Plugins and skills
- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

### Auth and model config
- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must never return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is not a real route.

### Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

### Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then patches recursive tree helpers in the generated HTML to iterative versions so very deep linear sessions do not overflow the browser call stack.

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```
