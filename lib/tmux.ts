import type { Pane, NamedKey, CaptureResult, SpawnSpec, SpawnResult, WaitForOptions, WaitForQuietOptions, WaitForResult } from "./types.ts";
import { TermTimeoutError } from "./error.ts";
import * as lifecycle from "./lifecycle.ts";

// --- Exec seam ---------------------------------------------------------------
export type ExecFn = (args: string[]) => Promise<string>;
let exec: ExecFn = defaultTmuxExec;
export function setExec(fn: ExecFn): void { exec = fn; }

// in-tmux detection seam — true when pi is itself running inside tmux.
// Default reads $TMUX (set by tmux for every process it spawns). Tests inject
// a stub to exercise window-mode without mutating process.env.
let inTmuxFn: () => boolean = () => !!process.env.TMUX;
export function setInTmux(fn: () => boolean): void { inTmuxFn = fn; }

export async function defaultTmuxExec(args: string[]): Promise<string> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const p = spawn("tmux", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`tmux ${args.join(" ")} exited ${code}`))));
    p.on("error", reject);
  });
}

// --- sendKey name map (the "second button" — named special keys) -------------
const NAMED_KEY_TO_TMUX: Record<NamedKey, string> = {
  "Enter": "Enter", "Escape": "Escape", "Tab": "Tab", "Space": "Space", "BS": "BS",
  "Up": "Up", "Down": "Down", "Left": "Left", "Right": "Right",
  "C-c": "C-c", "C-d": "C-d", "C-z": "C-z", "C-\\": "C-\\",
  "F1": "F1", "F2": "F2", "F3": "F3", "F4": "F4",
};

// --- sendKeys: PURE LITERAL (v0.2.0) -----------------------------------------
// Types exactly the characters given — no escape interpretation. To press a
// special key (Enter, Esc, arrows, C-c, …) use the `sendKey` action. The v0.1.0
// `parseKeys` tokenizer was removed: its textual-escape handling (e.g. an
// agent sending "/todo\r" as the two letters \r) did not match the raw-byte
// mapping the impl actually did. `keys` is now unambiguous literal text.
export async function sendKeys(pane: Pane, keys: string): Promise<void> {
  if (keys.length === 0) return; // no-op on empty input
  await exec(["send-keys", "-t", pane, "-l", keys]);
}

export async function sendKey(pane: Pane, key: NamedKey): Promise<void> {
  await exec(["send-keys", "-t", pane, NAMED_KEY_TO_TMUX[key]]);
}

// --- capture -----------------------------------------------------------------
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[0-9A-Za-z]/g;
const OSC_RE = /\x1b\][^\x07]*\x07/g;
const OTHER_ESC_RE = /\x1b[=>]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "").replace(OSC_RE, "").replace(OTHER_ESC_RE, "");
}

export async function capture(pane: Pane, opts?: { ansi?: boolean }): Promise<CaptureResult> {
  const capArgs = ["capture-pane", "-t", pane, "-p", "-J"];
  if (opts?.ansi) capArgs.push("-e");
  const raw = await exec(capArgs);
  const meta = await exec(["display-message", "-t", pane, "-p",
    "#{cursor_x} #{cursor_y} #{pane_width} #{pane_height} #{alternate_on}"]);
  const [cx, cy, pw, ph, alt] = meta.trim().split(/\s+/);
  const text = stripAnsi(raw);
  const forLines = text.endsWith("\n") ? text.slice(0, -1) : text;
  const result: CaptureResult = {
    text,
    lines: forLines.split("\n"),
    cursor: { x: Number(cx ?? 0), y: Number(cy ?? 0) },
    width: Number(pw ?? 0),
    height: Number(ph ?? 0),
    altScreen: alt === "1",
  };
  if (opts?.ansi) result.ansi = raw;
  return result;
}

// --- spawn / attach / resize / kill ------------------------------------------
function randomSuffix(): string { return Math.random().toString(36).slice(2, 8); }

// `spawn` auto-detects its target via $TMUX:
//  - pi inside tmux  → new detached WINDOW in the current session (mode: "window").
//    Detached (-d) so the user's active window keeps focus; the new window is
//    reachable via `prefix + <n>`. windowName gets a rand suffix for uniqueness
//    within the shared session (concurrent QA runs don't collide, and kill can
//    target the stable window_id).
//  - pi outside tmux → new detached SESSION (mode: "session", the v0.1 fallback).
export async function spawn(spec?: SpawnSpec): Promise<SpawnResult> {
  const cmd = spec?.command ?? process.env.SHELL ?? "zsh";
  const args = spec?.args ?? [];
  const w = spec?.width ?? 120;
  const h = spec?.height ?? 40;
  const baseName = spec?.windowName ?? "pi-term";

  if (inTmuxFn()) {
    // window-mode: new window in pi's current session.
    const session = (await exec(["display-message", "-p", "#{session_name}"])).trim();
    const windowName = `${baseName}-${randomSuffix()}`;
    const newArgs = ["new-window", "-d", "-t", session, "-n", windowName, "-P", "-F", "#{window_id}|#{pane_id}"];
    if (spec?.cwd) newArgs.push("-c", spec.cwd);
    newArgs.push(cmd, ...args);
    const raw = await exec(newArgs);
    // tmux -F does NOT interpret \t (prints literal backslash-t); use `|` as the
    // separator. window_id (@N) and pane_id (%N) never contain `|`.
    const [windowId, pane] = raw.trim().split("|");
    if (!windowId || !pane) throw new Error(`term spawn (window-mode): unexpected new-window output: ${JSON.stringify(raw)}`);
    // new-window doesn't reliably honor -x/-y across tmux versions; resize explicitly.
    await exec(["resize-pane", "-t", pane, "-x", String(w), "-y", String(h)]);
    lifecycle.register(pane, session, { mode: "window", window: windowId });
    return { pane, session, mode: "window", window: windowId, windowName };
  }

  // session-mode: new detached session (pi not running inside tmux).
  const session = `pi-term-${process.pid}-${randomSuffix()}`;
  const newArgs = ["new-session", "-d", "-s", session, "-x", String(w), "-y", String(h), "-n", baseName];
  if (spec?.cwd) newArgs.push("-c", spec.cwd);
  newArgs.push(cmd, ...args);
  await exec(newArgs);
  const pane = (await exec(["display-message", "-t", session, "-p", "#{pane_id}"])).trim();
  lifecycle.register(pane, session, { mode: "session" });
  return { pane, session, mode: "session", windowName: baseName };
}

