import type { TermTimeoutError } from "./error.ts";

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
  throws?: boolean;            // NEW (v0.3.0) — default true (throw on timeout)
}

export interface WaitForQuietOptions {
  ms: number;                  // quiet threshold (pane unchanged for ms)
  timeout: number;             // overall timeout
  ansi?: boolean;
  interval?: number;           // default 50ms
  throws?: boolean;            // NEW (v0.3.0) — default true (throw on timeout)
}

export type NamedKey =
  | "Enter" | "Escape" | "Tab" | "Space" | "BS"
  | "Up" | "Down" | "Left" | "Right"
  | "C-c" | "C-d" | "C-z" | "C-\\"
  | "F1" | "F2" | "F3" | "F4";

/**
 * Structured result for waitFor/waitForQuiet when { throws: false }. On
 * timeout the `error` is the same TermTimeoutError that would have been
 * thrown with { throws: true } (default) — same fields, name, and code.
 */
export type WaitForResult =
  | { ok: true;  result: CaptureResult }
  | { ok: false; error: TermTimeoutError };
