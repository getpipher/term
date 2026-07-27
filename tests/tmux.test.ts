import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setExec, setInTmux, sendKeys, sendKey, capture, spawn, attach, resize, kill } from "../lib/tmux.ts";
import * as lifecycle from "../lib/lifecycle.ts";

let calls: string[][] = [];
let stdout: string = "";

beforeEach(() => {
  calls = [];
  stdout = "";
  setInTmux(() => false);  // default: session-mode (deterministic for legacy tests)
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

// --- spawn: window-mode (v0.4.0 — pi inside tmux) --------------------------
test("spawn: window-mode → new-window in current session + resize + register", async () => {
  setInTmux(() => true);
  setExec(async (args) => {
    calls.push(args);
    if (args[0] === "display-message" && args.includes("#{session_name}")) return "user-sess\n";
    if (args[0] === "new-window") return "@9|%42\n";  // window_id|pane_id (tmux -F does not interpret \t)
    if (args[0] === "resize-pane") return "";
    return "";
  });
  const r = await spawn({ command: "pi", args: ["--no-banner"], width: 100, height: 30, windowName: "qa" });
  assert.equal(r.pane, "%42");
  assert.equal(r.session, "user-sess");
  assert.equal(r.mode, "window");
  assert.equal(r.window, "@9");
  assert.match(r.windowName, /^qa-[a-z0-9]{6}$/);  // base-rand
  assert.equal(lifecycle.isSpawned("%42"), true);
  // new-window: detached, targets current session, prints window_id\tpane_id, runs the command
  const newWin = calls.find((c) => c[0] === "new-window")!;
  assert.ok(newWin.includes("-d"), "new-window must be detached (-d) so focus stays with the user");
  assert.ok(newWin.some((a, i) => a === "-t" && newWin[i + 1] === "user-sess"));
  assert.ok(newWin.some((a, i) => a === "-P" && newWin[i + 1] === "-F" && newWin[i + 2] === "#{window_id}|#{pane_id}"));
  assert.ok(newWin.includes("pi") && newWin.includes("--no-banner"));
  // resize applied to the new pane
  const rsz = calls.find((c) => c[0] === "resize-pane")!;
  assert.deepEqual(rsz, ["resize-pane", "-t", "%42", "-x", "100", "-y", "30"]);
  lifecycle.unregister("%42");
});
test("spawn: window-mode rejects malformed new-window output", async () => {
  setInTmux(() => true);
  setExec(async (args) => {
    calls.push(args);
    if (args[0] === "display-message") return "user-sess\n";
    if (args[0] === "new-window") return "garbage\n";  // no tab → can't parse
    return "";
  });
  await assert.rejects(spawn({ command: "pi" }), /unexpected new-window output/);
});
test("spawn: session-mode fallback when not in tmux (preserves v0.1 behavior)", async () => {
  setInTmux(() => false);
  setExec(async (args) => {
    calls.push(args);
    if (args[0] === "new-session") return "";
    if (args[0] === "display-message" && args.includes("#{pane_id}")) return "%7\n";
    return "";
  });
  const r = await spawn({ command: "pi", windowName: "qa" });
  assert.equal(r.mode, "session");
  assert.equal(r.window, undefined);
  assert.equal(r.windowName, "qa");  // no rand suffix in session-mode
  assert.ok(r.session.startsWith("pi-term-"));
  assert.ok(calls.some((c) => c[0] === "new-session"));
  assert.equal(calls.some((c) => c[0] === "new-window"), false);
  lifecycle.unregister("%7");
});
test("kill: window-mode spawned pane → kill-window -t <window_id>", async () => {
  lifecycle.register("%7", "user-sess", { mode: "window", window: "@9" });
  await kill("%7");
  assert.deepEqual(calls, [["kill-window", "-t", "@9"]]);
  assert.equal(lifecycle.isSpawned("%7"), false);
});
test("kill: window-mode without window id falls back to kill-session (defensive)", async () => {
  // shouldn't happen in practice, but the branch must stay safe
  lifecycle.register("%7", "user-sess", { mode: "window" });  // no window
  await kill("%7");
  assert.deepEqual(calls, [["kill-session", "-t", "user-sess"]]);
});
