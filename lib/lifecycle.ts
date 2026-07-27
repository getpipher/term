import type { Pane } from "./types.ts";

export type SpawnMode = "session" | "window";

interface LeaseEntry {
  session: string;
  mode: SpawnMode;
  window?: string;        // tmux window_id (@N) — window-mode only
  lastActivity: number;
  leaseMs: number;
}

const spawned = new Map<Pane, LeaseEntry>();
export const LEASE_MS_DEFAULT = 30 * 60 * 1000;       // session-mode: 30 min
export const WINDOW_LEASE_MS = 2 * 60 * 60 * 1000;    // window-mode: 2 h (generous — user may inspect after the run)
export const REAP_INTERVAL = 60 * 1000;

export type ReapExecFn = (args: string[]) => Promise<string>;
let reapExec: ReapExecFn = async () => "";
let clockFn: () => number = () => Date.now();
export function setReapExec(fn: ReapExecFn): void { reapExec = fn; }
export function setClock(fn: () => number): void { clockFn = fn; }

let timer: ReturnType<typeof setInterval> | undefined;
let handlersInstalled = false;

export interface RegisterOptions {
  mode?: SpawnMode;
  window?: string;
  leaseMs?: number;
}

export function register(pane: Pane, session: string, opts: RegisterOptions = {}): void {
  const mode = opts.mode ?? "session";
  const leaseMs = opts.leaseMs ?? (mode === "window" ? WINDOW_LEASE_MS : LEASE_MS_DEFAULT);
  spawned.set(pane, { session, mode, window: opts.window, lastActivity: clockFn(), leaseMs });
  ensureReaper();
}
export function recordActivity(pane: Pane): void {
  const entry = spawned.get(pane);
  if (entry) entry.lastActivity = clockFn();
}
export function isSpawned(pane: Pane): boolean { return spawned.has(pane); }
export function getSession(pane: Pane): string | undefined { return spawned.get(pane)?.session; }
export function getEntry(pane: Pane): LeaseEntry | undefined { return spawned.get(pane); }
export function unregister(pane: Pane): void { spawned.delete(pane); }
export function allSpawnedPanes(): Pane[] { return [...spawned.keys()]; }

// Reap one entry — kills the window (window-mode) or session (session-mode).
// Returns the tmux arg vector so callers/tests can assert it.
function reapArgs(entry: LeaseEntry): string[] {
  if (entry.mode === "window" && entry.window) return ["kill-window", "-t", entry.window];
  return ["kill-session", "-t", entry.session];
}

export function reapExpired(now: number = clockFn()): Pane[] {
  const reaped: Pane[] = [];
  for (const [pane, entry] of spawned) {
    if (now - entry.lastActivity > entry.leaseMs) reaped.push(pane);
  }
  for (const pane of reaped) {
    const entry = spawned.get(pane);
    if (entry) void reapExec(reapArgs(entry));
    spawned.delete(pane);
  }
  return reaped;
}

function ensureReaper(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  timer = setInterval(() => { void reapExpired(); }, REAP_INTERVAL);
  timer.unref();
  const reapAll = () => {
    for (const [, entry] of spawned) void reapExec(reapArgs(entry));
    spawned.clear();
  };
  process.on("exit", reapAll);
  process.on("SIGINT", () => { reapAll(); process.exit(130); });
  process.on("SIGTERM", () => { reapAll(); process.exit(143); });
}