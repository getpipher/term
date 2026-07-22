import type { Pane } from "./types.ts";

interface LeaseEntry {
  session: string;
  lastActivity: number;
  leaseMs: number;
}

const spawned = new Map<Pane, LeaseEntry>();
export const LEASE_MS_DEFAULT = 30 * 60 * 1000;
export const REAP_INTERVAL = 60 * 1000;

export type ReapExecFn = (args: string[]) => Promise<string>;
let reapExec: ReapExecFn = async () => "";
let clockFn: () => number = () => Date.now();
export function setReapExec(fn: ReapExecFn): void { reapExec = fn; }
export function setClock(fn: () => number): void { clockFn = fn; }

let timer: ReturnType<typeof setInterval> | undefined;
let handlersInstalled = false;

export function register(pane: Pane, session: string, leaseMs: number = LEASE_MS_DEFAULT): void {
  spawned.set(pane, { session, lastActivity: clockFn(), leaseMs });
  ensureReaper();
}
export function recordActivity(pane: Pane): void {
  const entry = spawned.get(pane);
  if (entry) entry.lastActivity = clockFn();
}
export function isSpawned(pane: Pane): boolean { return spawned.has(pane); }
export function getSession(pane: Pane): string | undefined { return spawned.get(pane)?.session; }
export function unregister(pane: Pane): void { spawned.delete(pane); }
export function allSpawnedPanes(): Pane[] { return [...spawned.keys()]; }

export function reapExpired(now: number = clockFn()): Pane[] {
  const reaped: Pane[] = [];
  for (const [pane, entry] of spawned) {
    if (now - entry.lastActivity > entry.leaseMs) reaped.push(pane);
  }
  for (const pane of reaped) {
    const entry = spawned.get(pane);
    if (entry) void reapExec(["kill-session", "-t", entry.session]);
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
    for (const [, entry] of spawned) void reapExec(["kill-session", "-t", entry.session]);
    spawned.clear();
  };
  process.on("exit", reapAll);
  process.on("SIGINT", () => { reapAll(); process.exit(130); });
  process.on("SIGTERM", () => { reapAll(); process.exit(143); });
}
