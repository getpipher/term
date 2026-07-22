import type { Pane, CaptureResult } from "./types.ts";

export class TermTimeoutError extends Error {
  readonly code = "TERM_TIMEOUT" as const;

  constructor(
    public readonly pane: Pane,
    public readonly elapsed: number,
    public readonly timeout: number,
    public readonly pattern: RegExp | undefined,
    public readonly lastCapture: CaptureResult,
  ) {
    super(
      `term waitFor timed out after ${elapsed}ms (timeout ${timeout}ms)` +
        (pattern ? ` matching ${pattern}` : ""),
    );
    this.name = "TermTimeoutError";
  }
}
