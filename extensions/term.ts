import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { dispatchAction, type TermInput } from "../lib/dispatch.ts";
import { TermTimeoutError } from "../lib/error.ts";

const ACTIONS = ["spawn", "attach", "send", "sendKey", "capture", "waitFor", "waitForQuiet", "resize", "kill"] as const;

export default function termExtension(pi: ExtensionAPI): void {
  pi.on("session_start", () => {});
  pi.on("session_shutdown", () => {});
  pi.registerTool({
    name: "term",
    label: "Terminal (tmux)",
    description: "Programmatic tmux driver for autonomous TUI QA — spawn/drive a tmux session: send keystrokes, capture pane content, wait for a render pattern or render-quiet, resize, and tear down. tmux-only. Actions: spawn, attach, send, sendKey, capture, waitFor, waitForQuiet, resize, kill.",
    promptSnippet: "Drive a tmux session programmatically for autonomous TUI QA (send text, send named keys, capture, wait for a pattern, kill)",
    promptGuidelines: [
      "Use `term` to spawn an isolated tmux session running a TUI app (e.g. `pi`), drive it, wait for a render pattern or render-quiet, capture the pane, and kill the session when done.",
      "`spawn` returns a `pane` id; pass that `pane` to all later actions. `kill` on a pane you didn't spawn is a safe no-op.",
      "Use `send` to type LITERAL text (it types exactly what you give it — no escape codes). Use `sendKey` to press a named key (Enter, Escape, Tab, Up/Down/Left/Right, C-c, F1-F4, …). To submit a command, call `send` with the text then `sendKey` with Enter.",
      "For TUI QA, prefer `waitFor` with a pattern AND `quietMs` (e.g. 300) so a pattern that flashes mid-render then vanishes doesn't match transiently.",
      "`waitFor` throws a timeout error on timeout — the tool returns it as an `isError` result with the last capture for debugging. Catch it (or retry with a longer timeout).",
    ],
    parameters: Type.Object({
      action: StringEnum([...ACTIONS], { description: "Operation to perform. `spawn` creates a fresh namespaced tmux session; `attach` references an existing pane; the rest operate on a `pane`." }),
      spawn: Type.Optional(Type.Object({
        command: Type.Optional(Type.String({ description: "Program to run. Default $SHELL (or zsh). e.g. \"pi\"." })),
        args: Type.Optional(Type.Array(Type.String())),
        cwd: Type.Optional(Type.String()),
        env: Type.Optional(Type.Record(Type.String(), Type.String())),
        width: Type.Optional(Type.Number({ description: "Cols. Default 120." })),
        height: Type.Optional(Type.Number({ description: "Rows. Default 40." })),
        windowName: Type.Optional(Type.String({ description: "Default \"pi-term\"." })),
      }, { description: "Used with action: spawn." })),
      pane: Type.Optional(Type.String({ description: "Pane id (from spawn/attach, or $TMUX_PANE). Required for all actions except spawn." })),
      keys: Type.Optional(Type.String({ description: "Used with action: send. LITERAL text to type — sent verbatim via `tmux send-keys -l`; no escape codes are interpreted. Use the `sendKey` action to press Enter/Esc/arrows/control keys." })),
      key: Type.Optional(Type.String({ description: "Used with action: sendKey. Named key: Enter, Escape, Tab, Space, BS, Up, Down, Left, Right, C-c, C-d, C-z, C-\\, F1-F4." })),
      ansi: Type.Optional(Type.Boolean({ description: "Used with capture/waitFor/waitForQuiet. When true, retain ANSI escapes (for style assertions)." })),
      pattern: Type.Optional(Type.String({ description: "Used with action: waitFor. A regex string — \"/regex/flags\" or a bare pattern. Compiled server-side." })),
      width: Type.Optional(Type.Number()),
      height: Type.Optional(Type.Number()),
      timeout: Type.Optional(Type.Number({ description: "ms. waitFor/waitForQuiet overall timeout. Default 5000." })),
      quietMs: Type.Optional(Type.Number({ description: "waitFor combined mode: pattern matched AND pane unchanged for quietMs ms." })),
      ms: Type.Optional(Type.Number({ description: "waitForQuiet: pane unchanged threshold. Default 300." })),
      interval: Type.Optional(Type.Number({ description: "Poll interval ms. Default 50." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const result = await dispatchAction(params as unknown as TermInput);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: result };
      } catch (err) {
        if (err instanceof TermTimeoutError) {
          return {
            content: [{ type: "text" as const, text: `term waitFor timed out after ${err.elapsed}ms (timeout ${err.timeout}ms)${err.pattern ? ` matching ${err.pattern}` : ""}. Last capture:\n${err.lastCapture.text}` }],
            details: { error: "TERM_TIMEOUT", pane: err.pane, elapsed: err.elapsed, timeout: err.timeout, pattern: err.pattern?.source },
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], details: { error: "UNEXPECTED" }, isError: true };
      }
    },
  });
}
