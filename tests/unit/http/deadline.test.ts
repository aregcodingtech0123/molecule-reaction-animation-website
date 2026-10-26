/**
 * withDeadline (PERF-19): same deadline semantics as AbortSignal.timeout, but nothing outlives the call.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { withDeadline } from "@/lib/http/deadline";

afterEach(() => {
  vi.useRealTimers();
});

describe("withDeadline", () => {
  it("aborts the signal with a TimeoutError when the deadline passes", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | null = null;
    const pending = withDeadline(1000, (signal) => {
      seen = signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    });
    const assertion = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(999);
    expect(seen!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(seen!.aborted).toBe(true);
  });

  it("clears its timer as soon as the call settles (nothing is left to keep the call alive)", async () => {
    vi.useFakeTimers();
    await expect(withDeadline(30_000, async () => "done")).resolves.toBe("done");
    expect(vi.getTimerCount()).toBe(0);
    await expect(withDeadline(30_000, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not abort a call that finished in time", async () => {
    let signal: AbortSignal | null = null;
    await withDeadline(50, async (s) => {
      signal = s;
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(signal!.aborted).toBe(false);
  });
});
