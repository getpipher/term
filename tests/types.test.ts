import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  Pane,
  SpawnSpec,
  CaptureResult,
  WaitForOptions,
  WaitForQuietOptions,
  NamedKey,
} from "../lib/types.ts";

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
