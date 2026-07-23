# @getpipher/term — SPEC (v0.1.0): Programmatic tmux Driver

**Status:** DRAFT → self-reviewed ✅ → pending RECTOR review
**Date:** 2026-07-22
**Stack target:** tmux 3.7+ (RECTOR's daily mux). macOS + Linux. Node 20+.
**Seed:** The ad-hoc tmux-driving harness used across `@getpipher/armory-todo`
v0.3.1/v0.4.0 + `@getpipher/vision` v0.4.0/v0.5.0 QA (send-keys, capture-pane,
restart-between-scenarios), and the PTY-driven tmux repro technique from the
upstream tmux #5328 bug hunt.

---

## 1. Overview

`@getpipher/term` is a focused **programmatic tmux driver** for autonomous TUI
QA inside the pi coding agent. It gives the agent (and standalone TS QA
scripts) a controlled way to spawn/drive a tmux session: send keystrokes,
capture pane content, wait for render-quiet or a pattern, resize, and tear down
— without leaving the conversation or touching the user's live session
unsafely.

v0.1 is **tmux-only** and **flat** (no premature `TerminalDriver` abstraction).
The interface is extracted only when a second real backend exists (raw PTY for
non-tmux CI, or a future mux). v0.1 ships two surfaces: an importable `lib/`
(the substrate) and a thin `extensions/term.ts` that wraps it as a
model-callable pi tool (9 actions, 1:1 with the lib).

### Non-goals (v0.1)

- **Declarative scenario DSL** (`run(steps)`) — deferred to v0.2, grounded in
  real v0.1 usage. v0.1 is the async function API only.
- **Non-throwing `waitFor`** (`{ throws: false }` structured-result opt-out) —
  deferred to v0.2 if probe-then-branch usage proves it.
- **Pluggable backends** (cmux/herdr/raw-PTY) — deferred; `TerminalDriver`
  interface extracted from two real impls, not one.
- **Composite actions** (`sendAndCapture`, `run`) — deferred; the agent
  composes primitive actions across tool calls.
- **Lease timer UI/panel** — lifecycle is internal; no panel surface in v0.1.

## 2. Decisions (locked during brainstorm)

| # | Decision |
|---|---|
| Stance | Focused programmatic tmux driver (not a harness, not a generic PTY tool) |
| Surfaces | Both — `lib/` (importable) + `extensions/term.ts` (pi tool); mirrors `cursor`/`vision` |
| Execution | Attach **or** spawn per call; namespaced spawns; never-kill-attached |
| API shape | Async function API (v0.1); declarative `run(steps)` → v0.2 |
| `waitFor` | Pattern + quiet + combined (pattern matched AND pane quiet for `quietMs`) |
| `capture` | Structured `{text, ansi?, lines, cursor, width, height, altScreen}` |
| Keys | `sendKeys` (embedded escapes: `\r`, `\x1b`) + `sendKey` (named: `Enter`, `C-c`, …) |
| Errors | Throw `TermTimeoutError` with `{pane, elapsed, timeout, pattern?, lastCapture}` |
| Backends | tmux-only v0.1; extract `TerminalDriver` only when a 2nd backend is real |
| Tool actions | 9, 1:1 with lib: `spawn, attach, send, sendKey, capture, waitFor, waitForQuiet, resize, kill` |
| Lifecycle | Auto-cleanup on process exit + 30-min lease (refresh-on-activity) + explicit kill; `kill` on attached = no-op |
| Release | Automated: npm publish + GitHub Release on `v*` tag; `NPM_TOKEN` inherited from getpipher org secret |

## 3. Architecture

```
┌─────────────────┐   ┌──────────────────┐
│  extensions/    │   │  lib/            │
│  term.ts        │──▶│  tmux.ts         │  ← all tmux calls here
│  (pi tool:      │   │  types.ts        │
│   action enum)  │   │  lifecycle.ts    │
└─────────────────┘   │  error.ts        │
                      └──────────────────┘
        standalone TS QA scripts import lib/ directly (tsx)
```

The lib is the substrate; the extension is a thin wrapper that maps the 9-action
enum to lib functions + the input/output schema the agent sees. No business
logic in the extension — pure dispatch.

## 4. Types (`lib/types.ts`)

```ts
// Ops reference a pane by its id (the string returned by spawn/attach, or
// $TMUX_PANE for the agent's own pane). There is no Target union — `spawn`
// takes a SpawnSpec directly and returns a pane id; all other ops take the
// pane id. This avoids the "spawn mid-op" smell a union would introduce.
export type Pane = string;

export interface SpawnSpec {
  command?: string;            // default: "$SHELL" (or zsh); e.g. "pi" to spawn pi
  args?: string[];
  cwd?: string;                // default: process.cwd()
  env?: Record<string, string>;
  width?: number;              // cols, default 120
  height?: number;             // rows, default 40
  windowName?: string;         // default "pi-term"
}

export interface CaptureResult {
  text: string;                // ANSI-stripped, wrapped lines joined (-p -J)
  ansi?: string;               // present only if { ansi: true } (-e retained)
  lines: string[];             // text split on \n
  cursor: { x: number; y: number };     // 0-indexed, from display-message
  width: number;
  height: number;
  altScreen: boolean;          // alternate-screen flag
}

export interface WaitForOptions {
  timeout: number;             // ms, required
  quietMs?: number;            // combined mode: pattern matched AND pane quiet for quietMs
  ansi?: boolean;              // match against ansi text instead of plain
  interval?: number;           // poll interval, default 50ms
}
export interface WaitForQuietOptions {
  ms: number;                  // quiet threshold (pane unchanged for ms)
  timeout: number;             // overall timeout
  ansi?: boolean;
  interval?: number;           // default 50ms
}

export type NamedKey =
  | "Enter" | "Escape" | "Tab" | "Space" | "BS"
  | "Up" | "Down" | "Left" | "Right"
  | "C-c" | "C-d" | "C-z" | "C-\\"
  | "F1" | "F2" | "F3" | "F4";
```

## 5. Lib API (`lib/tmux.ts`)

```ts
export async function spawn(spec?: SpawnSpec): Promise<{ pane: Pane; session: string }>;
export async function attach(pane: Pane): Promise<{ pane: Pane; session: string }>;
export async function sendKeys(pane: Pane, keys: string): Promise<void>;
export async function sendKey(pane: Pane, key: NamedKey): Promise<void>;
export async function capture(pane: Pane, opts?: { ansi?: boolean }): Promise<CaptureResult>;
export async function waitFor(pane: Pane, pattern: RegExp, opts: WaitForOptions): Promise<CaptureResult>;
export async function waitForQuiet(pane: Pane, opts: WaitForQuietOptions): Promise<CaptureResult>;
export async function resize(pane: Pane, width: number, height: number): Promise<void>;
export async function kill(pane: Pane): Promise<void>;
```

- `spawn` creates `tmux new-session -d -s pi-term-<pid>-<rand> -x <w> -y <h> -n <windowName> <command> <args>`, fetches the pane id via `tmux display-message -p '#{pane_id}'`, registers the pane with `lifecycle.ts`, returns `{pane, session}`.
- `attach` validates the pane exists (`tmux display-message -t <pane> -p '#{pane_id}'`), does **not** register it with lifecycle (never-kill-attached), returns `{pane, session}`.
- `sendKeys` parses the embedded-escape string via `parseKeys()` (see §7) into literal-char chunks + named-key tokens, sends them as separate `tmux send-keys -t <pane>` args.
- `sendKey` maps a `NamedKey` → tmux key name (see §8) and sends `tmux send-keys -t <pane> <keyname>`.
- `capture` runs `tmux capture-pane -t <pane> -p -J [-e?]` + `tmux display-message -t <pane> -p '#{cursor_x} #{cursor_y} #{pane_width} #{pane_height} #{alternate_on}'`, parses into `CaptureResult`.
- `waitFor` / `waitForQuiet` share one poll loop (default 50ms) that calls `capture` + diffs a hash of `text` (or `ansi`) for quiet detection. On timeout → throw `TermTimeoutError`. On resolve → return the last `CaptureResult`.
- `resize` runs `tmux resize-pane -t <pane> -x <w> -y <h>`.
- `kill` looks up the pane in the lifecycle registry; if present (spawned by us) → `tmux kill-session -t <entry.session>` + unregister; if absent (attached pane) → no-op (resolves successfully).

Every op on a spawned pane calls `lifecycle.recordActivity(pane)` before returning (no-op for attached panes not in the registry).

## 6. Lifecycle (`lib/lifecycle.ts`)

```ts
interface LeaseEntry { session: string; lastActivity: number; leaseMs: number; }

// Keyed by pane id (the thing ops receive), so kill(pane) is a direct lookup
// with no extra tmux round-trip to resolve session-from-pane.
const spawned = new Map<Pane, LeaseEntry>();
const LEASE_MS_DEFAULT = 30 * 60 * 1000;          // 30 min
const REAP_INTERVAL = 60 * 1000;                  // 60s sweep

export function register(pane: Pane, session: string, leaseMs = LEASE_MS_DEFAULT): void;
export function recordActivity(pane: Pane): void;
export function isSpawned(pane: Pane): boolean;
export function unregister(pane: Pane): void;
export function reapExpired(now = Date.now()): Pane[];   // returns reaped panes
```

- `register` adds the entry + ensures the reap timer + exit handlers are installed (lazy, once).
- `recordActivity` updates `lastActivity` (called by every op in `tmux.ts` for spawned panes; no-op for attached panes not in the map).
- A single `setInterval(REAP_INTERVAL)` calls `reapExpired()` → for each entry where `now - lastActivity > leaseMs`, runs `tmux kill-session -t <entry.session>` + `unregister`.
- `process.on('exit')` + `process.on('SIGINT')` + `process.on('SIGTERM')` reap **all** spawned sessions (best-effort, synchronous `spawnSync('tmux', ['kill-session','-t',entry.session])`).
- The timer is `unref()`ed so it never keeps the process alive on its own.

**Safety:** `kill(pane)` on an attached pane (not in `spawned`) is a no-op. The user's live session can never be reaped by the tool. Only `pi-term-<pid>-<rand>` sessions the tool itself spawned are eligible for lease/exit reaping.

## 7. `sendKeys` tokenizer (`parseKeys` in `lib/tmux.ts`)

`sendKeys(pane, "/todo\r")` must send `"/todo"` as literal text + `Enter`. tmux's `send-keys -l` disables key-name interpretation (so `\r` would be literal) — not what we want. Instead `parseKeys()` walks the string, splitting into:

- **Literal char chunks** → sent via `tmux send-keys -t <pane> -l "<chunk>"` (one `-l` call per maximal literal run; `-l` is correct here because literal text must not be interpreted as key names).
- **Escape tokens** → `\r`=`Enter`, `\n`=`Enter`, `\t`=`Tab`, `\x1b`=`Escape`, `\x7f`=`BS`, `\x03`=`C-c`, `\x04`=`C-d`, `\x1a`=`C-z`, `\x1c`=`C-\`, `\x1b[A`=`Up`, `\x1b[B`=`Down`, `\x1b[C`=`Right`, `\x1b[D`=`Left`, `\x1bOP`-`\x1bOS`=`F1`-`F4` → sent via `tmux send-keys -t <pane> <keyname>` (no `-l`).

So `"/todo\r"` → `tmux send-keys -t <pane> -l "/todo"` then `tmux send-keys -t <pane> Enter`. Two exec calls per `sendKeys` if the string has trailing escapes; one if it's pure literal. This is the fiddly bit — a small, well-tested tokenizer.

**Shell quoting:** literal chunks are passed as a single argv element to the exec (no shell), so `shellQuote` is not needed — `spawn('tmux', ['-t', pane, '-l', chunk])` is safe. The exec seam (`ExecFn`) takes an argv array, never a shell string.

## 8. `sendKey` name map (`lib/tmux.ts`)

```ts
const NAMED_KEY_TO_TMUX: Record<NamedKey, string> = {
  "Enter": "Enter", "Escape": "Escape", "Tab": "Tab", "Space": "Space", "BS": "BS",
  "Up": "Up", "Down": "Down", "Left": "Left", "Right": "Right",
  "C-c": "C-c", "C-d": "C-d", "C-z": "C-z", "C-\\": "C-\\",
  "F1": "F1", "F2": "F2", "F3": "F3", "F4": "F4",
};
```

`sendKey(pane, "C-c")` → `tmux send-keys -t <pane> C-c`. Tiny, exhaustive over `NamedKey`.

## 9. Error (`lib/error.ts`)

```ts
export class TermTimeoutError extends Error {
  readonly code = "TERM_TIMEOUT" as const;
  constructor(
    public readonly pane: Pane,
    public readonly elapsed: number,
    public readonly timeout: number,
    public readonly pattern: RegExp | undefined,
    public readonly lastCapture: CaptureResult,
  ) {
    super(`term waitFor timed out after ${elapsed}ms (timeout ${timeout}ms)${pattern ? ` matching ${pattern}` : ""}`);
    this.name = "TermTimeoutError";
  }
}
```

`waitFor` throws on timeout; `waitForQuiet` throws on timeout (same error, `pattern` undefined). The agent's try/catch gets `lastCapture` for debugging without a separate `capture` call. v0.2 may add `{ throws: false }` opt-out — not v0.1.

## 10. Pi tool surface (`extensions/term.ts`)

Single tool `term` with `action` enum; each action's params mirror the lib signature.

| action | params | returns |
|---|---|---|
| `spawn` | `SpawnSpec?` | `{pane, session}` |
| `attach` | `{pane}` | `{pane, session}` |
| `send` | `{pane, keys}` | `{ok:true}` |
| `sendKey` | `{pane, key: NamedKey}` | `{ok:true}` |
| `capture` | `{pane, ansi?}` | `CaptureResult` |
| `waitFor` | `{pane, pattern: string, ...WaitForOptions}` | `CaptureResult` (throws `TermTimeoutError` → agent sees error) |
| `waitForQuiet` | `{pane, ...WaitForQuietOptions}` | `CaptureResult` |
| `resize` | `{pane, width, height}` | `{ok:true}` |
| `kill` | `{pane}` | `{ok:true}` |

`pane` in tool params is the string id returned by `spawn`/`attach` (or `$TMUX_PANE` for the agent's own pane). No `Target` union — `spawn` takes a `SpawnSpec` directly; all other actions take the pane id.

`pattern` in `waitFor` is a `string` (JSON-safe) → compiled to `RegExp` in the extension before calling the lib. Pattern syntax: `/regex/flags` or a bare `regex` (defaults to no flags). The extension validates via `RegExp` constructor; invalid patterns return a typed error (not a throw into the agent loop).

**getpipher UX convention:** the tool action is the agent-primary surface. v0.1 ships no `/term` slash and no panel — the agent composes actions. A human interactive surface (panel/scoped `/term` subs) is a later consideration, not v0.1.

## 11. Exec seam (testability)

Like `cursor/lib/focus/tmux.ts`, the tmux exec is injected via an `ExecFn`:

```ts
export type ExecFn = (args: string[]) => Promise<string>;  // returns stdout
```

`lib/tmux.ts` holds a module-level `let exec: ExecFn = defaultTmuxExec` + a `setExec(fn)` test seam. `defaultTmuxExec` spawns `tmux` via `node:child_process` and captures stdout. Tests inject a mock that returns canned `capture-pane` / `display-message` output and records the arg arrays for assertion.

`lifecycle.ts` uses a separate `ExecSync` seam for the exit-handler reaping (`spawnSync`) — also injectable.

## 12. File layout

```
term/
├── AGENTS.md                  # satellite context (getpipher convention)
├── README.md
├── LICENSE                    # MIT
├── package.json               # @getpipher/term, no build, tsx runtime
├── tsconfig.json
├── .gitignore
├── .github/workflows/release.yml   # npm publish + GitHub Release on v* tag
├── lib/
│   ├── types.ts
│   ├── tmux.ts
│   ├── lifecycle.ts
│   └── error.ts
├── extensions/
│   └── term.ts
└── tests/
    ├── tmux.test.ts           # lib unit tests (mocked exec seam)
    ├── lifecycle.test.ts      # lease refresh, exit reaper, never-kill-attached
    ├── error.test.ts          # TermTimeoutError shape
    └── term-tool.test.ts      # extension action dispatch + input schema
```

## 13. Testing

- **Stack:** `tsx` + `node:test` + `node:assert/strict` (NOT vitest) — matches every sibling getpipher package. `pnpm typecheck` + `pnpm test:run` green; 80%+ coverage on new code.
- **Unit (mocked exec):**
  - `spawn` builds the right `tmux new-session -d -s pi-term-... -x 120 -y 40 -n pi-term <cmd>` arg array; registers with lifecycle; returns `{pane, session}`.
  - `sendKeys` / `parseKeys`: `"/todo\r"` → `['send-keys','-t',pane,'-l','/todo']` + `['send-keys','-t',pane,'Enter']`; `"\x1b[A"` → Up; `"\x03"` → C-c; pure literal `"hello"` → one `-l` call.
  - `sendKey`: each `NamedKey` maps to the correct tmux key name arg.
  - `capture`: parses canned `capture-pane` + `display-message` output into `CaptureResult` (cursor, width, height, altScreen correct); `ansi:true` passes `-e`.
  - `waitFor`: resolves when pattern matches + (with `quietMs`) pane stable for `quietMs`; throws `TermTimeoutError` with `lastCapture` on timeout.
  - `waitForQuiet`: resolves on quiet; throws on timeout.
  - `lifecycle`: `register` adds entry; `recordActivity` updates `lastActivity`; `reapExpired` reaps only entries past lease; `kill` on attached (unregistered) = no-op; exit handler reaps all spawned.
- **Integration (real tmux):** a gated test (`test:run:integration` or a skip-when-no-tmux guard) that spawns a real tmux session running `printf 'hello\r'; sleep 0.1`, captures, asserts `text` contains `hello`, kills. This is the smoke that catches the **mock-proves-my-assumption** anti-pattern flagged in the getpipher AGENTS gotchas (the v0.2.1 cursor crash). Skipped if `tmux` not on PATH or `TERM` unset.

## 14. Package & release

- **npm:** `@getpipher/term`, account `rz1989`, published by `release.yml` on `v*` tag. No build step — ships raw `.ts` run via tsx.
- **Org secret verified (2026-07-22):** `NPM_TOKEN` exists at the **getpipher org level**, visibility `ALL` (inherited by every repo in the org), granular npm token scoped to `@getpipher` with Bypass 2FA (no OTP). No per-repo secret setup required.
- **`release.yml`** = cursor/vision shape (pnpm, node 20, `typecheck` + `test:run` gates, idempotent npm publish via `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`) **+** armory-todo's GitHub-Release step (`gh release create --generate-notes`, idempotent via `gh release view` guard, `GH_TOKEN: ${{ github.token }}`). `permissions: contents: write` (needed for `gh release create`). Both steps idempotent — safe to re-run.
- **`~/.pi/agent/settings.json`:** add `npm:@getpipher/term` to `packages` after first release; `/reload` or restart pi.
- **Version:** v0.1.0 first release. Branch `feat/v0.1.0`.
- **Pre-flight:** `pnpm typecheck` + `pnpm test:run` green; one commit per feature across the plan slices; final commit bumps `package.json` + tags `v0.1.0` → CI publishes + creates the GitHub Release.

## 15. Risks & verification

- **⚠️ Live-verification deferred** — like v0.1 `cursor` herdr + `vision` batches, lib unit tests run against mocked exec. The integration smoke (real tmux) is the live gate; it's skipped if tmux isn't present. Documented in README + AGENTS.
- **`parseKeys` correctness** — the tokenizer is the fiddliest piece. Edge cases: `\x1b` followed by `[A` vs a literal `[` after an Esc; `\r\n` ordering; empty string. Covered exhaustively in unit tests (table-driven).
- **Lease reaping an in-use session** — mitigated by 30-min generous default + refresh-on-activity (every op on a spawned pane touches `lastActivity`). A scenario that runs an op then idles >30 min genuinely *should* be reaped. Documented.
- **Exit-handler reaping on SIGKILL** — `process.on('exit')` doesn't fire on SIGKILL; orphaned `pi-term-*` sessions could survive. Mitigated by namespacing (`tmux ls | grep pi-term-` reveals them) + the lease timer. Documented as a known edge.
- **`waitFor` transient match** — a pattern that flashes mid-render then vanishes. Mitigated by the combined `pattern + quietMs` mode (recommended default in README for TUI QA).
- **Capture cost** — `waitFor` polls every 50ms; each poll is 2 tmux calls (`capture-pane` + `display-message`). For a 5s timeout that's ~200 tmux calls. Acceptable for QA; documented. v0.2 could batch into one `display-message` with `#(capture-pane ...)` format expansion if it matters (it probably won't).

## 16. Success criteria

- `pnpm typecheck` + `pnpm test:run` green; 80%+ coverage on new code.
- Integration smoke passes against a real tmux (when tmux present).
- A standalone TS script can: `spawn` a session running `pi`, `sendKeys(pane, "/todo\r")`, `waitFor(pane, /Active/, {timeout:10000, quietMs:300})`, `capture(pane)`, assert the panel rendered, `kill(pane)`. (This is the seed scenario, generalized.)
- The agent can do the same via the `term` tool inside a running pi session.
- Tag `v0.1.0` → `release.yml` publishes `@getpipher/term@0.1.0` to npm **and** creates the GitHub Release (auto-generated notes).

## 17. Release

Patch `0.0.0` → `0.1.0` (first release). Commit per-feature across the plan slices; final commit bumps `package.json` version + tags `v0.1.0` → CI publishes npm + creates GitHub Release. One branch `feat/v0.1.0`.
