import { test } from "node:test";
import assert from "node:assert/strict";
import { TermTimeoutError } from "../lib/error.ts";
import type { CaptureResult } from "../lib/types.ts";
const capture: CaptureResult = { text: "last", lines: ["last"], cursor: { x: 1, y: 2 }, width: 80, height: 24, altScreen: false };
test("error: TermTimeoutError carries the rich payload", () => {
  const err = new TermTimeoutError("%5", 5200, 5000, /Active/, capture);
  assert.equal(err.code, "TERM_TIMEOUT"); assert.equal(err.name, "TermTimeoutError"); assert.equal(err.pane, "%5");
  assert.equal(err.elapsed, 5200); assert.equal(err.timeout, 5000); assert.deepEqual(err.pattern, /Active/);
  assert.equal(err.lastCapture.text, "last"); assert.ok(err.message.includes("5200ms")); assert.ok(err.message.includes("Active"));
});
test("error: pattern is undefined for waitForQuiet timeouts", () => {
  const err = new TermTimeoutError("%5", 5000, 5000, undefined, capture);
  assert.equal(err.pattern, undefined); assert.ok(!err.message.includes("matching"));
});
test("error: is an Error instance", () => {
  const err = new TermTimeoutError("%5", 1, 1, undefined, capture);
  assert.ok(err instanceof Error); assert.ok(err instanceof TermTimeoutError);
});
