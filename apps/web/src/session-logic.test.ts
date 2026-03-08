import { EventId, MessageId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveActiveWorkStartedAt,
  deriveActivePlanState,
  PROVIDER_OPTIONS,
  derivePendingApprovals,
  derivePendingUserInputs,
  deriveTimelineEntries,
  deriveWorkLogEntries,
  findLatestProposedPlan,
  hasToolActivityForTurn,
  isLatestTurnSettled,
} from "./session-logic";

function makeActivity(overrides: {
  id?: string;
  createdAt?: string;
  kind?: string;
  summary?: string;
  tone?: OrchestrationThreadActivity["tone"];
  payload?: Record<string, unknown>;
  turnId?: string;
  sequence?: number;
}): OrchestrationThreadActivity {
  const payload = overrides.payload ?? {};
  return {
    id: EventId.makeUnsafe(overrides.id ?? crypto.randomUUID()),
    createdAt: overrides.createdAt ?? "2026-02-23T00:00:00.000Z",
    kind: overrides.kind ?? "tool.started",
    summary: overrides.summary ?? "Tool call",
    tone: overrides.tone ?? "tool",
    payload,
    turnId: overrides.turnId ? TurnId.makeUnsafe(overrides.turnId) : null,
    ...(overrides.sequence !== undefined ? { sequence: overrides.sequence } : {}),
  };
}

describe("derivePendingApprovals", () => {
  it("tracks open approvals and removes resolved ones", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-1",
          requestKind: "command",
          detail: "bun run lint",
        },
      }),
      makeActivity({
        id: "approval-close",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "approval.resolved",
        summary: "Approval resolved",
        tone: "info",
        payload: { requestId: "req-2" },
      }),
      makeActivity({
        id: "approval-closed-request",
        createdAt: "2026-02-23T00:00:01.500Z",
        kind: "approval.requested",
        summary: "File-change approval requested",
        tone: "approval",
        payload: { requestId: "req-2", requestKind: "file-change" },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-1",
        requestKind: "command",
        createdAt: "2026-02-23T00:00:01.000Z",
        detail: "bun run lint",
      },
    ]);
  });

  it("maps canonical requestType payloads into pending approvals", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-request-type",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-request-type",
          requestType: "command_execution_approval",
          detail: "pwd",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-request-type",
        requestKind: "command",
        createdAt: "2026-02-23T00:00:01.000Z",
        detail: "pwd",
      },
    ]);
  });

  it("clears stale pending approvals when provider reports unknown pending request", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-stale",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-stale-1",
          requestKind: "command",
        },
      }),
      makeActivity({
        id: "approval-failed-stale",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        tone: "error",
        payload: {
          requestId: "req-stale-1",
          detail: "Unknown pending permission request: req-stale-1",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([]);
  });
});

describe("derivePendingUserInputs", () => {
  it("tracks open structured prompts and removes resolved ones", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "user-input-open",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "user-input.requested",
        summary: "User input requested",
        tone: "info",
        payload: {
          requestId: "req-user-input-1",
          questions: [
            {
              id: "sandbox_mode",
              header: "Sandbox",
              question: "Which mode should be used?",
              options: [
                {
                  label: "workspace-write",
                  description: "Allow workspace writes only",
                },
              ],
            },
          ],
        },
      }),
      makeActivity({
        id: "user-input-resolved",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "user-input.resolved",
        summary: "User input submitted",
        tone: "info",
        payload: {
          requestId: "req-user-input-2",
          answers: {
            sandbox_mode: "workspace-write",
          },
        },
      }),
      makeActivity({
        id: "user-input-open-2",
        createdAt: "2026-02-23T00:00:01.500Z",
        kind: "user-input.requested",
        summary: "User input requested",
        tone: "info",
        payload: {
          requestId: "req-user-input-2",
          questions: [
            {
              id: "approval",
              header: "Approval",
              question: "Continue?",
              options: [
                {
                  label: "yes",
                  description: "Continue execution",
                },
              ],
            },
          ],
        },
      }),
    ];

    expect(derivePendingUserInputs(activities)).toEqual([
      {
        requestId: "req-user-input-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        questions: [
          {
            id: "sandbox_mode",
            header: "Sandbox",
            question: "Which mode should be used?",
            options: [
              {
                label: "workspace-write",
                description: "Allow workspace writes only",
              },
            ],
          },
        ],
      },
    ]);
  });
});

