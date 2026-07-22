import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { parseKeys, setExec, sendKeys, sendKey, capture, spawn, attach, resize, kill } from "../lib/tmux.ts";
import * as lifecycle from "../lib/lifecycle.ts";
let calls: string[][] = []; let stdout: string = "";
beforeEach(() => { calls = []; stdout = ""; lifecycle.setReapExec(async () => ""); setExec(async (args) => { calls.push(args); return stdout; }); });
test("parseKeys: pure literal", () => { assert.deepEqual(parseKeys("hello"), [{ kind: "literal", text: "hello" }]); });
test("parseKeys: trailing \\r", () => { assert.deepEqual(parseKeys("/todo\r"), [{ kind: "literal", text: "/todo" }, { kind: "key", name: "Enter" }]); });
test("parseKeys: \\x1b[A → Up", () => { assert.deepEqual(parseKeys("\x1b[A"), [{ kind: "key", name: "Up" }]); });
test("parseKeys: \\x03 → C-c", () => { assert.deepEqual(parseKeys("\x03"), [{ kind: "key", name: "C-c" }]); });
test("parseKeys: mixed", () => { assert.deepEqual(parseKeys("ab\r\tcd\x1b[B"), [{ kind: "literal", text: "ab" }, { kind: "key", name: "Enter" }, { kind: "key", name: "Tab" }, { kind: "literal", text: "cd" }, { kind: "key", name: "Down" }]); });
test("parseKeys: empty", () => { assert.deepEqual(parseKeys(""), []); });
test("sendKeys: literal + named key", async () => { await sendKeys("%5", "/todo\r"); assert.deepEqual(calls, [["send-keys", "-t", "%5", "-l", "/todo"], ["send-keys", "-t", "%5", "Enter"]]); });
test("sendKeys: pure literal", async () => { await sendKeys("%5", "hello"); assert.deepEqual(calls, [["send-keys", "-t", "%5", "-l", "hello"]]); });
test("sendKeys: empty", async () => { await sendKeys("%5", ""); assert.deepEqual(calls, []); });
test("sendKey: C-c", async () => { await sendKey("%5", "C-c"); assert.deepEqual(calls, [["send-keys", "-t", "%5", "C-c"]]); });
test("sendKey: Enter", async () => { await sendKey("%5", "Enter"); assert.deepEqual(calls, [["send-keys", "-t", "%5", "Enter"]]); });
test("capture: parses pane+meta", async () => {
  setExec(async (args) => { calls.push(args); if (args[0] === "capture-pane") return "line1\nline2\n"; if (args[0] === "display-message") return "3 5 80 24 1\n"; return ""; });
  const r = await capture("%5");
  assert.equal(r.text, "line1\nline2\n"); assert.deepEqual(r.lines, ["line1", "line2"]); assert.deepEqual(r.cursor, { x: 3, y: 5 });
  assert.equal(r.width, 80); assert.equal(r.height, 24); assert.equal(r.altScreen, true); assert.equal(r.ansi, undefined);
  assert.deepEqual(calls[0], ["capture-pane", "-t", "%5", "-p", "-J"]);
  assert.deepEqual(calls[1], ["display-message", "-t", "%5", "-p", "#{cursor_x} #{cursor_y} #{pane_width} #{pane_height} #{alternate_on}"]);
});
test("capture: ansi:true", async () => {
  setExec(async (args) => { calls.push(args); if (args[0] === "capture-pane") return "\x1b[31mred\x1b[0m\n"; return "0 0 10 5 0\n"; });
  const r = await capture("%5", { ansi: true });
  assert.deepEqual(calls[0], ["capture-pane", "-t", "%5", "-p", "-J", "-e"]); assert.equal(r.ansi, "\x1b[31mred\x1b[0m\n"); assert.equal(r.text, "red\n");
});
test("spawn: args + register", async () => {
  setExec(async (args) => { calls.push(args); if (args[0] === "new-session") return ""; if (args[0] === "display-message" && args.includes("#{pane_id}")) return "%42\n"; return ""; });
  const r = await spawn({ command: "pi", args: ["--no-banner"], width: 100, height: 30, windowName: "qa" });
  assert.equal(r.pane, "%42"); assert.ok(r.session.startsWith("pi-term-")); assert.equal(lifecycle.isSpawned("%42"), true);
  const newSess = calls.find((c) => c[0] === "new-session")!;
  assert.ok(newSess.includes("-d")); assert.ok(newSess.some((a, i) => a === "-n" && newSess[i + 1] === "qa"));
  lifecycle.unregister("%42");
});
test("spawn: defaults 120x40", async () => {
  setExec(async (args) => { calls.push(args); return args[0] === "display-message" && args.includes("#{pane_id}") ? "%1\n" : ""; });
  const r = await spawn();
  const newSess = calls.find((c) => c[0] === "new-session")!;
  assert.equal(newSess[newSess.indexOf("-x") + 1], "120"); assert.equal(newSess[newSess.indexOf("-y") + 1], "40");
  assert.ok(newSess.some((a, i) => a === "-n" && newSess[i + 1] === "pi-term"));
  lifecycle.unregister("%1");
});
test("attach: no register", async () => {
  setExec(async (args) => { calls.push(args); return args[0] === "display-message" ? "pi-term-x\n" : ""; });
  const r = await attach("%9"); assert.equal(r.pane, "%9"); assert.equal(r.session, "pi-term-x"); assert.equal(lifecycle.isSpawned("%9"), false);
});
test("resize", async () => { await resize("%5", 200, 50); assert.deepEqual(calls, [["resize-pane", "-t", "%5", "-x", "200", "-y", "50"]]); });
test("kill: spawned", async () => { lifecycle.register("%7", "pi-term-test"); await kill("%7"); assert.deepEqual(calls, [["kill-session", "-t", "pi-term-test"]]); assert.equal(lifecycle.isSpawned("%7"), false); });
test("kill: attached no-op", async () => { await kill("%99"); assert.deepEqual(calls, []); });
