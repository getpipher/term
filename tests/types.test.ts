import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  Pane,
  SpawnSpec,
  CaptureResult,
  WaitForOptions,
  WaitForQuietOptions,
  NamedKey,
  WaitForResult,
} from "../lib/types.ts";
import { TermTimeoutError } from "../lib/error.ts";

test("types: Pane is a string alias", () => {
  const p: Pane = "%5";
  assert.equal(p, "%5");
});

test("types: CaptureResult has the structured shape", () => {
  const c: CaptureResult = {
    text: "hi",
    lines: ["hi"],
    cursor: { x: 0, y: 0 },
    width: 80,
    height: 24,
    altScreen: false,
  };
  assert.deepEqual(c.cursor, { x: 0, y: 0 });
  assert.equal(c.altScreen, false);
});

test("types: WaitForOptions requires timeout", () => {
  const o: WaitForOptions = { timeout: 1000 };
  const combined: WaitForOptions = { timeout: 1000, quietMs: 300, ansi: false, interval: 50 };
  assert.equal(o.timeout, 1000);
  assert.equal(combined.quietMs, 300);
});

test("types: NamedKey covers the named-key set", () => {
  const keys: NamedKey[] = ["Enter", "Escape", "C-c", "Up", "F1", "BS"];
  assert.ok(keys.length === 6);
});

test("types: WaitForOptions accepts throws", () => {
  const a: WaitForOptions = { timeout: 1000 };
  const b: WaitForOptions = { timeout: 1000, throws: false };
  const c: WaitForOptions = { timeout: 1000, throws: true };
  assert.equal(a.throws, undefined);
  assert.equal(b.throws, false);
  assert.equal(c.throws, true);
});

test("types: WaitForQuietOptions accepts throws", () => {
  const a: WaitForQuietOptions = { ms: 300, timeout: 1000 };
  const b: WaitForQuietOptions = { ms: 300, timeout: 1000, throws: false };
  assert.equal(a.throws, undefined);
  assert.equal(b.throws, false);
});

test("types: WaitForResult narrows on ok", () => {
  const cap: CaptureResult = {
    text: "x", lines: ["x"], cursor: { x: 0, y: 0 },
    width: 80, height: 24, altScreen: false,
  };
  const ok: WaitForResult = { ok: true, result: cap };
  const err: WaitForResult = { ok: false, error: new TermTimeoutError("%5", 100, 1000, undefined, cap) };
  if (ok.ok) assert.equal(ok.result.text, "x");
  if (!err.ok) assert.equal(err.error.code, "TERM_TIMEOUT");
});