describe("deriveActivePlanState", () => {
  it("returns the latest plan update for the active turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-old",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          explanation: "Initial plan",
          plan: [{ step: "Inspect code", status: "pending" }],
        },
      }),
      makeActivity({
        id: "plan-latest",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          explanation: "Refined plan",
          plan: [{ step: "Implement Codex user input", status: "inProgress" }],
        },
      }),
    ];

    expect(deriveActivePlanState(activities, TurnId.makeUnsafe("turn-1"))).toEqual({
      createdAt: "2026-02-23T00:00:02.000Z",
      turnId: "turn-1",
      explanation: "Refined plan",
      steps: [{ step: "Implement Codex user input", status: "inProgress" }],
    });
  });
});

describe("findLatestProposedPlan", () => {
  it("prefers the latest proposed plan for the active turn", () => {
    expect(
      findLatestProposedPlan(
        [
          {
            id: "plan:thread-1:turn:turn-1",
            turnId: TurnId.makeUnsafe("turn-1"),
            planMarkdown: "# Older",
            createdAt: "2026-02-23T00:00:01.000Z",
            updatedAt: "2026-02-23T00:00:01.000Z",
          },
          {
            id: "plan:thread-1:turn:turn-1",
            turnId: TurnId.makeUnsafe("turn-1"),
            planMarkdown: "# Latest",
            createdAt: "2026-02-23T00:00:01.000Z",
            updatedAt: "2026-02-23T00:00:02.000Z",
          },
          {
            id: "plan:thread-1:turn:turn-2",
            turnId: TurnId.makeUnsafe("turn-2"),
            planMarkdown: "# Different turn",
            createdAt: "2026-02-23T00:00:03.000Z",
            updatedAt: "2026-02-23T00:00:03.000Z",
          },
        ],
        TurnId.makeUnsafe("turn-1"),
      ),
    ).toEqual({
      id: "plan:thread-1:turn:turn-1",
      turnId: "turn-1",
      planMarkdown: "# Latest",
      createdAt: "2026-02-23T00:00:01.000Z",
      updatedAt: "2026-02-23T00:00:02.000Z",
    });
  });

  it("falls back to the most recently updated proposed plan", () => {
    const latestPlan = findLatestProposedPlan(
      [
        {
          id: "plan:thread-1:turn:turn-1",
          turnId: TurnId.makeUnsafe("turn-1"),
          planMarkdown: "# First",
          createdAt: "2026-02-23T00:00:01.000Z",
          updatedAt: "2026-02-23T00:00:01.000Z",
        },
        {
          id: "plan:thread-1:turn:turn-2",
          turnId: TurnId.makeUnsafe("turn-2"),
          planMarkdown: "# Latest",
          createdAt: "2026-02-23T00:00:02.000Z",
          updatedAt: "2026-02-23T00:00:03.000Z",
        },
      ],
      null,
    );

    expect(latestPlan?.planMarkdown).toBe("# Latest");
  });
});

