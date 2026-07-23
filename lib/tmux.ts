import type { Pane, NamedKey, CaptureResult, SpawnSpec, WaitForOptions, WaitForQuietOptions } from "./types.ts";
import { TermTimeoutError } from "./error.ts";
import * as lifecycle from "./lifecycle.ts";

// --- Exec seam ---------------------------------------------------------------
export type ExecFn = (args: string[]) => Promise<string>;
let exec: ExecFn = defaultTmuxExec;
export function setExec(fn: ExecFn): void { exec = fn; }

async function defaultTmuxExec(args: string[]): Promise<string> {
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
function randomSession(): string {
  return `pi-term-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function spawn(spec?: SpawnSpec): Promise<{ pane: Pane; session: string }> {
  const session = randomSession();
  const cmd = spec?.command ?? process.env.SHELL ?? "zsh";
  const args = spec?.args ?? [];
  const w = spec?.width ?? 120;
  const h = spec?.height ?? 40;
  const win = spec?.windowName ?? "pi-term";
  const newArgs = ["new-session", "-d", "-s", session, "-x", String(w), "-y", String(h), "-n", win];
  if (spec?.cwd) newArgs.push("-c", spec.cwd);
  newArgs.push(cmd, ...args);
  await exec(newArgs);
  const pane = (await exec(["display-message", "-t", session, "-p", "#{pane_id}"])).trim();
  lifecycle.register(pane, session);
  return { pane, session };
}

export async function attach(pane: Pane): Promise<{ pane: Pane; session: string }> {
  const session = (await exec(["display-message", "-t", pane, "-p", "#{session_name}"])).trim();
  return { pane, session };
}

export async function resize(pane: Pane, width: number, height: number): Promise<void> {
  await exec(["resize-pane", "-t", pane, "-x", String(width), "-y", String(height)]);
}

export async function kill(pane: Pane): Promise<void> {
  const session = lifecycle.getSession(pane);
  if (!session) return; // never-kill-attached
  await exec(["kill-session", "-t", session]);
  lifecycle.unregister(pane);
}

// --- waitFor / waitForQuiet -------------------------------------------------
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
): Promise<CaptureResult> {
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
      return cur;
    }
  }
  throw new TermTimeoutError(pane, Date.now() - start, opts.timeout, pattern, last);
}

export async function waitFor(pane: Pane, pattern: RegExp, opts: WaitForOptions): Promise<CaptureResult> {
  const quietMs = opts.quietMs ?? 0;
  const textOf = (c: CaptureResult) => (opts.ansi ? c.ansi ?? c.text : c.text);
  return poll(pane, opts, (cur, stableFor) => {
    if (!pattern.test(textOf(cur))) return false;
    if (quietMs === 0) return true;
    return stableFor >= quietMs;
  }, pattern);
}

export async function waitForQuiet(pane: Pane, opts: WaitForQuietOptions): Promise<CaptureResult> {
  return poll(pane, opts, (_cur, stableFor) => stableFor >= opts.ms, undefined);
}
