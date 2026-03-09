import { describe, expect, it, vi } from "vitest";

import { createOrchestrationSyncScheduler } from "./orchestrationSync";

function nextMicrotask(): Promise<void> {
  return Promise.resolve();
}

describe("createOrchestrationSyncScheduler", () => {
  it("coalesces low-priority events into one sync", async () => {
    vi.useFakeTimers();

    const sync = vi.fn(async () => 3);
    const scheduler = createOrchestrationSyncScheduler({
      sync,
      lowPriorityDelayMs: 250,
      requestAnimationFrame: (callback) => setTimeout(() => callback(0), 0) as unknown as number,
      cancelAnimationFrame: (handle) => clearTimeout(handle),
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    });

    scheduler.handleDomainEvent({ sequence: 1, type: "thread.message-sent" });
    scheduler.handleDomainEvent({ sequence: 2, type: "thread.activity-appended" });
    scheduler.handleDomainEvent({ sequence: 3, type: "thread.proposed-plan-upserted" });

    await vi.advanceTimersByTimeAsync(249);
    expect(sync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(1);

    scheduler.dispose();
    vi.useRealTimers();
  });

  it("promotes a pending low-priority sync when a high-priority event arrives", async () => {
    vi.useFakeTimers();

    const sync = vi.fn(async () => 2);
    const scheduler = createOrchestrationSyncScheduler({
      sync,
      lowPriorityDelayMs: 250,
      requestAnimationFrame: (callback) => setTimeout(() => callback(0), 0) as unknown as number,
      cancelAnimationFrame: (handle) => clearTimeout(handle),
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    });

    scheduler.handleDomainEvent({ sequence: 1, type: "thread.message-sent" });
    await vi.advanceTimersByTimeAsync(100);

    scheduler.handleDomainEvent({ sequence: 2, type: "thread.created" });
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);
    expect(sync).toHaveBeenCalledTimes(1);

    scheduler.dispose();
    vi.useRealTimers();
  });

  it("keeps one trailing sync while a snapshot refresh is already in flight", async () => {
    vi.useFakeTimers();

    let resolveSync: ((value: number) => void) | null = null;
    const sync = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveSync = resolve;
        }),
    );
    const scheduler = createOrchestrationSyncScheduler({
      sync,
      lowPriorityDelayMs: 250,
      requestAnimationFrame: (callback) => setTimeout(() => callback(0), 0) as unknown as number,
      cancelAnimationFrame: (handle) => clearTimeout(handle),
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    });

    scheduler.handleDomainEvent({ sequence: 1, type: "thread.created" });
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);

    scheduler.handleDomainEvent({ sequence: 2, type: "thread.message-sent" });
    scheduler.handleDomainEvent({ sequence: 3, type: "thread.activity-appended" });
    scheduler.handleDomainEvent({ sequence: 4, type: "thread.session-set" });
    expect(sync).toHaveBeenCalledTimes(1);

    resolveSync?.(4);
    await nextMicrotask();
    await vi.advanceTimersByTimeAsync(0);

    expect(sync).toHaveBeenCalledTimes(2);

    scheduler.dispose();
    vi.useRealTimers();
  });
});
