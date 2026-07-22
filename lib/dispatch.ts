import * as tmux from "./tmux.ts";
import type { SpawnSpec, NamedKey, WaitForOptions, WaitForQuietOptions } from "./types.ts";

export type TermAction =
  | "spawn" | "attach" | "send" | "sendKey" | "capture"
  | "waitFor" | "waitForQuiet" | "resize" | "kill";

export interface TermInput {
  action: TermAction;
  spawn?: SpawnSpec;
  pane?: string;
  keys?: string;
  key?: NamedKey;
  ansi?: boolean;
  pattern?: string;
  width?: number;
  height?: number;
  timeout?: number;
  quietMs?: number;
  ms?: number;
  interval?: number;
}

export interface TermError {
  error: string;
  message?: string;
}

function compilePattern(s: string): RegExp | TermError {
  try {
    const m = s.match(/^\/(.+)\/([gimsuy]*)$/);
    if (m) {
      const pat = m[1] ?? "";
      const flags = m[2] ?? "";
      return new RegExp(pat, flags);
    }
    return new RegExp(s);
  } catch (e) {
    return { error: "INVALID_PATTERN", message: (e as Error).message };
  }
}

// Returns a plain value at the dispatch boundary so structured results
// (CaptureResult) and plain {ok}/{error} objects all flow through. The pi glue
// JSON-serializes this; tests cast as needed.
export async function dispatchAction(input: TermInput): Promise<unknown> {
  switch (input.action) {
    case "spawn":
      return await tmux.spawn(input.spawn);
    case "attach":
      if (!input.pane) return { error: "MISSING_PANE" };
      return await tmux.attach(input.pane);
    case "send":
      if (!input.pane) return { error: "MISSING_PANE" };
      await tmux.sendKeys(input.pane, input.keys ?? "");
      return { ok: true };
    case "sendKey":
      if (!input.pane || !input.key) return { error: "MISSING_PANE_OR_KEY" };
      await tmux.sendKey(input.pane, input.key);
      return { ok: true };
    case "capture":
      if (!input.pane) return { error: "MISSING_PANE" };
      return await tmux.capture(input.pane, { ansi: input.ansi });
    case "waitFor": {
      if (!input.pane || !input.pattern) return { error: "MISSING_PANE_OR_PATTERN" };
      const re = compilePattern(input.pattern);
      if ("error" in re) return re;
      const opts: WaitForOptions = {
        timeout: input.timeout ?? 5000,
        quietMs: input.quietMs,
        ansi: input.ansi,
        interval: input.interval,
      };
      return await tmux.waitFor(input.pane, re, opts);
    }
    case "waitForQuiet": {
      if (!input.pane) return { error: "MISSING_PANE" };
      const opts: WaitForQuietOptions = {
        ms: input.ms ?? 300,
        timeout: input.timeout ?? 5000,
        ansi: input.ansi,
        interval: input.interval,
      };
      return await tmux.waitForQuiet(input.pane, opts);
    }
    case "resize":
      if (!input.pane || input.width == null || input.height == null) return { error: "MISSING_PANE_OR_SIZE" };
      await tmux.resize(input.pane, input.width, input.height);
      return { ok: true };
    case "kill":
      if (!input.pane) return { error: "MISSING_PANE" };
      await tmux.kill(input.pane);
      return { ok: true };
    default:
      return { error: "UNKNOWN_ACTION", message: `unknown action: ${(input as { action: string }).action}` };
  }
}
