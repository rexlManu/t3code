import {
  DEFAULT_MODEL_BY_PROVIDER,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { markThreadUnread, syncServerReadModel, type AppState } from "./store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

function makeState(thread: Thread): AppState {
  return {
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        name: "Project",
        cwd: "/tmp/project",
        model: "gpt-5-codex",
        expanded: true,
        scripts: [],
      },
    ],
    threads: [thread],
    threadsHydrated: true,
  };
}

function makeReadModelThread(overrides: Partial<OrchestrationReadModel["threads"][number]>) {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5.3-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: null,
    ...overrides,
  } satisfies OrchestrationReadModel["threads"][number];
}

function makeReadModel(thread: OrchestrationReadModel["threads"][number]): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-02-27T00:00:00.000Z",
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModel: "gpt-5.3-codex",
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
        deletedAt: null,
        scripts: [],
      },
    ],
    threads: [thread],
  };
}

describe("store pure functions", () => {
  it("markThreadUnread moves lastVisitedAt before completion for a completed thread", () => {
    const latestTurnCompletedAt = "2026-02-25T12:30:00.000Z";
    const initialState = makeState(
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-02-25T12:28:00.000Z",
          startedAt: "2026-02-25T12:28:30.000Z",
          completedAt: latestTurnCompletedAt,
          assistantMessageId: null,
        },
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    const updatedThread = next.threads[0];
    expect(updatedThread).toBeDefined();
    expect(updatedThread?.lastVisitedAt).toBe("2026-02-25T12:29:59.999Z");
    expect(Date.parse(updatedThread?.lastVisitedAt ?? "")).toBeLessThan(
      Date.parse(latestTurnCompletedAt),
    );
  });

  it("markThreadUnread does not change a thread without a completed turn", () => {
    const initialState = makeState(
      makeThread({
        latestTurn: null,
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    expect(next).toEqual(initialState);
  });
});

describe("store read model sync", () => {
  it("falls back to the codex default for unsupported provider models without an active session", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        model: "not-a-real-model",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.model).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
  });

  it("preserves project and thread identity when the read model is unchanged", () => {
    const existingThread = makeThread({
      model: "gpt-5.3-codex",
      createdAt: "2026-02-27T00:00:00.000Z",
      lastVisitedAt: "2026-02-27T00:00:00.000Z",
      messages: [
        {
          id: "message-1" as Thread["messages"][number]["id"],
          role: "assistant",
          text: "hello",
          createdAt: "2026-02-27T00:00:00.000Z",
          completedAt: "2026-02-27T00:00:01.000Z",
          streaming: false,
        },
      ],
      activities: [
        {
          id: "activity-1" as Thread["activities"][number]["id"],
          kind: "tool.completed",
          turnId: TurnId.makeUnsafe("turn-1"),
          summary: "Done",
          tone: "tool",
          createdAt: "2026-02-27T00:00:00.000Z",
          sequence: 1,
          payload: { ok: true },
        },
      ],
      proposedPlans: [
        {
          id: "plan-1" as Thread["proposedPlans"][number]["id"],
          turnId: TurnId.makeUnsafe("turn-1"),
          planMarkdown: "Plan",
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
        },
      ],
      turnDiffSummaries: [
        {
          turnId: TurnId.makeUnsafe("turn-1"),
          completedAt: "2026-02-27T00:00:00.000Z",
          checkpointTurnCount: 1,
          checkpointRef:
            "checkpoint-1" as NonNullable<Thread["turnDiffSummaries"][number]["checkpointRef"]>,
          status: "ready",
          assistantMessageId: undefined,
          files: [{ path: "apps/web/src/store.ts", kind: "modified", additions: 1, deletions: 0 }],
        },
      ],
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-1"),
        state: "completed",
        requestedAt: "2026-02-27T00:00:00.000Z",
        startedAt: "2026-02-27T00:00:00.000Z",
        completedAt: "2026-02-27T00:00:01.000Z",
        assistantMessageId: null,
      },
      session: {
        provider: "codex",
        status: "ready",
        activeTurnId: undefined,
        orchestrationStatus: "ready",
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
      },
    });
    const initialState = makeState(existingThread);
    const readModel = makeReadModel(
      makeReadModelThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-02-27T00:00:00.000Z",
          startedAt: "2026-02-27T00:00:00.000Z",
          completedAt: "2026-02-27T00:00:01.000Z",
          assistantMessageId: null,
        },
        messages: [
          {
            id: "message-1" as Thread["messages"][number]["id"],
            role: "assistant",
            text: "hello",
            turnId: null,
            streaming: false,
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:01.000Z",
          },
        ],
        activities: [
          {
            id: "activity-1" as Thread["activities"][number]["id"],
            kind: "tool.completed",
            turnId: TurnId.makeUnsafe("turn-1"),
            summary: "Done",
            tone: "tool",
            createdAt: "2026-02-27T00:00:00.000Z",
            sequence: 1,
            payload: { ok: true },
          },
        ],
        proposedPlans: [
          {
            id: "plan-1" as Thread["proposedPlans"][number]["id"],
            turnId: TurnId.makeUnsafe("turn-1"),
            planMarkdown: "Plan",
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:00.000Z",
          },
        ],
        checkpoints: [
          {
            turnId: TurnId.makeUnsafe("turn-1"),
            completedAt: "2026-02-27T00:00:00.000Z",
            status: "ready",
            assistantMessageId: null,
            checkpointTurnCount: 1,
            checkpointRef:
              "checkpoint-1" as NonNullable<Thread["turnDiffSummaries"][number]["checkpointRef"]>,
            files: [
              {
                path: "apps/web/src/store.ts",
                kind: "modified",
                additions: 1,
                deletions: 0,
              },
            ],
          },
        ],
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: DEFAULT_RUNTIME_MODE,
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-02-27T00:00:00.000Z",
        },
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects).toBe(initialState.projects);
    expect(next.projects[0]).toBe(initialState.projects[0]);
    expect(next.threads).toBe(initialState.threads);
    expect(next.threads[0]).toBe(initialState.threads[0]);
    expect(next.threads[0]?.messages).toBe(initialState.threads[0]?.messages);
    expect(next.threads[0]?.activities).toBe(initialState.threads[0]?.activities);
    expect(next.threads[0]?.proposedPlans).toBe(initialState.threads[0]?.proposedPlans);
    expect(next.threads[0]?.turnDiffSummaries).toBe(initialState.threads[0]?.turnDiffSummaries);
  });

  it("replaces only the changed thread when a different thread updates", () => {
    const threadOne = makeThread({
      id: ThreadId.makeUnsafe("thread-1"),
      title: "Thread one",
      model: "gpt-5.3-codex",
      createdAt: "2026-02-27T00:00:00.000Z",
      lastVisitedAt: "2026-02-27T00:00:00.000Z",
    });
    const threadTwo = makeThread({
      id: ThreadId.makeUnsafe("thread-2"),
      title: "Thread two",
      model: "gpt-5.3-codex",
      createdAt: "2026-02-27T00:00:00.000Z",
      lastVisitedAt: "2026-02-27T00:00:00.000Z",
      messages: [
        {
          id: "message-2" as Thread["messages"][number]["id"],
          role: "assistant",
          text: "before",
          createdAt: "2026-02-27T00:00:00.000Z",
          completedAt: "2026-02-27T00:00:01.000Z",
          streaming: false,
        },
      ],
    });
    const initialState: AppState = {
      projects: makeState(threadOne).projects,
      threads: [threadOne, threadTwo],
      threadsHydrated: true,
    };
    const readModel: OrchestrationReadModel = {
      ...makeReadModel(makeReadModelThread({})),
      threads: [
        makeReadModelThread({
          id: ThreadId.makeUnsafe("thread-1"),
          title: "Thread one",
        }),
        makeReadModelThread({
          id: ThreadId.makeUnsafe("thread-2"),
          title: "Thread two updated",
          messages: [
            {
              id: "message-2" as Thread["messages"][number]["id"],
              role: "assistant",
              text: "after",
              turnId: null,
              streaming: false,
              createdAt: "2026-02-27T00:00:00.000Z",
              updatedAt: "2026-02-27T00:00:01.000Z",
            },
          ],
        }),
      ],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads).not.toBe(initialState.threads);
    expect(next.threads[0]).toBe(initialState.threads[0]);
    expect(next.threads[1]).not.toBe(initialState.threads[1]);
    expect(next.threads[1]?.title).toBe("Thread two updated");
  });
});
