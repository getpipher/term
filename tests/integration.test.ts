import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const TMUX_AVAILABLE = (() => {
  try {
    return spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
})();

test("integration: spawn a real tmux, send 'hello\\r', capture, kill", {
  skip: !TMUX_AVAILABLE,
}, async (t) => {
  let tmux: typeof import("../lib/tmux.ts");
  try {
    tmux = await import("../lib/tmux.ts");
  } catch (e) {
    t.skip(`lib/tmux.ts not resolvable in this run: ${(e as Error).message}`);
    return;
  }
  // Real exec (not a mock) — drives a genuine tmux server.
  tmux.setExec(async (args: string[]) => {
    const { spawn } = await import("node:child_process");
    return new Promise<string>((resolve, reject) => {
      const p = spawn("tmux", args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      p.stdout.on("data", (d) => { out += d; });
      p.on("close", (c) => (c === 0 ? resolve(out) : reject(new Error(`tmux ${args.join(" ")} exited ${c}`))));
      p.on("error", reject);
    });
  });
  const { pane } = await tmux.spawn({
    command: "sh", args: ["-c", "printf 'hello\\r'; sleep 0.3"],
    height: 10, width: 40, windowName: "int",
  });
  try {
    const r = await tmux.waitFor(pane, /hello/, { timeout: 3000, interval: 50 });
    assert.match(r.text, /hello/);
  } finally {
    await tmux.kill(pane);
  }
});
