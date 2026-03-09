import type { OrchestrationEvent } from "@t3tools/contracts";

export type OrchestrationSyncPriority = "high" | "low";

const LOW_PRIORITY_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "thread.message-sent",
  "thread.activity-appended",
  "thread.proposed-plan-upserted",
]);

function maxPriority(
  left: OrchestrationSyncPriority | null,
  right: OrchestrationSyncPriority,
): OrchestrationSyncPriority {
  if (left === "high" || right === "high") {
    return "high";
  }
  return "low";
}

export function getOrchestrationSyncPriority(
  eventType: OrchestrationEvent["type"],
): OrchestrationSyncPriority {
  return LOW_PRIORITY_EVENT_TYPES.has(eventType) ? "low" : "high";
}

interface CreateOrchestrationSyncSchedulerOptions {
  readonly sync: () => Promise<number | void>;
  readonly lowPriorityDelayMs?: number;
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame?: (handle: number) => void;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
}

export interface OrchestrationSyncScheduler {
  readonly syncNow: () => void;
  readonly handleDomainEvent: (event: Pick<OrchestrationEvent, "sequence" | "type">) => void;
  readonly dispose: () => void;
}

export function createOrchestrationSyncScheduler(
  options: CreateOrchestrationSyncSchedulerOptions,
): OrchestrationSyncScheduler {
  const lowPriorityDelayMs = options.lowPriorityDelayMs ?? 250;
  const requestAnimationFrameFn =
    options.requestAnimationFrame ?? ((callback) => window.requestAnimationFrame(callback));
  const cancelAnimationFrameFn =
    options.cancelAnimationFrame ?? ((handle) => window.cancelAnimationFrame(handle));
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;

  let disposed = false;
  let latestSequence = 0;
  let syncing = false;
  let pendingPriority: OrchestrationSyncPriority | null = null;
  let lowPriorityTimer: ReturnType<typeof setTimeout> | null = null;
  let animationFrameHandle: number | null = null;

  const clearScheduledSync = () => {
    if (lowPriorityTimer !== null) {
      clearTimeoutFn(lowPriorityTimer);
      lowPriorityTimer = null;
    }
    if (animationFrameHandle !== null) {
      cancelAnimationFrameFn(animationFrameHandle);
      animationFrameHandle = null;
    }
  };

  const runSync = async () => {
    if (disposed || syncing) {
      return;
    }

    clearScheduledSync();
    syncing = true;
    try {
      const resultSequence = await options.sync();
      if (typeof resultSequence === "number" && Number.isFinite(resultSequence)) {
        latestSequence = Math.max(latestSequence, Math.floor(resultSequence));
      }
    } finally {
      syncing = false;
      const nextPriority = pendingPriority;
      pendingPriority = null;
      if (nextPriority) {
        scheduleSync(nextPriority);
      }
    }
  };

  const scheduleSync = (priority: OrchestrationSyncPriority) => {
    if (disposed) {
      return;
    }

    if (syncing) {
      pendingPriority = pendingPriority ? maxPriority(pendingPriority, priority) : priority;
      return;
    }

    if (priority === "high") {
      if (lowPriorityTimer !== null) {
        clearTimeoutFn(lowPriorityTimer);
        lowPriorityTimer = null;
      }
      if (animationFrameHandle !== null) {
        return;
      }
      animationFrameHandle = requestAnimationFrameFn(() => {
        animationFrameHandle = null;
        void runSync();
      });
      return;
    }

    if (animationFrameHandle !== null || lowPriorityTimer !== null) {
      return;
    }

    lowPriorityTimer = setTimeoutFn(() => {
      lowPriorityTimer = null;
      void runSync();
    }, lowPriorityDelayMs);
  };

  return {
    syncNow: () => {
      if (disposed) {
        return;
      }
      if (syncing) {
        pendingPriority = pendingPriority ? maxPriority(pendingPriority, "high") : "high";
        return;
      }
      void runSync();
    },
    handleDomainEvent: (event) => {
      if (disposed || event.sequence <= latestSequence) {
        return;
      }

      latestSequence = event.sequence;
      scheduleSync(getOrchestrationSyncPriority(event.type));
    },
    dispose: () => {
      disposed = true;
      pendingPriority = null;
      clearScheduledSync();
    },
  };
}