describe("deriveWorkLogEntries", () => {
  it("omits tool started entries and keeps completed entries", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "tool-start",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Tool call",
        kind: "tool.started",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["tool-complete"]);
  });

  it("omits task start and completion lifecycle entries", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "task-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "task.started",
        summary: "default task started",
        tone: "info",
      }),
      makeActivity({
        id: "task-progress",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "task.progress",
        summary: "Updating files",
        tone: "info",
      }),
      makeActivity({
        id: "task-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "task.completed",
        summary: "Task completed",
        tone: "info",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["task-progress"]);
  });

  it("suppresses noisy OpenCode progress churn while keeping completed work", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "reasoning-delta",
        createdAt: "2026-02-23T00:00:00.500Z",
        kind: "reasoning.delta",
        summary: "Thinking",
        tone: "info",
        payload: {
          detail: "Tracing the OpenCode tool stream.",
        },
      }),
      makeActivity({
        id: "reasoning-progress",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "task.progress",
        summary: "Thinking",
        payload: {
          detail:
            "**Evaluating project needs** Ineedtoaanswerquestionabouttherepoandeditthe.gitignorefile",
        },
      }),
      makeActivity({
        id: "tool-update",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.updated",
        summary: "Run command",
      }),
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Shows installed DDEV version complete",
        tone: "tool",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined, "opencode");
    expect(entries.map((entry) => entry.id)).toEqual(["tool-complete"]);
  });

  it("filters by turn id when provided", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({ id: "turn-1", turnId: "turn-1", summary: "Tool call", kind: "tool.started" }),
      makeActivity({
        id: "turn-2",
        turnId: "turn-2",
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({ id: "no-turn", summary: "Checkpoint captured", tone: "info" }),
    ];

    const entries = deriveWorkLogEntries(activities, TurnId.makeUnsafe("turn-2"));
    expect(entries.map((entry) => entry.id)).toEqual(["turn-2"]);
  });

  it("omits checkpoint captured info entries", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "checkpoint",
        createdAt: "2026-02-23T00:00:01.000Z",
        summary: "Checkpoint captured",
        tone: "info",
      }),
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Command run complete",
        tone: "tool",
        kind: "tool.completed",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["tool-complete"]);
  });

  it("orders work log by activity sequence when present", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "second",
        createdAt: "2026-02-23T00:00:03.000Z",
        sequence: 2,
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "first",
        createdAt: "2026-02-23T00:00:04.000Z",
        sequence: 1,
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("extracts command text for command tool activities", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool",
        kind: "tool.completed",
        summary: "Command run complete",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: ["bun", "run", "lint"],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.command).toBe("bun run lint");
  });

  it("extracts nested OpenCode command input from tool state", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "opencode-command-tool",
        kind: "tool.updated",
        summary: "Run command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              state: {
                input: {
                  command: ["pnpm", "lint"],
                },
              },
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.command).toBe("pnpm lint");
  });

  it("extracts rich OpenCode tool call details", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "opencode-rich-tool",
        kind: "tool.completed",
        summary: "Web search complete",
        payload: {
          itemType: "web_search",
          status: "completed",
          data: {
            item: {
              tool: "search",
              state: {
                input: {
                  query: "opencode variants",
                  limit: 5,
                },
                output: "Found matching docs and examples",
              },
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.toolCall).toEqual({
      name: "search",
      status: "completed",
      itemType: "web_search",
      input: "query: opencode variants  ·  limit: 5",
    });
  });

  it("collapses read tool details down to the target path", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "read-tool",
        kind: "tool.completed",
        summary: "Read complete",
        payload: {
          itemType: "dynamic_tool_call",
          status: "completed",
          data: {
            item: {
              tool: "read",
              state: {
                input: {
                  filePath: "apps/web/package.json",
                  offset: 1,
                  limit: 220,
                },
              },
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.toolCall).toEqual({
      name: "read",
      status: "completed",
      itemType: "dynamic_tool_call",
      input: "apps/web/package.json",
      targetPath: "apps/web/package.json",
      compact: "path",
    });
  });

  it("extracts Claude tool metadata from data.toolName and data.input", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "claude-read-tool",
        kind: "tool.completed",
        summary: "Tool call complete",
        payload: {
          itemType: "dynamic_tool_call",
          status: "completed",
          data: {
            toolName: "Read",
            input: {
              file_path: "apps/server/package.json",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.toolCall).toEqual({
      name: "Read",
      status: "completed",
      itemType: "dynamic_tool_call",
      input: "apps/server/package.json",
      targetPath: "apps/server/package.json",
      compact: "path",
    });
  });

  it("collapses grep and glob tool details down to the target path", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "grep-tool",
        kind: "tool.completed",
        summary: "Grep complete",
        payload: {
          itemType: "dynamic_tool_call",
          status: "completed",
          data: {
            item: {
              tool: "grep",
              state: {
                input: {
                  pattern: "foo",
                  path: "/tmp/project",
                },
              },
            },
          },
        },
      }),
      makeActivity({
        id: "glob-tool",
        kind: "tool.completed",
        summary: "Glob complete",
        payload: {
          itemType: "dynamic_tool_call",
          status: "completed",
          data: {
            item: {
              tool: "glob",
              state: {
                input: {
                  pattern: "**/*.ts",
                  path: "/tmp/project",
                },
              },
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries[0]?.toolCall?.input).toBe("/tmp/project");
    expect(entries[0]?.toolCall?.compact).toBe("path");
    expect(entries[1]?.toolCall?.input).toBe("/tmp/project");
    expect(entries[1]?.toolCall?.compact).toBe("path");
  });

  it("ignores generic Gemini tool placeholders when inferring the tool name", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "gemini-tool",
        kind: "tool.completed",
        summary: "Tool complete",
        payload: {
          itemType: "dynamic_tool_call",
          status: "completed",
          title: "tool",
          data: {
            tool_name: "tool",
            rawInput: {
              pattern: "**/*.ts",
              path: "/tmp/project",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.toolCall?.name).toBe("glob");
    expect(entry?.toolCall?.targetPath).toBe("/tmp/project");
  });

  it("extracts changed file paths for file-change tool activities", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "file-tool",
        kind: "tool.completed",
        summary: "File change complete",
        payload: {
          itemType: "file_change",
          data: {
            item: {
              changes: [
                { path: "apps/web/src/components/ChatView.tsx" },
                { filename: "apps/web/src/session-logic.ts" },
              ],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.changedFiles).toEqual([
      { path: "apps/web/src/components/ChatView.tsx" },
      { path: "apps/web/src/session-logic.ts" },
    ]);
  });

  it("extracts changed file paths from Claude file-change input", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "claude-edit-tool",
        kind: "tool.completed",
        summary: "File change complete",
        payload: {
          itemType: "file_change",
          status: "completed",
          data: {
            toolName: "Edit",
            input: {
              file_path: "apps/web/src/appSettings.ts",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.changedFiles).toEqual([{ path: "apps/web/src/appSettings.ts" }]);
  });

  it("extracts changed files from patch/update detail text", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "patch-work-event",
        kind: "tool.completed",
        summary: "Patch applied complete",
        payload: {
          detail: "Success. Updated the following files: M apps/web/src/appSettings.ts",
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.changedFiles).toEqual([{ path: "apps/web/src/appSettings.ts" }]);
  });

  it("does not surface read-only tool paths as changed files", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "glob-tool",
        kind: "tool.updated",
        summary: "Glob",
        payload: {
          itemType: "dynamic_tool_call",
          data: {
            item: {
              tool: "glob",
              state: {
                input: {
                  pattern: "**/*.png",
                  path: "/tmp/project",
                },
              },
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.changedFiles).toBeUndefined();
    expect(entry?.toolCall?.input).toBe("/tmp/project");
    expect(entry?.toolCall?.compact).toBe("path");
  });

  it("hides internal TodoWrite work log events", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "todo-write",
        kind: "tool.completed",
        summary: "TodoWrite complete",
        tone: "tool",
        payload: {
          itemType: "dynamic_tool_call",
          title: "TodoWrite",
          status: "completed",
          data: {
            item: {
              tool: "TodoWrite",
            },
          },
        },
      }),
      makeActivity({
        id: "read-tool",
        kind: "tool.completed",
        summary: "Read complete",
        tone: "tool",
        payload: {
          itemType: "dynamic_tool_call",
          data: {
            item: {
              tool: "read",
              state: {
                input: {
                  filePath: "apps/web/package.json",
                },
              },
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["read-tool"]);
  });

  it("hides empty generic Claude tool rows", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "claude-empty-tool",
        kind: "tool.completed",
        summary: "Tool call complete",
        tone: "tool",
        payload: {
          itemType: "dynamic_tool_call",
          status: "completed",
          detail: "Read: {}",
          data: {
            toolName: "Read",
            input: {},
          },
        },
      }),
      makeActivity({
        id: "claude-empty-file-change",
        kind: "tool.completed",
        summary: "File change complete",
        tone: "tool",
        payload: {
          itemType: "file_change",
          status: "completed",
          detail: "Edit: {}",
          data: {
            toolName: "Edit",
            input: {},
          },
        },
      }),
    ];

    expect(deriveWorkLogEntries(activities, undefined)).toEqual([]);
  });

  it("renders reasoning deltas as thinking entries", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "reasoning-delta",
        kind: "reasoning.delta",
        summary: "Thinking",
        tone: "info",
        payload: {
          detail: "Tracing the OpenCode tool stream.",
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.tone).toBe("thinking");
    expect(entry?.detail).toBe("Tracing the OpenCode tool stream.");
  });

  it("merges consecutive reasoning deltas into a single thinking entry", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "reasoning-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        turnId: "turn-1",
        kind: "reasoning.delta",
        summary: "Thinking",
        tone: "info",
        payload: {
          detail: "**Fix",
        },
      }),
      makeActivity({
        id: "reasoning-2",
        createdAt: "2026-02-23T00:00:02.000Z",
        turnId: "turn-1",
        kind: "reasoning.delta",
        summary: "Thinking",
        tone: "info",
        payload: {
          detail: "ing",
        },
      }),
      makeActivity({
        id: "reasoning-3",
        createdAt: "2026-02-23T00:00:03.000Z",
        turnId: "turn-1",
        kind: "reasoning.delta",
        summary: "Thinking",
        tone: "info",
        payload: {
          detail: " app icon issues",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.detail).toBe("**Fixing app icon issues");
    expect(entries[0]?.tone).toBe("thinking");
  });
});

