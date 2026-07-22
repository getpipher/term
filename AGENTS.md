# @getpipher/term — satellite context

`@getpipher/term` — a focused programmatic tmux driver for autonomous TUI QA
inside the pi coding agent. tmux-only v0.1; ships as `lib/` (importable async
API) + `extensions/term.ts` (pi tool, 9 actions). Seeded by the ad-hoc
tmux-driving harness used across `@getpipher/armory-todo` + `@getpipher/vision`
QA. See `docs/superpowers/specs/2026-07-22-term-design.md` for the full design.

## Status

- **v0.0.0** — spec stage (2026-07-22). Repo scaffolded; spec committed; no
  implementation yet. Implementation plan to follow via writing-plans.

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
- **Never-kill-attached** — `kill()` on a pane the tool didn't spawn is a
  no-op. Only `pi-term-<pid>-<rand>` sessions are eligible for lease/exit
  reaping. The user's live session is never at risk.
- **Lease** — 30-min default, refresh-on-activity, single `setInterval` reap
  sweep (60s, `unref`ed). `process.on('exit'/'SIGINT'/'SIGTERM')` reaps all
  spawned sessions best-effort.
- **`waitFor` throws** `TermTimeoutError` with `{pane, elapsed, timeout,
  pattern?, lastCapture}` — no silent failures (CIPHER standard).
- **`sendKeys` tokenizer** (`parseKeys`) — splits embedded escapes (`\r`,
  `\x1b[A`, `\x03`, …) into literal `-l` chunks + named-key tokens. The
  fiddliest piece; table-driven unit tests.

## Tool surface (v0.1)

Single `term` tool, 9 actions: `spawn | attach | send | sendKey | capture |
waitFor | waitForQuiet | resize | kill`. 1:1 with the lib. No `/term` slash,
no panel in v0.1 — the agent composes actions (getpither UX convention: tool
action = agent-primary).
