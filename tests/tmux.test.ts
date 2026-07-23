import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setExec, sendKeys, sendKey, capture, spawn, attach, resize, kill } from "../lib/tmux.ts";
import * as lifecycle from "../lib/lifecycle.ts";

let calls: string[][] = [];
let stdout: string = "";

beforeEach(() => {
  calls = [];
  stdout = "";
  lifecycle.setReapExec(async () => "");
  setExec(async (args) => { calls.push(args); return stdout; });
});

// --- sendKeys: PURE LITERAL (v0.2.0) -----------------------------------------
test("sendKeys: literal text → one -l call", async () => {
  await sendKeys("%5", "hello");
  assert.deepEqual(calls, [["send-keys", "-t", "%5", "-l", "hello"]]);
});
test("sendKeys: empty → no-op (no calls)", async () => {
  await sendKeys("%5", "");
  assert.deepEqual(calls, []);
});
test("sendKeys: a CR byte is sent LITERALLY, not as Enter (breaking change from v0.1.0)", async () => {
  await sendKeys("%5", "/todo\r"); // 6 chars incl. 0x0D
  assert.deepEqual(calls, [["send-keys", "-t", "%5", "-l", "/todo\r"]]);
});
test("sendKeys: backslash-r text typed literally (no translation table)", async () => {
  await sendKeys("%5", "/todo\\r"); // 7 visible chars
  assert.deepEqual(calls, [["send-keys", "-t", "%5", "-l", "/todo\\r"]]);
});

// --- sendKey (the "second button") ------------------------------------------
test("sendKey: C-c", async () => {
  await sendKey("%5", "C-c");
  assert.deepEqual(calls, [["send-keys", "-t", "%5", "C-c"]]);
});
test("sendKey: Enter", async () => {
  await sendKey("%5", "Enter");
  assert.deepEqual(calls, [["send-keys", "-t", "%5", "Enter"]]);
});
test("sendKey: Up", async () => {
  await sendKey("%5", "Up");
  assert.deepEqual(calls, [["send-keys", "-t", "%5", "Up"]]);
});

// --- capture -----------------------------------------------------------------
test("capture: parses capture-pane + display-message into CaptureResult", async () => {
  setExec(async (args) => {
    calls.push(args);
    if (args[0] === "capture-pane") return "line1\nline2\n";
    if (args[0] === "display-message") return "3 5 80 24 1\n";
    return "";
  });
  const r = await capture("%5");
  assert.equal(r.text, "line1\nline2\n");
  assert.deepEqual(r.lines, ["line1", "line2"]);
  assert.deepEqual(r.cursor, { x: 3, y: 5 });
  assert.equal(r.width, 80); assert.equal(r.height, 24); assert.equal(r.altScreen, true);
  assert.equal(r.ansi, undefined);
  assert.deepEqual(calls[0], ["capture-pane", "-t", "%5", "-p", "-J"]);
  assert.deepEqual(calls[1], ["display-message", "-t", "%5", "-p", "#{cursor_x} #{cursor_y} #{pane_width} #{pane_height} #{alternate_on}"]);
});
test("capture: ansi:true passes -e and sets ansi (text still stripped)", async () => {
  setExec(async (args) => {
    calls.push(args);
    if (args[0] === "capture-pane") return "\x1b[31mred\x1b[0m\n";
    return "0 0 10 5 0\n";
  });
  const r = await capture("%5", { ansi: true });
  assert.deepEqual(calls[0], ["capture-pane", "-t", "%5", "-p", "-J", "-e"]);
  assert.equal(r.ansi, "\x1b[31mred\x1b[0m\n");
  assert.equal(r.text, "red\n");
});

// --- spawn / attach / resize / kill ------------------------------------------
test("spawn: builds new-session args + registers pane", async () => {
  setExec(async (args) => {
    calls.push(args);
    if (args[0] === "new-session") return "";
    if (args[0] === "display-message" && args.includes("#{pane_id}")) return "%42\n";
    return "";
  });
  const r = await spawn({ command: "pi", args: ["--no-banner"], width: 100, height: 30, windowName: "qa" });
  assert.equal(r.pane, "%42");
  assert.ok(r.session.startsWith("pi-term-"));
  assert.equal(lifecycle.isSpawned("%42"), true);
  const newSess = calls.find((c) => c[0] === "new-session")!;
  assert.ok(newSess.includes("-d"));
  assert.ok(newSess.some((a, i) => a === "-n" && newSess[i + 1] === "qa"));
  lifecycle.unregister("%42");
});
test("spawn: defaults 120x40, windowName pi-term", async () => {
  setExec(async (args) => { calls.push(args); return args[0] === "display-message" && args.includes("#{pane_id}") ? "%1\n" : ""; });
  const r = await spawn();
  const newSess = calls.find((c) => c[0] === "new-session")!;
  assert.equal(newSess[newSess.indexOf("-x") + 1], "120");
  assert.equal(newSess[newSess.indexOf("-y") + 1], "40");
  assert.ok(newSess.some((a, i) => a === "-n" && newSess[i + 1] === "pi-term"));
  lifecycle.unregister("%1");
});
test("attach: validates pane + does NOT register", async () => {
  setExec(async (args) => { calls.push(args); return args[0] === "display-message" ? "pi-term-x\n" : ""; });
  const r = await attach("%9");
  assert.equal(r.pane, "%9"); assert.equal(r.session, "pi-term-x");
  assert.equal(lifecycle.isSpawned("%9"), false);
});
test("resize: builds resize-pane args", async () => {
  await resize("%5", 200, 50);
  assert.deepEqual(calls, [["resize-pane", "-t", "%5", "-x", "200", "-y", "50"]]);
});
test("kill: spawned pane → kill-session + unregister", async () => {
  lifecycle.register("%7", "pi-term-test");
  await kill("%7");
  assert.deepEqual(calls, [["kill-session", "-t", "pi-term-test"]]);
  assert.equal(lifecycle.isSpawned("%7"), false);
});
test("kill: attached pane (not spawned) → no-op", async () => {
  await kill("%99");
  assert.deepEqual(calls, []);
});