describe("deriveTimelineEntries", () => {
  it("includes proposed plans alongside messages and work entries in chronological order", () => {
    const entries = deriveTimelineEntries(
      [
        {
          id: MessageId.makeUnsafe("message-1"),
          role: "assistant",
          text: "hello",
          createdAt: "2026-02-23T00:00:01.000Z",
          streaming: false,
        },
      ],
      [
        {
          id: "plan:thread-1:turn:turn-1",
          turnId: TurnId.makeUnsafe("turn-1"),
          planMarkdown: "# Ship it",
          createdAt: "2026-02-23T00:00:02.000Z",
          updatedAt: "2026-02-23T00:00:02.000Z",
        },
      ],
      [
        {
          id: "work-1",
          createdAt: "2026-02-23T00:00:03.000Z",
          label: "Ran tests",
          tone: "tool",
        },
      ],
    );

    expect(entries.map((entry) => entry.kind)).toEqual(["message", "proposed-plan", "work"]);
    expect(entries[1]).toMatchObject({
      kind: "proposed-plan",
      proposedPlan: {
        planMarkdown: "# Ship it",
      },
    });
  });
});

describe("hasToolActivityForTurn", () => {
  it("returns false when turn id is missing", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({ id: "tool-1", turnId: "turn-1", kind: "tool.completed", tone: "tool" }),
    ];

    expect(hasToolActivityForTurn(activities, undefined)).toBe(false);
    expect(hasToolActivityForTurn(activities, null)).toBe(false);
  });

  it("returns true only for matching tool activity in the target turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({ id: "tool-1", turnId: "turn-1", kind: "tool.completed", tone: "tool" }),
      makeActivity({ id: "info-1", turnId: "turn-2", kind: "turn.completed", tone: "info" }),
    ];

    expect(hasToolActivityForTurn(activities, TurnId.makeUnsafe("turn-1"))).toBe(true);
    expect(hasToolActivityForTurn(activities, TurnId.makeUnsafe("turn-2"))).toBe(false);
  });
});

