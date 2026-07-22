import { test } from "node:test";
import assert from "node:assert/strict";

test("harness: node:test runs under tsx", () => {
  assert.equal(1 + 1, 2);
});
