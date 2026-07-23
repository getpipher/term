import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatchAction } from "../lib/dispatch.ts";
import * as tmux from "../lib/tmux.ts";
import * as lifecycle from "../lib/lifecycle.ts";

let calls: string[][] = [];
beforeEach(() => {
  calls = [];
  lifecycle.setReapExec(async () => "");
  tmux.setExec(async (args) => {
    calls.push(args);
    if (args[0] === "display-message" && args.includes("#{pane_id}")) return "%5\n";
    if (args[0] === "display-message") return "0 0 80 24 0\n";
    if (args[0] === "capture-pane") return "ok\n";
    return "";
  });
});

test("tool: spawn → {pane, session}", async () => {
  const r = await dispatchAction({ action: "spawn", spawn: { command: "pi" } });
  assert.equal((r as { pane: string }).pane, "%5");
  assert.ok(String((r as { session: string }).session).startsWith("pi-term-"));
});

test("tool: send → {ok:true} (v0.2.0: keys is literal)", async () => {
  const r = await dispatchAction({ action: "send", pane: "%5", keys: "hi" });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(calls[0], ["send-keys", "-t", "%5", "-l", "hi"]);
});

test("tool: sendKey → {ok:true}", async () => {
  const r = await dispatchAction({ action: "sendKey", pane: "%5", key: "Enter" });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(calls, [["send-keys", "-t", "%5", "Enter"]]);
});

test("tool: capture → CaptureResult", async () => {
  const r = await dispatchAction({ action: "capture", pane: "%5" });
  assert.equal((r as { text: string }).text, "ok\n");
  assert.deepEqual((r as { cursor: unknown }).cursor, { x: 0, y: 0 });
});

test("tool: waitFor compiles pattern string → RegExp", async () => {
  const r = await dispatchAction({ action: "waitFor", pane: "%5", pattern: "ok", timeout: 200, interval: 1 });
  assert.equal((r as { text: string }).text, "ok\n");
});

test("tool: waitFor with /regex/flags syntax", async () => {
  const r = await dispatchAction({ action: "waitFor", pane: "%5", pattern: "/OK/i", timeout: 200, interval: 1 });
  assert.equal((r as { text: string }).text, "ok\n");
});

test("tool: waitFor invalid pattern → typed error (no throw into loop)", async () => {
  const r = await dispatchAction({ action: "waitFor", pane: "%5", pattern: "(unclosed", timeout: 100 });
  assert.equal((r as { error: string }).error, "INVALID_PATTERN");
});

test("tool: resize → {ok:true}", async () => {
  const r = await dispatchAction({ action: "resize", pane: "%5", width: 100, height: 30 });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(calls, [["resize-pane", "-t", "%5", "-x", "100", "-y", "30"]]);
});

test("tool: kill on attached pane → {ok:true} no-op", async () => {
  const r = await dispatchAction({ action: "kill", pane: "%99" });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(calls, []);
});

test("tool: unknown action → typed error", async () => {
  const r = await dispatchAction({ action: "frobnicate" as never, pane: "%5" });
  assert.equal((r as { error: string }).error, "UNKNOWN_ACTION");
});