describe("isLatestTurnSettled", () => {
  const latestTurn = {
    turnId: TurnId.makeUnsafe("turn-1"),
    startedAt: "2026-02-27T21:10:00.000Z",
    completedAt: "2026-02-27T21:10:06.000Z",
  } as const;

  it("returns false while the same turn is still active in a running session", () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: "running",
        activeTurnId: TurnId.makeUnsafe("turn-1"),
      }),
    ).toBe(false);
  });

  it("returns false while any turn is running to avoid stale latest-turn banners", () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: "running",
        activeTurnId: TurnId.makeUnsafe("turn-2"),
      }),
    ).toBe(false);
  });

  it("returns true once the session is no longer running that turn", () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: "ready",
        activeTurnId: undefined,
      }),
    ).toBe(true);
  });

  it("returns false when turn timestamps are incomplete", () => {
    expect(
      isLatestTurnSettled(
        {
          turnId: TurnId.makeUnsafe("turn-1"),
          startedAt: null,
          completedAt: "2026-02-27T21:10:06.000Z",
        },
        null,
      ),
    ).toBe(false);
  });
});

describe("deriveActiveWorkStartedAt", () => {
  const latestTurn = {
    turnId: TurnId.makeUnsafe("turn-1"),
    startedAt: "2026-02-27T21:10:00.000Z",
    completedAt: "2026-02-27T21:10:06.000Z",
  } as const;

  it("prefers the in-flight turn start when the latest turn is not settled", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          orchestrationStatus: "running",
          activeTurnId: TurnId.makeUnsafe("turn-1"),
        },
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:10:00.000Z");
  });

  it("falls back to sendStartedAt once the latest turn is settled", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          orchestrationStatus: "ready",
          activeTurnId: undefined,
        },
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });

  it("uses sendStartedAt for a fresh send after the prior turn completed", () => {
    expect(
      deriveActiveWorkStartedAt(
        {
          turnId: TurnId.makeUnsafe("turn-1"),
          startedAt: "2026-02-27T21:10:00.000Z",
          completedAt: "2026-02-27T21:10:06.000Z",
        },
        null,
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });
});