export async function attach(pane: Pane): Promise<{ pane: Pane; session: string }> {
  const session = (await exec(["display-message", "-t", pane, "-p", "#{session_name}"])).trim();
  return { pane, session };
}

export async function resize(pane: Pane, width: number, height: number): Promise<void> {
  await exec(["resize-pane", "-t", pane, "-x", String(width), "-y", String(height)]);
}

// kill tears down what spawn created: the window (window-mode) or the whole
// session (session-mode). No-op on panes we didn't spawn (never-kill-attached).
export async function kill(pane: Pane): Promise<void> {
  const entry = lifecycle.getEntry(pane);
  if (!entry) return;
  if (entry.mode === "window" && entry.window) {
    await exec(["kill-window", "-t", entry.window]);
  } else {
    await exec(["kill-session", "-t", entry.session]);
  }
  lifecycle.unregister(pane);
}

// --- waitFor / waitForQuiet -------------------------------------------------
// poll() is a PURE function — it never throws. It returns a WaitForResult:
// { ok: true, result } on settle, or { ok: false, error } on timeout. The
// public waitFor/waitForQuiet wrappers own the throw/return policy at the API
// boundary: throws:true (default) throws r.error; throws:false returns r.
//
// Overloads keep back-compat: the default (throws:true / omitted) still types
// as CaptureResult so existing `r.text` callers are unaffected; only the
// literal `{ throws: false }` call types as WaitForResult.
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return String(h);
}

async function poll(
  pane: Pane,
  opts: { timeout: number; interval?: number },
  done: (last: CaptureResult, stableFor: number) => boolean,
  pattern: RegExp | undefined,
): Promise<WaitForResult> {
  const interval = opts.interval ?? 50;
  const start = Date.now();
  let last: CaptureResult = await capture(pane);
  let lastHash = hash(last.text);
  let stableFor = 0;
  while (Date.now() - start < opts.timeout) {
    await sleep(interval);
    const cur = await capture(pane);
    const curHash = hash(cur.text);
    if (curHash === lastHash) stableFor += interval; else stableFor = 0;
    last = cur; lastHash = curHash;
    if (done(cur, stableFor)) {
      if (lifecycle.isSpawned(pane)) lifecycle.recordActivity(pane);
      return { ok: true, result: cur };
    }
  }
  return { ok: false, error: new TermTimeoutError(pane, Date.now() - start, opts.timeout, pattern, last) };
}

export async function waitFor(pane: Pane, pattern: RegExp, opts: WaitForOptions & { throws: false }): Promise<WaitForResult>;
export async function waitFor(pane: Pane, pattern: RegExp, opts: WaitForOptions): Promise<CaptureResult>;
export async function waitFor(
  pane: Pane, pattern: RegExp, opts: WaitForOptions,
): Promise<CaptureResult | WaitForResult> {
  const quietMs = opts.quietMs ?? 0;
  const textOf = (c: CaptureResult) => (opts.ansi ? c.ansi ?? c.text : c.text);
  const r = await poll(pane, opts, (cur, stableFor) => {
    if (!pattern.test(textOf(cur))) return false;
    if (quietMs === 0) return true;
    return stableFor >= quietMs;
  }, pattern);
  if (r.ok) return opts.throws === false ? r : r.result;
  if (opts.throws === false) return r;   // { ok: false, error }
  throw r.error;
}

export async function waitForQuiet(pane: Pane, opts: WaitForQuietOptions & { throws: false }): Promise<WaitForResult>;
export async function waitForQuiet(pane: Pane, opts: WaitForQuietOptions): Promise<CaptureResult>;
export async function waitForQuiet(
  pane: Pane, opts: WaitForQuietOptions,
): Promise<CaptureResult | WaitForResult> {
  const r = await poll(pane, opts, (_cur, stableFor) => stableFor >= opts.ms, undefined);
  if (r.ok) return opts.throws === false ? r : r.result;
  if (opts.throws === false) return r;
  throw r.error;
}
