# @getpipher/term

> **Status:** v0.2.0 (shipped — `keys` is now pure literal; use `sendKey` for special keys). See
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

const { pane } = await term.spawn({ command: "pi", width: 120, height: 40 });
await term.sendKeys(pane, "/todo");
await term.sendKey(pane, "Enter");
const capture = await term.waitFor(pane, /Active/, { timeout: 10000, quietMs: 300 });
console.log(capture.text);
await term.kill(pane);
```

## Status & roadmap

- **v0.2.0** — `keys` is pure literal; `sendKey` for special keys. (Breaking
  change from v0.1.0's embedded-escape `keys`.)
- **v0.1.0** — tmux-only, async function API, 9-action tool, structured
  capture, pattern+quiet waitFor, lease lifecycle.
- **v0.3+** (planned, grounded in usage) — declarative `run(steps)` DSL,
  `{ throws: false }` opt-out, `TerminalDriver` interface (when a 2nd backend
  is real), composite `sendAndCapture` if usage justifies.

## License

MIT © RECTOR
