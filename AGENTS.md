# @getpipher/term — satellite context

`@getpipher/term` — a focused programmatic tmux driver for autonomous TUI QA
inside the pi coding agent. tmux-only v0.1; ships as `lib/` (importable async
API) + `extensions/term.ts` (pi tool, 9 actions). Seeded by the ad-hoc
tmux-driving harness used across `@getpipher/armory-todo` + `@getpipher/vision`
QA. See `docs/superpowers/specs/2026-07-22-term-design.md` for the full design.

## Status

- **v0.4.0** — shipped (2026-07-27). `spawn` auto-detects via `$TMUX`: new
  detached window in the current session (pi inside tmux) or new detached
  session (pi outside tmux). `kill` branches to `kill-window`/`kill-session`.
  Default agent behavior: no-kill — leave the window/session for post-run
  inspection (lease: 30 min session-mode, 2 h window-mode). CI publishes on
  v0.4.0 tag.
- **v0.1.0** — shipped (2026-07-22). Original tmux-only flat design.

## Conventions (inherited from ~/local-dev/getpipher/AGENTS.md)

- npm org `getpipher`, account `rz1989`. Publish via CI on `v*` tag using the
  getpipher org secret `NPM_TOKEN` (granular, Bypass 2FA, scoped to
  @getpipher, visibility ALL — inherited by this repo). Verified 2026-07-22.
- No build step — extensions ship raw `.ts` (run via tsx at pi runtime).
  `pnpm typecheck` + `pnpm test:run` (node:test via tsx) before release.
- `release.yml` = cursor/vision shape (pnpm, node 20, typecheck + test:run
  gates, idempotent npm publish) + armory-todo's GitHub-Release step
  (`gh release create --generate-notes`, idempotent).

## Key design constraints (from the spec)

- **tmux-only v0.1, flat** — no premature `TerminalDriver` abstraction.
  Extract the interface only when a 2nd real backend exists.
- **Exec seam** — `lib/tmux.ts` holds a module-level `exec: ExecFn` with a
  `setExec()` test seam (mirrors `cursor/lib/focus/tmux.ts`). Tests mock the
  exec to assert exact tmux arg arrays; an integration smoke runs against real
  tmux (skip-when-absent) to avoid the mock-proves-my-assumption anti-pattern.
- **`spawn` auto-detects target (v0.4.0)** — branches on `$TMUX` (via an
  `inTmuxFn` seam for tests): new window in the current session if pi is inside
  tmux, else a new detached session (the v0.1 fallback). Window-mode uses
  `new-window -d -P -F '#{window_id}|#{pane_id}'` (NOT `\t` — tmux `-F` prints
  literal `\t`, verified against real tmux) + an explicit `resize-window -t
  <window_id>` (NOT `resize-pane` — the session's attached client forces pane
  size to the client terminal; `resize-window` sets the window size directly and
  sticks). `kill` branches:
  `kill-window -t <window_id>` for window-mode, `kill-session` for session-mode.
- **Never-kill-attached** — `kill()` on a pane the tool didn't spawn is a
  no-op. Only panes registered via `spawn` are eligible for lease/exit
  reaping. The user's live session/windows are never at risk.
- **Lease** — session-mode 30 min, window-mode 2 h (generous — user may
  inspect after the run); refresh-on-activity, single `setInterval` reap sweep
  (60s, `unref`ed). `process.on('exit'/'SIGINT'/'SIGTERM')` reaps all spawned
  windows/sessions best-effort (mode-aware: `kill-window` vs `kill-session`).
- **`waitFor` throws** `TermTimeoutError` with `{pane, elapsed, timeout,
  pattern?, lastCapture}` — no silent failures (CIPHER standard).
- **`sendKeys` is pure literal (v0.2.0)** — `send-keys -l` with no escape
  interpretation. The v0.1.0 `parseKeys` tokenizer was removed (its textual-
  escape handling didn't match the raw-byte mapping). Use `sendKey` for special
  keys. Table-driven unit tests cover the literal path.

## Tool surface (v0.1)

Single `term` tool, 9 actions: `spawn | attach | send | sendKey | capture |
waitFor | waitForQuiet | resize | kill`. 1:1 with the lib. No `/term` slash,
no panel in v0.1 — the agent composes actions (getpipher UX convention: tool
action = agent-primary).
