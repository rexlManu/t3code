import {
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import { OpenCodeServerManager } from "./opencodeServerManager.ts";

const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

function createContext(overrides?: {
  readonly activeTurnId?: TurnId | undefined;
  readonly client?: Record<string, unknown>;
}): Record<string, unknown> {
  const now = new Date().toISOString();
  const session: ProviderSession = {
    provider: "opencode",
    status: "ready",
    runtimeMode: "full-access",
    threadId: asThreadId("thread-1"),
    cwd: process.cwd(),
    createdAt: now,
    updatedAt: now,
    resumeCursor: { sessionId: "session-1" },
  };

  return {
    threadId: asThreadId("thread-1"),
    directory: process.cwd(),
    client: (overrides?.client ?? {}) as never,
    providerSessionId: "session-1",
    pendingPermissions: new Map(),
    pendingQuestions: new Map(),
    partStreamById: new Map(),
    streamAbortController: new AbortController(),
    streamTask: Promise.resolve(),
    session,
    activeTurnId: overrides?.activeTurnId ?? asTurnId("turn-1"),
    lastError: undefined,
  };
}

function dispatchOpenCodeEvent(
  manager: OpenCodeServerManager,
  context: Record<string, unknown>,
  event: Record<string, unknown>,
) {
  (manager as unknown as {
    handleEvent: (ctx: Record<string, unknown>, value: Record<string, unknown>) => void;
  }).handleEvent(context, event);
}

describe("OpenCodeServerManager", () => {
  it("emits reasoning deltas with reasoning_text stream kind", () => {
    const manager = new OpenCodeServerManager();
    const context = createContext();
    const received: ProviderRuntimeEvent[] = [];
    manager.on("event", (event) => {
      received.push(event);
    });

    dispatchOpenCodeEvent(manager, context, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-reasoning-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "reasoning",
          text: "",
          time: { start: Date.now() },
        },
      },
    });
    dispatchOpenCodeEvent(manager, context, {
      type: "message.part.delta",
      properties: {
        sessionID: "session-1",
        messageID: "message-1",
        partID: "part-reasoning-1",
        field: "text",
        delta: "Inspecting changed files",
      },
    });

    expect(received).toHaveLength(1);
    const [event] = received;
    expect(event?.type).toBe("content.delta");
    if (!event || event.type !== "content.delta") {
      return;
    }
    expect(event.payload.streamKind).toBe("reasoning_text");
    expect(event.payload.delta).toBe("Inspecting changed files");
  });

  it("maps running and completed tool parts into runtime lifecycle events", () => {
    const manager = new OpenCodeServerManager();
    const context = createContext();
    const received: ProviderRuntimeEvent[] = [];
    manager.on("event", (event) => {
      received.push(event);
    });

    dispatchOpenCodeEvent(manager, context, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-tool-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "running",
            input: {
              command: ["bun", "run", "lint"],
            },
            time: { start: Date.now() },
          },
        },
      },
    });
    dispatchOpenCodeEvent(manager, context, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-tool-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "completed",
            input: {
              command: ["bun", "run", "lint"],
            },
            output: "ok",
            title: "Lint complete",
            metadata: {},
            time: { start: Date.now() - 1000, end: Date.now() },
            attachments: [
              {
                id: "file-1",
                sessionID: "session-1",
                messageID: "message-1",
                type: "file",
                mime: "text/plain",
                filename: "apps/web/src/session-logic.ts",
                url: "file:///apps/web/src/session-logic.ts",
              },
            ],
          },
        },
      },
    });

    expect(received.map((event) => event.type)).toEqual(["item.updated", "item.completed", "tool.summary"]);
    const running = received[0];
    expect(running?.type).toBe("item.updated");
    if (running?.type === "item.updated") {
      expect(running.payload.itemType).toBe("command_execution");
      expect(running.payload.status).toBe("inProgress");
      expect(running.payload.detail).toBe("bun run lint");
    }

    const completed = received[1];
    expect(completed?.type).toBe("item.completed");
    if (completed?.type === "item.completed") {
      expect(completed.payload.itemType).toBe("command_execution");
      expect(completed.payload.status).toBe("completed");
      const data =
        completed.payload.data && typeof completed.payload.data === "object"
          ? (completed.payload.data as Record<string, unknown>)
          : undefined;
      expect(data?.command).toBe("bun run lint");
      expect(data?.changedFiles).toEqual([{ path: "apps/web/src/session-logic.ts" }]);
    }
  });

  it("maps patch parts into file-change lifecycle events", () => {
    const manager = new OpenCodeServerManager();
    const context = createContext();
    const received: ProviderRuntimeEvent[] = [];
    manager.on("event", (event) => {
      received.push(event);
    });

    dispatchOpenCodeEvent(manager, context, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-patch-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "patch",
          hash: "hash-1",
          files: ["apps/server/src/opencodeServerManager.ts", "apps/web/src/session-logic.ts"],
        },
      },
    });

    expect(received).toHaveLength(1);
    const [event] = received;
    expect(event?.type).toBe("item.completed");
    if (!event || event.type !== "item.completed") {
      return;
    }
    expect(event.payload.itemType).toBe("file_change");
    expect(event.payload.status).toBe("completed");
    const data =
      event.payload.data && typeof event.payload.data === "object"
        ? (event.payload.data as Record<string, unknown>)
        : undefined;
    expect(data?.changedFiles).toEqual([
      { path: "apps/server/src/opencodeServerManager.ts" },
      { path: "apps/web/src/session-logic.ts" },
    ]);
  });

  it("keeps glob tool calls out of file-change classification", () => {
    const manager = new OpenCodeServerManager();
    const context = createContext();
    const received: ProviderRuntimeEvent[] = [];
    manager.on("event", (event) => {
      received.push(event);
    });

    dispatchOpenCodeEvent(manager, context, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-tool-glob",
          sessionID: "session-1",
          messageID: "message-1",
          type: "tool",
          callID: "call-glob",
          tool: "glob",
          state: {
            status: "running",
            input: {
              pattern: "**/*.png",
              path: "/tmp/project",
            },
            time: { start: Date.now() },
          },
        },
      },
    });

    const [event] = received;
    expect(event?.type).toBe("item.updated");
    if (!event || event.type !== "item.updated") {
      return;
    }
    expect(event.payload.itemType).toBe("dynamic_tool_call");
    expect(event.payload.title).toBe("Glob");
  });

  it("forwards opencode reasoning effort as the prompt variant", async () => {
    const manager = new OpenCodeServerManager();
    const promptAsync = vi.fn(async () => undefined);
    const context = createContext({
      client: {
        session: {
          promptAsync,
        },
      },
    });

    (
      manager as unknown as {
        sessions: Map<ThreadId, Record<string, unknown>>;
      }
    ).sessions.set(asThreadId("thread-1"), context);

    await manager.sendTurn({
      threadId: asThreadId("thread-1"),
      input: "Inspect the failing test",
      model: "openai/gpt-5",
      modelOptions: {
        opencode: {
          reasoningEffort: "xhigh",
        },
      },
    });

    expect(promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "session-1",
        variant: "xhigh",
      }),
    );
  });
});
