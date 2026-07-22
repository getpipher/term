import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as lifecycle from "../lib/lifecycle.ts";
let reaped: string[] = []; let clock = 1_000;
function reset() { reaped = []; clock = 1_000; lifecycle.setReapExec(async (args) => { reaped.push(args.join(" ")); return ""; }); lifecycle.setClock(() => clock); for (const pane of lifecycle.allSpawnedPanes()) lifecycle.unregister(pane); }
beforeEach(reset);
afterEach(() => { for (const pane of lifecycle.allSpawnedPanes()) lifecycle.unregister(pane); });
test("lifecycle: register + isSpawned", () => { lifecycle.register("%5", "pi-term-1"); assert.equal(lifecycle.isSpawned("%5"), true); assert.equal(lifecycle.isSpawned("%6"), false); });
test("lifecycle: recordActivity updates lastActivity; reapExpired reaps past-lease", () => {
  lifecycle.register("%5", "pi-term-1"); clock = 1_000; lifecycle.recordActivity("%5"); clock = 5_000; lifecycle.recordActivity("%9");
  clock = 5_000 + 31 * 60 * 1000;
  const reapedNow = lifecycle.reapExpired();
  assert.deepEqual(reapedNow, ["%5"]); assert.equal(lifecycle.isSpawned("%5"), false); assert.deepEqual(reaped, ["kill-session -t pi-term-1"]);
});
test("lifecycle: reapExpired skips entries within lease", () => {
  lifecycle.register("%5", "pi-term-1"); clock = 1_000; lifecycle.recordActivity("%5"); clock = 1_000 + 29 * 60 * 1000;
  assert.deepEqual(lifecycle.reapExpired(), []); assert.equal(lifecycle.isSpawned("%5"), true); assert.deepEqual(reaped, []);
});
test("lifecycle: reapExpired respects a custom leaseMs", () => { lifecycle.register("%5", "pi-term-1", 60_000); clock = 1_000; lifecycle.recordActivity("%5"); clock = 1_000 + 90_000; assert.deepEqual(lifecycle.reapExpired(), ["%5"]); });
test("lifecycle: unregister removes the entry", () => { lifecycle.register("%5", "pi-term-1"); lifecycle.unregister("%5"); assert.equal(lifecycle.isSpawned("%5"), false); assert.deepEqual(lifecycle.reapExpired(), []); });
