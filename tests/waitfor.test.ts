import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setExec, waitFor, waitForQuiet } from "../lib/tmux.ts";
import { TermTimeoutError } from "../lib/error.ts";
import * as lifecycle from "../lib/lifecycle.ts";

let frames: { text: string; meta: string }[] = [];
let captureCount = 0;

function resetExec() {
  captureCount = 0;
  setExec(async (args) => {
    if (args[0] === "capture-pane") {
      const idx = Math.min(captureCount, frames.length - 1);
      captureCount++;
      return frames[idx]?.text ?? "";
    }
    if (args[0] === "display-message") {
      const idx = Math.min(captureCount - 1, frames.length - 1);
      return frames[idx]?.meta ?? "0 0 80 24 0\n";
    }
    return "";
  });
}

beforeEach(() => {
  frames = [];
  lifecycle.setReapExec(async () => "");
  resetExec();
});

function frame(text: string, meta = "0 0 80 24 0\n") {
  frames.push({ text, meta });
}

test("waitFor: resolves when pattern matches (no quietMs)", async () => {
  frame("loading");
  frame("Active todos");
  const r = await waitFor("%5", /Active/, { timeout: 2000, interval: 1 });
  assert.equal(r.text, "Active todos");
});

test("waitFor: combined — pattern matched AND pane quiet for quietMs", async () => {
  frame("Active A");
  frame("Active A");
  frame("Active A");
  const r = await waitFor("%5", /Active/, { timeout: 2000, quietMs: 2, interval: 1 });
  assert.equal(r.text, "Active A");
});

test("waitFor: throws TermTimeoutError on timeout", async () => {
  frame("nope");
  frame("still nope");
  await assert.rejects(
    () => waitFor("%5", /never/, { timeout: 20, interval: 1 }),
    (e: unknown) => e instanceof TermTimeoutError,
  );
});

test("waitForQuiet: resolves when pane unchanged for ms", async () => {
  frame("x");
  frame("x");
  const r = await waitForQuiet("%5", { ms: 1, timeout: 2000, interval: 1 });
  assert.equal(r.text, "x");
});

test("waitForQuiet: throws on timeout (always changing)", async () => {
  let n = 0;
  setExec(async (args) => {
    if (args[0] === "capture-pane") return `frame${n++}\n`;
    return "0 0 80 24 0\n";
  });
  await assert.rejects(
    () => waitForQuiet("%5", { ms: 1, timeout: 20, interval: 1 }),
    (e: unknown) => e instanceof TermTimeoutError,
  );
});

test("waitFor: { throws: false } resolves with { ok: true, result } on match", async () => {
  frame("loading");
  frame("Active todos");
  const r = await waitFor("%5", /Active/, { timeout: 2000, interval: 1, throws: false });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.result.text, "Active todos");
});

test("waitFor: { throws: false } returns { ok: false, error } on timeout (proves poll never throws)", async () => {
  frame("nope");
  frame("still nope");
  const r = await waitFor("%5", /never/, { timeout: 20, interval: 1, throws: false });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.error instanceof TermTimeoutError);
    assert.equal(r.error.code, "TERM_TIMEOUT");
    assert.equal(r.error.timeout, 20);
    assert.match(r.error.lastCapture.text, /nope/);
  }
});

test("waitFor: { throws: false } combined-mode timeout returns structured", async () => {
  let n = 0;
  setExec(async (args) => {
    if (args[0] === "capture-pane") return `Active ${n++}\n`;
    return "0 0 80 24 0\n";
  });
  const r = await waitFor("%5", /Active/, { timeout: 20, quietMs: 5, interval: 1, throws: false });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.error instanceof TermTimeoutError);
});

test("waitFor: default (no throws field) still throws TermTimeoutError", async () => {
  frame("nope");
  await assert.rejects(
    () => waitFor("%5", /never/, { timeout: 20, interval: 1 }),
    (e: unknown) => e instanceof TermTimeoutError,
  );
});

test("waitFor: { throws: true } explicit still throws", async () => {
  frame("nope");
  await assert.rejects(
    () => waitFor("%5", /never/, { timeout: 20, interval: 1, throws: true }),
    (e: unknown) => e instanceof TermTimeoutError,
  );
});

test("waitForQuiet: { throws: false } resolves with { ok: true, result }", async () => {
  frame("x");
  frame("x");
  const r = await waitForQuiet("%5", { ms: 1, timeout: 2000, interval: 1, throws: false });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.result.text, "x");
});

test("waitForQuiet: { throws: false } returns { ok: false, error } on timeout (pattern undefined)", async () => {
  let n = 0;
  setExec(async (args) => {
    if (args[0] === "capture-pane") return `frame${n++}\n`;
    return "0 0 80 24 0\n";
  });
  const r = await waitForQuiet("%5", { ms: 1, timeout: 20, interval: 1, throws: false });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.error instanceof TermTimeoutError);
    assert.equal(r.error.code, "TERM_TIMEOUT");
    assert.equal(r.error.pattern, undefined);
  }
});
