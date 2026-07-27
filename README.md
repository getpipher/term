# @getpipher/term

> **Status:** v0.4.0 (shipped — `spawn` auto-detects window-in-current-session vs detached-session; default no-kill for post-run inspection). See
> [`docs/superpowers/specs/2026-07-22-term-design.md`](docs/superpowers/specs/2026-07-22-term-design.md).

A focused **programmatic tmux driver** for the pi coding agent — spawn/drive a
tmux session (type text, send named keys, capture pane content, wait for a
render pattern or render-quiet, resize, kill) for autonomous TUI QA. tmux-only;
ships as an importable `lib/` + a thin pi extension that exposes a
model-callable `term` tool.

## Why

The ad-hoc tmux-driving harness used across `@getpipher/armory-todo` and
`@getpipher/vision` QA (send-keys, capture-pane, restart-between-scenarios)
was the seed. `@getpipher/term` generalizes it into a reusable, tested package
so the agent can run the same autonomous verification inside any pi session.

## Surfaces

- **`lib/`** — importable async function API (`spawn`, `attach`, `sendKeys`,
  `sendKey`, `capture`, `waitFor`, `waitForQuiet`, `resize`, `kill`). Use from
  standalone TS QA scripts via `tsx`.
- **`extensions/term.ts`** — pi extension wrapping the lib as a single
  `term` tool with a 9-action enum (agent-primary).

## `spawn` auto-detection + no-kill default (v0.4.0)

`spawn` now branches on `$TMUX`:

- **pi inside tmux** → creates a **new detached window** in the current session
  (`mode: "window"`). Detached (`-d`) so your active window keeps focus; reach the
  QA window via `prefix + <n>`. The window name gets a rand suffix
  (`pi-term-<rand>`) for uniqueness within the shared session.
- **pi outside tmux** (e.g. plain Ghostty) → creates a **new detached session**
  (`mode: "session"`), the v0.1 fallback.

`kill` tears down only what `spawn` created — `kill-window` for window-mode
  (your session stays), `kill-session` for session-mode. Never-kill-attached
  no-op on panes we didn't spawn is preserved.

**Default agent behavior: do NOT call `kill` at the end of a run** — leave the
  window/session so you can inspect the final TUI state. The lease reaper cleans
  up idle ones (30 min session-mode, 2 h window-mode). The tool result includes
  `windowName`/`session`/`window` so the agent can report how to switch to it.

## `keys` vs `sendKey` (v0.2.0)

`sendKeys(pane, keys)` types **literal text** — it sends exactly what you give
it via `tmux send-keys -l`, with no escape interpretation. To press a special
key (Enter, Esc, Tab, arrows, C-c, …) use `sendKey(pane, key)` — the "second
button." This decouples text from control keys: the v0.1.0 `parseKeys`
tokenizer was removed because its textual-escape handling (an agent sending
`/todo\r` as the two letters `\r`) didn't match the raw-byte mapping the impl
actually did. `keys` is now unambiguous.

## Install (pi)

Add to `~/.pi/agent/settings.json` `packages`:

```json
"npm:@getpipher/term"
```

Then `/reload` or restart pi.

## Quick example (standalone)

```ts
import * as term from "@getpipher/term/lib/tmux.ts";

const { pane, mode, windowName, session } = await term.spawn({ command: "pi", width: 120, height: 40 });
await term.sendKeys(pane, "/todo");
await term.sendKey(pane, "Enter");
const capture = await term.waitFor(pane, /Active/, { timeout: 10000, quietMs: 300 });
console.log(capture.text);
// v0.4.0 default: do NOT kill — leave the window/session for inspection.
// The lease reaper cleans up idle ones (30 min session, 2 h window).
// To switch to it: window-mode → `prefix + <n>`; session-mode → `tmux switch-client -t <session>`.
// Explicit cleanup when you're done inspecting:
// await term.kill(pane);
```

## Status & roadmap

- **v0.4.0** — `spawn` auto-detects: new window in current session (pi inside
  tmux) vs new detached session (pi outside tmux). `kill` branches to
  `kill-window`/`kill-session`. Default no-kill for post-run inspection; window
  lease 2 h, session lease 30 min.
- **v0.3.0** — `{ throws: false }` opt-out: `waitFor`/`waitForQuiet` return a
  `WaitForResult` union (`{ ok: true, result } | { ok: false, error }`) instead
  of throwing on timeout. Default `throws: true` is unchanged. Lib API only.
- **v0.2.0** — `keys` is pure literal; `sendKey` for special keys. (Breaking
  change from v0.1.0's embedded-escape `keys`.)
- **v0.1.0** — tmux-only, async function API, 9-action tool, structured
  capture, pattern+quiet waitFor, lease lifecycle.
- **v0.3+** (planned, grounded in usage) — declarative `run(steps)` DSL,
  `TerminalDriver` interface (when a 2nd backend is real), composite
  `sendAndCapture` if usage justifies.

## License

MIT © RECTOR
