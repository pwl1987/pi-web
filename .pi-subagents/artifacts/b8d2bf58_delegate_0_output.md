## Recon Summary — `/data/Code/pi-web`

### 1. Top-level entries (21)

**Dirs:** `app/`, `bin/`, `components/`, `docs/`, `extensions/`, `hooks/`, `lib/`, `node_modules/`, `.next/`, `.pi-subagents/`, `.zcode/`, `.git/`

**Files:** `AGENTS.md`, `LICENSE`, `README.md`, `README.zh-CN.md`, `eslint.config.mjs`, `next.config.ts`, `next-env.d.ts`, `package.json`, `package-lock.json`, `bun.lock`, `postcss.config.mjs`, `tailwind.config.ts`, `tsconfig.json`, `tsconfig.tsbuildinfo`, `.gitignore`

### 2. .ts / .tsx file counts

- `app/`: **45**
- `components/`: **26**
- **Total: 71**

### 3. `package.json`

Exists. Package: `@agegr/pi-web` v0.7.9 (MIT). Bin: `pi-web` → `bin/pi-web.js`.

**Scripts:**

| Script    | Command                                                                                  |
| --------- | ---------------------------------------------------------------------------------------- |
| `dev`     | `next dev -p 30141`                                                                      |
| `build`   | `next build --webpack`                                                                   |
| `start`   | `next start -p 30141`                                                                    |
| `lint`    | `eslint .`                                                                               |
| `release` | `npm version patch --no-git-tag-version && npm run build && npm publish --access public` |

Notable: no `test` script — tests run via `node --test --experimental-strip-types lib/*.test.mjs` (per AGENTS.md).

### Notable observations

- Both `package-lock.json` and `bun.lock` present — project supports both npm and bun.
- `.next/`, `.pi-subagents/`, `.zcode/` are local artifacts/build dirs.
- `extensions/` is at top level (the bundled browser-side UI extension system, not the same as pi SDK packages under `/api/plugins`).