describe("PROVIDER_OPTIONS", () => {
  it("exposes the supported providers in the expected order", () => {
    const opencode = PROVIDER_OPTIONS.find((option) => option.value === "opencode");
    const copilot = PROVIDER_OPTIONS.find((option) => option.value === "copilot");
    const claude = PROVIDER_OPTIONS.find((option) => option.value === "claudeCode");
    const cursor = PROVIDER_OPTIONS.find((option) => option.value === "cursor");
    const gemini = PROVIDER_OPTIONS.find((option) => option.value === "gemini");
    expect(PROVIDER_OPTIONS).toEqual([
      { value: "codex", label: "Codex", available: true },
      { value: "opencode", label: "OpenCode", available: true },
      { value: "copilot", label: "GitHub Copilot", available: true },
      { value: "claudeCode", label: "Claude Code", available: true },
      { value: "cursor", label: "Cursor", available: true },
      { value: "gemini", label: "Gemini", available: true },
    ]);
    expect(opencode).toEqual({
      value: "opencode",
      label: "OpenCode",
      available: true,
    });
    expect(copilot).toEqual({
      value: "copilot",
      label: "GitHub Copilot",
      available: true,
    });
    expect(claude).toEqual({
      value: "claudeCode",
      label: "Claude Code",
      available: true,
    });
    expect(cursor).toEqual({
      value: "cursor",
      label: "Cursor",
      available: true,
    });
    expect(gemini).toEqual({
      value: "gemini",
      label: "Gemini",
      available: true,
    });
  });
});
