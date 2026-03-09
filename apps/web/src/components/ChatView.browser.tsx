// Production CSS is part of the behavior under test because row height depends on it.
import "../index.css";

import {
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  type MessageId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type ProjectId,
  type ServerConfig,
  type ThreadId,
  type TurnId,
  type WsWelcomePayload,
  WS_CHANNELS,
  WS_METHODS,
} from "@t3tools/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import { page } from "vitest/browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "../composerDraftStore";
import { getRouter } from "../router";
import { useStore } from "../store";
import { estimateTimelineMessageHeight } from "./timelineHeight";

const THREAD_ID = "thread-browser-test" as ThreadId;
const PROJECT_ID = "project-1" as ProjectId;
const NOW_ISO = "2026-03-04T12:00:00.000Z";
const BASE_TIME_MS = Date.parse(NOW_ISO);
const ATTACHMENT_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='300'></svg>";

interface WsRequestEnvelope {
  id: string;
  body: {
    _tag: string;
    [key: string]: unknown;
  };
}

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: WsWelcomePayload;
}

let fixture: TestFixture;
const wsRequests: WsRequestEnvelope["body"][] = [];
const wsLink = ws.link(/ws(s)?:\/\/.*/);
const connectedWsClients = new Set<{ send: (data: string) => void }>();
const UNHANDLED_WS_REQUEST = Symbol("unhandled-ws-request");
type WsRequestHandlerResult = unknown | typeof UNHANDLED_WS_REQUEST;
type WsRequestHandler = (
  request: WsRequestEnvelope["body"],
) => Promise<WsRequestHandlerResult> | WsRequestHandlerResult;
let wsRequestHandler: WsRequestHandler | null = null;

interface ViewportSpec {
  name: string;
  width: number;
  height: number;
  textTolerancePx: number;
  attachmentTolerancePx: number;
}

const DEFAULT_VIEWPORT: ViewportSpec = {
  name: "desktop",
  width: 960,
  height: 1_100,
  textTolerancePx: 44,
  attachmentTolerancePx: 56,
};
const TEXT_VIEWPORT_MATRIX = [
  DEFAULT_VIEWPORT,
  { name: "tablet", width: 720, height: 1_024, textTolerancePx: 44, attachmentTolerancePx: 56 },
  { name: "mobile", width: 430, height: 932, textTolerancePx: 56, attachmentTolerancePx: 56 },
  { name: "narrow", width: 320, height: 700, textTolerancePx: 84, attachmentTolerancePx: 56 },
] as const satisfies readonly ViewportSpec[];
const ATTACHMENT_VIEWPORT_MATRIX = [
  DEFAULT_VIEWPORT,
  { name: "mobile", width: 430, height: 932, textTolerancePx: 56, attachmentTolerancePx: 56 },
  { name: "narrow", width: 320, height: 700, textTolerancePx: 84, attachmentTolerancePx: 56 },
] as const satisfies readonly ViewportSpec[];

interface UserRowMeasurement {
  measuredRowHeightPx: number;
  timelineWidthMeasuredPx: number;
  renderedInVirtualizedRegion: boolean;
}

interface MountedChatView {
  cleanup: () => Promise<void>;
  measureUserRow: (targetMessageId: MessageId) => Promise<UserRowMeasurement>;
  setViewport: (viewport: ViewportSpec) => Promise<void>;
  getPathname: () => string;
}

function isoAt(offsetSeconds: number): string {
  return new Date(BASE_TIME_MS + offsetSeconds * 1_000).toISOString();
}

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [
      {
        provider: "codex",
        status: "ready",
        available: true,
        authStatus: "authenticated",
        checkedAt: NOW_ISO,
      },
    ],
    availableEditors: [],
  };
}

function createUserMessage(options: {
  id: MessageId;
  text: string;
  offsetSeconds: number;
  attachments?: Array<{
    type: "image";
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }>;
}) {
  return {
    id: options.id,
    role: "user" as const,
    text: options.text,
    ...(options.attachments ? { attachments: options.attachments } : {}),
    turnId: null,
    streaming: false,
    createdAt: isoAt(options.offsetSeconds),
    updatedAt: isoAt(options.offsetSeconds + 1),
  };
}

function createAssistantMessage(options: { id: MessageId; text: string; offsetSeconds: number }) {
  return {
    id: options.id,
    role: "assistant" as const,
    text: options.text,
    turnId: null,
    streaming: false,
    createdAt: isoAt(options.offsetSeconds),
    updatedAt: isoAt(options.offsetSeconds + 1),
  };
}

function createSnapshotForTargetUser(options: {
  targetMessageId: MessageId;
  targetText: string;
  targetAttachmentCount?: number;
}): OrchestrationReadModel {
  const messages: Array<OrchestrationReadModel["threads"][number]["messages"][number]> = [];

  for (let index = 0; index < 22; index += 1) {
    const isTarget = index === 3;
    const userId = `msg-user-${index}` as MessageId;
    const assistantId = `msg-assistant-${index}` as MessageId;
    const attachments =
      isTarget && (options.targetAttachmentCount ?? 0) > 0
        ? Array.from({ length: options.targetAttachmentCount ?? 0 }, (_, attachmentIndex) => ({
            type: "image" as const,
            id: `attachment-${attachmentIndex + 1}`,
            name: `attachment-${attachmentIndex + 1}.png`,
            mimeType: "image/png",
            sizeBytes: 128,
          }))
        : undefined;

    messages.push(
      createUserMessage({
        id: isTarget ? options.targetMessageId : userId,
        text: isTarget ? options.targetText : `filler user message ${index}`,
        offsetSeconds: messages.length * 3,
        ...(attachments ? { attachments } : {}),
      }),
    );
    messages.push(
      createAssistantMessage({
        id: assistantId,
        text: `assistant filler ${index}`,
        offsetSeconds: messages.length * 3,
      }),
    );
  }

  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModel: "gpt-5",
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: THREAD_ID,
        projectId: PROJECT_ID,
        title: "Browser test thread",
        model: "gpt-5",
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
        messages,
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId: THREAD_ID,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
    updatedAt: NOW_ISO,
  };
}

function buildFixture(snapshot: OrchestrationReadModel): TestFixture {
  return {
    snapshot,
    serverConfig: createBaseServerConfig(),
    welcome: {
      cwd: "/repo/project",
      projectName: "Project",
      bootstrapProjectId: PROJECT_ID,
      bootstrapThreadId: THREAD_ID,
    },
  };
}

function createDraftOnlySnapshot(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-draft-target" as MessageId,
    targetText: "draft thread",
  });
  return {
    ...snapshot,
    threads: [],
  };
}

function createStreamingSnapshot(): OrchestrationReadModel {
  const turnId = "turn-streaming" as TurnId;
  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModel: "gpt-5",
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: THREAD_ID,
        projectId: PROJECT_ID,
        title: "Streaming thread",
        model: "gpt-5",
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        latestTurn: {
          turnId,
          state: "running",
          requestedAt: NOW_ISO,
          startedAt: NOW_ISO,
          completedAt: null,
          assistantMessageId: "assistant-stream" as MessageId,
        },
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
        messages: [
          createUserMessage({
            id: "msg-user-stream" as MessageId,
            text: "Do the thing",
            offsetSeconds: 0,
          }),
          {
            id: "assistant-stream" as MessageId,
            role: "assistant" as const,
            text: "",
            turnId,
            streaming: true,
            createdAt: NOW_ISO,
            updatedAt: NOW_ISO,
          },
        ],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId: THREAD_ID,
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: turnId,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
    updatedAt: NOW_ISO,
  };
}

function createTwoThreadStreamingSnapshot(): OrchestrationReadModel {
  const secondaryThreadId = "thread-secondary" as ThreadId;
  const turnId = "turn-streaming" as TurnId;
  return {
    ...createStreamingSnapshot(),
    threads: [
      createStreamingSnapshot().threads[0]!,
      {
        id: secondaryThreadId,
        projectId: PROJECT_ID,
        title: "Secondary thread",
        model: "gpt-5",
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        latestTurn: null,
        createdAt: isoAt(10),
        updatedAt: isoAt(10),
        deletedAt: null,
        messages: [
          createUserMessage({
            id: "msg-user-secondary" as MessageId,
            text: "Second thread message",
            offsetSeconds: 10,
          }),
          {
            id: "assistant-secondary" as MessageId,
            role: "assistant" as const,
            text: "Secondary response",
            turnId: turnId,
            streaming: false,
            createdAt: isoAt(11),
            updatedAt: isoAt(12),
          },
        ],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId: secondaryThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: isoAt(12),
        },
      },
    ],
  };
}

function resolveWsRpc(request: WsRequestEnvelope["body"]): unknown {
  if (request._tag === ORCHESTRATION_WS_METHODS.getSnapshot) {
    return fixture.snapshot;
  }
  if (request._tag === WS_METHODS.serverGetConfig) {
    return fixture.serverConfig;
  }
  if (request._tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      branches: [
        {
          name: "main",
          current: true,
          isDefault: true,
          worktreePath: null,
        },
      ],
    };
  }
  if (request._tag === WS_METHODS.gitStatus) {
    return {
      branch: "main",
      hasWorkingTreeChanges: false,
      workingTree: {
        files: [],
        insertions: 0,
        deletions: 0,
      },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };
  }
  if (request._tag === WS_METHODS.projectsSearchEntries) {
    return {
      entries: [],
      truncated: false,
    };
  }
  return {};
}

const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    connectedWsClients.add(client);
    client.send(
      JSON.stringify({
        type: "push",
        channel: WS_CHANNELS.serverWelcome,
        data: fixture.welcome,
      }),
    );
    client.addEventListener("message", (event) => {
      const rawData = event.data;
      if (typeof rawData !== "string") return;
      let request: WsRequestEnvelope;
      try {
        request = JSON.parse(rawData) as WsRequestEnvelope;
      } catch {
        return;
      }
      const method = request.body?._tag;
      if (typeof method !== "string") return;
      wsRequests.push(request.body);
      void (async () => {
        const customResult = wsRequestHandler
          ? await wsRequestHandler(request.body)
          : UNHANDLED_WS_REQUEST;
        client.send(
          JSON.stringify({
            id: request.id,
            result:
              customResult === UNHANDLED_WS_REQUEST
                ? resolveWsRpc(request.body)
                : customResult,
          }),
        );
      })();
    });
    client.addEventListener("close", () => {
      connectedWsClients.delete(client);
    });
  }),
  http.get("*/attachments/:attachmentId", () =>
    HttpResponse.text(ATTACHMENT_SVG, {
      headers: {
        "Content-Type": "image/svg+xml",
      },
    }),
  ),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

function nextSequence(): number {
  return fixture.snapshot.snapshotSequence + 1;
}

function pushDomainEvent(event: OrchestrationEvent): void {
  for (const client of connectedWsClients) {
    client.send(
      JSON.stringify({
        type: "push",
        channel: ORCHESTRATION_WS_CHANNELS.domainEvent,
        data: event,
      }),
    );
  }
}

function updateFixtureSnapshot(
  updater: (snapshot: OrchestrationReadModel, sequence: number) => OrchestrationReadModel,
): number {
  const sequence = nextSequence();
  fixture = {
    ...fixture,
    snapshot: updater(fixture.snapshot, sequence),
  };
  return sequence;
}

function makeThreadMessageSentEvent(input: {
  sequence: number;
  threadId: ThreadId;
  turnId: TurnId;
  messageId: MessageId;
  text: string;
  streaming: boolean;
  occurredAt: string;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: `event-${input.sequence}` as OrchestrationEvent["eventId"],
    type: "thread.message-sent",
    aggregateKind: "thread",
    aggregateId: input.threadId,
    occurredAt: input.occurredAt,
    commandId: `cmd-${input.sequence}` as OrchestrationEvent["commandId"],
    causationEventId: null,
    correlationId: `cmd-${input.sequence}` as OrchestrationEvent["correlationId"],
    metadata: {},
    payload: {
      threadId: input.threadId,
      messageId: input.messageId,
      role: "assistant",
      text: input.text,
      turnId: input.turnId,
      streaming: input.streaming,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    },
  };
}

function makeThreadCreatedEvent(input: {
  sequence: number;
  threadId: ThreadId;
  projectId: ProjectId;
  title: string;
  model: string;
  runtimeMode: "full-access" | "approval-required";
  interactionMode: "default" | "plan";
  branch: string | null;
  worktreePath: string | null;
  occurredAt: string;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: `event-${input.sequence}` as OrchestrationEvent["eventId"],
    type: "thread.created",
    aggregateKind: "thread",
    aggregateId: input.threadId,
    occurredAt: input.occurredAt,
    commandId: `cmd-${input.sequence}` as OrchestrationEvent["commandId"],
    causationEventId: null,
    correlationId: `cmd-${input.sequence}` as OrchestrationEvent["correlationId"],
    metadata: {},
    payload: {
      threadId: input.threadId,
      projectId: input.projectId,
      title: input.title,
      model: input.model,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      branch: input.branch,
      worktreePath: input.worktreePath,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    },
  };
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function waitForLayout(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await nextFrame();
}

async function waitForDeferredTimeline(): Promise<void> {
  await waitForLayout();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await waitForLayout();
}

async function setViewport(viewport: ViewportSpec): Promise<void> {
  await page.viewport(viewport.width, viewport.height);
  await waitForLayout();
}

async function waitForProductionStyles(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(getComputedStyle(document.documentElement).getPropertyValue("--background").trim()).not.toBe(
        "",
      );
      expect(getComputedStyle(document.body).marginTop).toBe("0px");
    },
    {
      timeout: 4_000,
      interval: 16,
    },
  );
}

async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string,
): Promise<T> {
  let element: T | null = null;
  await vi.waitFor(
    () => {
      element = query();
      expect(element, errorMessage).toBeTruthy();
    },
    {
      timeout: 8_000,
      interval: 16,
    },
  );
  if (!element) {
    throw new Error(errorMessage);
  }
  return element;
}

async function waitForComposerEditor(): Promise<HTMLElement> {
  return waitForElement(
    () => document.querySelector<HTMLElement>('[contenteditable="true"]'),
    "Unable to find composer editor.",
  );
}

async function typeInComposer(editor: HTMLElement, text: string, delayMs = 0): Promise<void> {
  editor.focus();
  for (const character of text) {
    document.execCommand("insertText", false, character);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  await waitForLayout();
}

async function waitForInteractionModeButton(expectedLabel: "Chat" | "Plan"): Promise<HTMLButtonElement> {
  return waitForElement(
    () =>
      Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === expectedLabel,
      ) as HTMLButtonElement | null,
    `Unable to find ${expectedLabel} interaction mode button.`,
  );
}

async function waitForImagesToLoad(scope: ParentNode): Promise<void> {
  const images = Array.from(scope.querySelectorAll("img"));
  if (images.length === 0) {
    return;
  }
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
  await waitForLayout();
}

async function measureUserRow(options: {
  host: HTMLElement;
  targetMessageId: MessageId;
}): Promise<UserRowMeasurement> {
  const { host, targetMessageId } = options;
  const rowSelector = `[data-message-id="${targetMessageId}"][data-message-role="user"]`;

  const scrollContainer = await waitForElement(
    () => host.querySelector<HTMLDivElement>("div.overflow-y-auto.overscroll-y-contain"),
    "Unable to find ChatView message scroll container.",
  );

  let row: HTMLElement | null = null;
  await vi.waitFor(
    async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await waitForLayout();
      row = host.querySelector<HTMLElement>(rowSelector);
      expect(row, "Unable to locate targeted user message row.").toBeTruthy();
    },
    {
      timeout: 8_000,
      interval: 16,
    },
  );

  await waitForImagesToLoad(row!);
  scrollContainer.scrollTop = 0;
  scrollContainer.dispatchEvent(new Event("scroll"));
  await nextFrame();

  const timelineRoot =
    row!.closest<HTMLElement>('[data-timeline-root="true"]') ??
    host.querySelector<HTMLElement>('[data-timeline-root="true"]');
  if (!(timelineRoot instanceof HTMLElement)) {
    throw new Error("Unable to locate timeline root container.");
  }

  let timelineWidthMeasuredPx = 0;
  let measuredRowHeightPx = 0;
  let renderedInVirtualizedRegion = false;
  await vi.waitFor(
    async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await nextFrame();
      const measuredRow = host.querySelector<HTMLElement>(rowSelector);
      expect(measuredRow, "Unable to measure targeted user row height.").toBeTruthy();
      timelineWidthMeasuredPx = timelineRoot.getBoundingClientRect().width;
      measuredRowHeightPx = measuredRow!.getBoundingClientRect().height;
      renderedInVirtualizedRegion = measuredRow!.closest("[data-index]") instanceof HTMLElement;
      expect(timelineWidthMeasuredPx, "Unable to measure timeline width.").toBeGreaterThan(0);
      expect(measuredRowHeightPx, "Unable to measure targeted user row height.").toBeGreaterThan(0);
    },
    {
      timeout: 4_000,
      interval: 16,
    },
  );

  return { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion };
}

async function mountChatView(options: {
  viewport: ViewportSpec;
  snapshot: OrchestrationReadModel;
  configureFixture?: (fixture: TestFixture) => void;
  handleWsRequest?: WsRequestHandler;
}): Promise<MountedChatView> {
  fixture = buildFixture(options.snapshot);
  options.configureFixture?.(fixture);
  wsRequestHandler = options.handleWsRequest ?? null;
  await setViewport(options.viewport);
  await waitForProductionStyles();

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const router = getRouter(
    createMemoryHistory({
      initialEntries: [`/${THREAD_ID}`],
    }),
  );

  const screen = await render(<RouterProvider router={router} />, {
    container: host,
  });

  await waitForDeferredTimeline();

  return {
    cleanup: async () => {
      wsRequestHandler = null;
      await screen.unmount();
      host.remove();
    },
    measureUserRow: async (targetMessageId: MessageId) => measureUserRow({ host, targetMessageId }),
    setViewport: async (viewport: ViewportSpec) => {
      await setViewport(viewport);
      await waitForProductionStyles();
      await waitForDeferredTimeline();
    },
    getPathname: () => router.state.location.pathname,
  };
}

async function measureUserRowAtViewport(options: {
  snapshot: OrchestrationReadModel;
  targetMessageId: MessageId;
  viewport: ViewportSpec;
}): Promise<UserRowMeasurement> {
  const mounted = await mountChatView({
    viewport: options.viewport,
    snapshot: options.snapshot,
  });

  try {
    return await mounted.measureUserRow(options.targetMessageId);
  } finally {
    await mounted.cleanup();
  }
}

describe("ChatView timeline estimator parity (full app)", () => {
  beforeAll(async () => {
    fixture = buildFixture(
      createSnapshotForTargetUser({
        targetMessageId: "msg-user-bootstrap" as MessageId,
        targetText: "bootstrap",
      }),
    );
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: {
        url: "/mockServiceWorker.js",
      },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  beforeEach(async () => {
    await setViewport(DEFAULT_VIEWPORT);
    localStorage.clear();
    document.body.innerHTML = "";
    wsRequests.length = 0;
    connectedWsClients.clear();
    wsRequestHandler = null;
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
    useStore.setState({
      projects: [],
      threads: [],
      threadsHydrated: false,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it.each(TEXT_VIEWPORT_MATRIX)(
    "keeps long user message estimate close at the $name viewport",
    async (viewport) => {
      const userText = "x".repeat(3_200);
      const targetMessageId = `msg-user-target-long-${viewport.name}` as MessageId;
      const mounted = await mountChatView({
        viewport,
        snapshot: createSnapshotForTargetUser({
          targetMessageId,
          targetText: userText,
        }),
      });

      try {
        const { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion } =
          await mounted.measureUserRow(targetMessageId);

        expect(renderedInVirtualizedRegion).toBe(true);

        const estimatedHeightPx = estimateTimelineMessageHeight(
          { role: "user", text: userText, attachments: [] },
          { timelineWidthPx: timelineWidthMeasuredPx },
        );

        expect(Math.abs(measuredRowHeightPx - estimatedHeightPx)).toBeLessThanOrEqual(
          viewport.textTolerancePx,
        );
      } finally {
        await mounted.cleanup();
      }
    },
  );

  it("tracks wrapping parity while resizing an existing ChatView across the viewport matrix", async () => {
    const userText = "x".repeat(3_200);
    const targetMessageId = "msg-user-target-resize" as MessageId;
    const mounted = await mountChatView({
      viewport: TEXT_VIEWPORT_MATRIX[0],
      snapshot: createSnapshotForTargetUser({
        targetMessageId,
        targetText: userText,
      }),
    });

    try {
      const measurements: Array<UserRowMeasurement & { viewport: ViewportSpec; estimatedHeightPx: number }> = [];

      for (const viewport of TEXT_VIEWPORT_MATRIX) {
        await mounted.setViewport(viewport);
        const measurement = await mounted.measureUserRow(targetMessageId);
        const estimatedHeightPx = estimateTimelineMessageHeight(
          { role: "user", text: userText, attachments: [] },
          { timelineWidthPx: measurement.timelineWidthMeasuredPx },
        );

        expect(measurement.renderedInVirtualizedRegion).toBe(true);
        expect(Math.abs(measurement.measuredRowHeightPx - estimatedHeightPx)).toBeLessThanOrEqual(
          viewport.textTolerancePx,
        );
        measurements.push({ ...measurement, viewport, estimatedHeightPx });
      }

      expect(new Set(measurements.map((measurement) => Math.round(measurement.timelineWidthMeasuredPx))).size).toBeGreaterThanOrEqual(3);

      const byMeasuredWidth = measurements.toSorted(
        (left, right) => left.timelineWidthMeasuredPx - right.timelineWidthMeasuredPx,
      );
      const narrowest = byMeasuredWidth[0]!;
      const widest = byMeasuredWidth.at(-1)!;
      expect(narrowest.timelineWidthMeasuredPx).toBeLessThan(widest.timelineWidthMeasuredPx);
      expect(narrowest.measuredRowHeightPx).toBeGreaterThan(widest.measuredRowHeightPx);
      expect(narrowest.estimatedHeightPx).toBeGreaterThan(widest.estimatedHeightPx);
    } finally {
      await mounted.cleanup();
    }
  });

  it("tracks additional rendered wrapping when ChatView width narrows between desktop and mobile viewports", async () => {
    const userText = "x".repeat(2_400);
    const targetMessageId = "msg-user-target-wrap" as MessageId;
    const snapshot = createSnapshotForTargetUser({
      targetMessageId,
      targetText: userText,
    });
    const desktopMeasurement = await measureUserRowAtViewport({
      viewport: TEXT_VIEWPORT_MATRIX[0],
      snapshot,
      targetMessageId,
    });
    const mobileMeasurement = await measureUserRowAtViewport({
      viewport: TEXT_VIEWPORT_MATRIX[2],
      snapshot,
      targetMessageId,
    });

    const estimatedDesktopPx = estimateTimelineMessageHeight(
      { role: "user", text: userText, attachments: [] },
      { timelineWidthPx: desktopMeasurement.timelineWidthMeasuredPx },
    );
    const estimatedMobilePx = estimateTimelineMessageHeight(
      { role: "user", text: userText, attachments: [] },
      { timelineWidthPx: mobileMeasurement.timelineWidthMeasuredPx },
    );

    const measuredDeltaPx = mobileMeasurement.measuredRowHeightPx - desktopMeasurement.measuredRowHeightPx;
    const estimatedDeltaPx = estimatedMobilePx - estimatedDesktopPx;
    expect(measuredDeltaPx).toBeGreaterThan(0);
    expect(estimatedDeltaPx).toBeGreaterThan(0);
    const ratio = estimatedDeltaPx / measuredDeltaPx;
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(1.35);
  });

  it.each(ATTACHMENT_VIEWPORT_MATRIX)(
    "keeps user attachment estimate close at the $name viewport",
    async (viewport) => {
      const targetMessageId = `msg-user-target-attachments-${viewport.name}` as MessageId;
      const userText = "message with image attachments";
      const mounted = await mountChatView({
        viewport,
        snapshot: createSnapshotForTargetUser({
          targetMessageId,
          targetText: userText,
          targetAttachmentCount: 3,
        }),
      });

      try {
        const { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion } =
          await mounted.measureUserRow(targetMessageId);

        expect(renderedInVirtualizedRegion).toBe(true);

        const estimatedHeightPx = estimateTimelineMessageHeight(
          {
            role: "user",
            text: userText,
            attachments: [{ id: "attachment-1" }, { id: "attachment-2" }, { id: "attachment-3" }],
          },
          { timelineWidthPx: timelineWidthMeasuredPx },
        );

        expect(Math.abs(measuredRowHeightPx - estimatedHeightPx)).toBeLessThanOrEqual(
          viewport.attachmentTolerancePx,
        );
      } finally {
        await mounted.cleanup();
      }
    },
  );

  it("opens the project cwd for draft threads without a worktree path", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode"],
        };
      },
    });

    try {
      const openButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Open",
          ) as HTMLButtonElement | null,
        "Unable to find Open button.",
      );
      openButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find((request) => request._tag === WS_METHODS.shellOpenInEditor);
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscode",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not show the Codex provider banner when a draft thread selects OpenCode", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });
    useComposerDraftStore.getState().setProvider(THREAD_ID, "opencode");

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          providers: [
            {
              provider: "codex",
              status: "error",
              available: false,
              authStatus: "unknown",
              checkedAt: NOW_ISO,
              message: "Codex CLI (`codex`) is not installed or not on PATH.",
            },
            {
              provider: "opencode",
              status: "ready",
              available: true,
              authStatus: "authenticated",
              checkedAt: NOW_ISO,
            },
          ],
        };
      },
    });

    try {
      await waitForComposerEditor();
      await waitForLayout();

      expect(document.body.textContent).not.toContain("Codex provider status");
      expect(document.body.textContent).not.toContain(
        "Codex CLI (`codex`) is not installed or not on PATH.",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the draft thread route stable until the server thread hydrates after the first send", async () => {
    const promptText = "Finish draft promotion";
    const turnId = "turn-draft-promotion" as TurnId;
    let dispatchSequence = 10;
    let createdThreadTitle = "Draft promotion";
    let createdModel = "gpt-5";
    let createdRuntimeMode: "full-access" | "approval-required" = "full-access";
    let createdInteractionMode: "default" | "plan" = "default";
    let hydrationTimer: number | null = null;

    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      handleWsRequest: async (request) => {
        if (request._tag !== ORCHESTRATION_WS_METHODS.dispatchCommand) {
          return UNHANDLED_WS_REQUEST;
        }

        const command = request.command as
          | {
              type?: string;
              title?: string;
              model?: string;
              runtimeMode?: "full-access" | "approval-required";
              interactionMode?: "default" | "plan";
              branch?: string | null;
              worktreePath?: string | null;
              createdAt?: string;
              message?: {
                messageId?: MessageId;
                text?: string;
              };
            }
          | undefined;

        if (command?.type === "thread.create") {
          createdThreadTitle = command.title ?? createdThreadTitle;
          createdModel = command.model ?? createdModel;
          createdRuntimeMode = command.runtimeMode ?? createdRuntimeMode;
          createdInteractionMode = command.interactionMode ?? createdInteractionMode;
          return { sequence: dispatchSequence += 1 };
        }

        if (command?.type === "thread.turn.start") {
          const occurredAt = command.createdAt ?? isoAt(40);
          const messageId = command.message?.messageId ?? ("msg-draft-user" as MessageId);
          const messageText = command.message?.text ?? promptText;
          hydrationTimer = window.setTimeout(() => {
            const sequence = updateFixtureSnapshot((snapshot, nextSequenceValue) => ({
              ...snapshot,
              snapshotSequence: nextSequenceValue,
              updatedAt: occurredAt,
              threads: [
                {
                  id: THREAD_ID,
                  projectId: PROJECT_ID,
                  title: createdThreadTitle,
                  model: createdModel,
                  interactionMode: createdInteractionMode,
                  runtimeMode: createdRuntimeMode,
                  branch: null,
                  worktreePath: null,
                  latestTurn: {
                    turnId,
                    state: "running",
                    requestedAt: occurredAt,
                    startedAt: occurredAt,
                    completedAt: null,
                    assistantMessageId: null,
                  },
                  createdAt: NOW_ISO,
                  updatedAt: occurredAt,
                  deletedAt: null,
                  messages: [
                    {
                      id: messageId,
                      role: "user",
                      text: messageText,
                      turnId,
                      streaming: false,
                      createdAt: occurredAt,
                      updatedAt: occurredAt,
                    },
                  ],
                  activities: [],
                  proposedPlans: [],
                  checkpoints: [],
                  session: {
                    threadId: THREAD_ID,
                    status: "starting",
                    providerName: "codex",
                    runtimeMode: createdRuntimeMode,
                    activeTurnId: turnId,
                    lastError: null,
                    updatedAt: occurredAt,
                  },
                },
              ],
            }));
            pushDomainEvent(
              makeThreadCreatedEvent({
                sequence,
                threadId: THREAD_ID,
                projectId: PROJECT_ID,
                title: createdThreadTitle,
                model: createdModel,
                runtimeMode: createdRuntimeMode,
                interactionMode: createdInteractionMode,
                branch: null,
                worktreePath: null,
                occurredAt,
              }),
            );
          }, 180);

          return { sequence: dispatchSequence += 1 };
        }

        return { sequence: dispatchSequence += 1 };
      },
    });

    try {
      const composerEditor = await waitForComposerEditor();
      await typeInComposer(composerEditor, promptText);

      const sendButton = await waitForElement(
        () => document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]'),
        "Unable to find send button.",
      );
      sendButton.click();

      await new Promise((resolve) => setTimeout(resolve, 75));
      await waitForLayout();

      expect(mounted.getPathname()).toBe(`/${THREAD_ID}`);
      expect(useComposerDraftStore.getState().draftThreadsByThreadId[THREAD_ID]).toBeTruthy();
      expect(document.body.textContent).not.toContain(
        "Select a thread or create a new one to get started.",
      );

      await vi.waitFor(
        () => {
          expect(useComposerDraftStore.getState().draftThreadsByThreadId[THREAD_ID]).toBeUndefined();
          expect(mounted.getPathname()).toBe(`/${THREAD_ID}`);
          expect(document.body.textContent).toContain(promptText);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      if (hydrationTimer !== null) {
        window.clearTimeout(hydrationTimer);
      }
      await mounted.cleanup();
    }
  });

  it("toggles plan mode with Shift+Tab only while the composer is focused", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-target-hotkey" as MessageId,
        targetText: "hotkey target",
      }),
    });

    try {
      const initialModeButton = await waitForInteractionModeButton("Chat");
      expect(initialModeButton.title).toContain("enter plan mode");

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await waitForLayout();

      expect((await waitForInteractionModeButton("Chat")).title).toContain("enter plan mode");

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        async () => {
          expect((await waitForInteractionModeButton("Plan")).title).toContain(
            "return to normal chat mode",
          );
        },
        { timeout: 8_000, interval: 16 },
      );

      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        async () => {
          expect((await waitForInteractionModeButton("Chat")).title).toContain("enter plan mode");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the composer focused and preserves typed text while streaming snapshot updates arrive", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createStreamingSnapshot(),
    });

    let intervalId: ReturnType<typeof setInterval> | null = null;

    try {
      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();

      let chunkIndex = 0;
      intervalId = setInterval(() => {
        chunkIndex += 1;
        const occurredAt = isoAt(30 + chunkIndex);
        const sequence = updateFixtureSnapshot((snapshot, nextSequenceValue) => ({
          ...snapshot,
          snapshotSequence: nextSequenceValue,
          updatedAt: occurredAt,
          threads: snapshot.threads.map((thread) => {
            if (thread.id !== THREAD_ID) {
              return thread;
            }
            return {
              ...thread,
              updatedAt: occurredAt,
              messages: thread.messages.map((message) =>
                message.id === ("assistant-stream" as MessageId)
                  ? {
                      ...message,
                      text: `chunk ${chunkIndex}`,
                      streaming: true,
                      updatedAt: occurredAt,
                    }
                  : message,
              ),
              session: thread.session
                ? {
                    ...thread.session,
                    status: "running",
                    activeTurnId: "turn-streaming" as TurnId,
                    updatedAt: occurredAt,
                  }
                : thread.session,
            };
          }),
        }));
        pushDomainEvent(
          makeThreadMessageSentEvent({
            sequence,
            threadId: THREAD_ID,
            turnId: "turn-streaming" as TurnId,
            messageId: "assistant-stream" as MessageId,
            text: `chunk ${chunkIndex}`,
            streaming: true,
            occurredAt,
          }),
        );
      }, 25);

      await typeInComposer(composerEditor, "typing under load", 18);
      await new Promise((resolve) => setTimeout(resolve, 250));
      await waitForLayout();

      expect(document.activeElement).toBe(composerEditor);
      expect(composerEditor.textContent).toBe("typing under load");
      const selection = window.getSelection();
      expect(selection?.focusNode ? composerEditor.contains(selection.focusNode) : false).toBe(true);
    } finally {
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
      await mounted.cleanup();
    }
  });

  it("coalesces a burst of low-priority domain events into a bounded snapshot refresh", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createStreamingSnapshot(),
    });

    try {
      wsRequests.length = 0;

      for (let index = 1; index <= 6; index += 1) {
        const occurredAt = isoAt(80 + index);
        const sequence = updateFixtureSnapshot((snapshot, nextSequenceValue) => ({
          ...snapshot,
          snapshotSequence: nextSequenceValue,
          updatedAt: occurredAt,
          threads: snapshot.threads.map((thread) => {
            if (thread.id !== THREAD_ID) {
              return thread;
            }
            return {
              ...thread,
              updatedAt: occurredAt,
              messages: thread.messages.map((message) =>
                message.id === ("assistant-stream" as MessageId)
                  ? {
                      ...message,
                      text: `burst ${index}`,
                      streaming: true,
                      updatedAt: occurredAt,
                    }
                  : message,
              ),
              session: thread.session
                ? {
                    ...thread.session,
                    status: "running",
                    activeTurnId: "turn-streaming" as TurnId,
                    updatedAt: occurredAt,
                  }
                : thread.session,
            };
          }),
        }));

        pushDomainEvent(
          makeThreadMessageSentEvent({
            sequence,
            threadId: THREAD_ID,
            turnId: "turn-streaming" as TurnId,
            messageId: "assistant-stream" as MessageId,
            text: `burst ${index}`,
            streaming: true,
            occurredAt,
          }),
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 450));
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("burst 6");
        },
        { timeout: 8_000, interval: 16 },
      );

      const snapshotRequests = wsRequests.filter(
        (request) => request._tag === ORCHESTRATION_WS_METHODS.getSnapshot,
      );
      expect(snapshotRequests).toHaveLength(1);
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps thread switching responsive while another thread continues streaming", async () => {
    const snapshot = createTwoThreadStreamingSnapshot();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot,
    });

    let intervalId: ReturnType<typeof setInterval> | null = null;

    try {
      intervalId = setInterval(() => {
        const occurredAt = isoAt(60 + Math.floor(Math.random() * 20));
        const sequence = updateFixtureSnapshot((currentSnapshot, nextSequenceValue) => ({
          ...currentSnapshot,
          snapshotSequence: nextSequenceValue,
          updatedAt: occurredAt,
          threads: currentSnapshot.threads.map((thread) => {
            if (thread.id !== THREAD_ID) {
              return thread;
            }
            return {
              ...thread,
              updatedAt: occurredAt,
              messages: thread.messages.map((message) =>
                message.id === ("assistant-stream" as MessageId)
                  ? {
                      ...message,
                      text: `live ${nextSequenceValue}`,
                      streaming: true,
                      updatedAt: occurredAt,
                    }
                  : message,
              ),
              session: thread.session
                ? {
                    ...thread.session,
                    status: "running",
                    activeTurnId: "turn-streaming" as TurnId,
                    updatedAt: occurredAt,
                  }
                : thread.session,
            };
          }),
        }));
        pushDomainEvent(
          makeThreadMessageSentEvent({
            sequence,
            threadId: THREAD_ID,
            turnId: "turn-streaming" as TurnId,
            messageId: "assistant-stream" as MessageId,
            text: `live ${sequence}`,
            streaming: true,
            occurredAt,
          }),
        );
      }, 30);

      const secondaryThreadButton = await waitForElement(
        () =>
          (Array.from(document.querySelectorAll<HTMLElement>('[role="button"]')).find((element) =>
            element.textContent?.includes("Secondary thread"),
          ) ?? null),
        "Unable to find Secondary thread button.",
      );
      secondaryThreadButton.click();

      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("Secondary response");
        },
        { timeout: 8_000, interval: 16 },
      );

      const composerEditor = await waitForComposerEditor();
      await typeInComposer(composerEditor, "switched thread", 18);
      await waitForLayout();

      expect(document.activeElement).toBe(composerEditor);
      expect(composerEditor.textContent).toBe("switched thread");
    } finally {
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
      await mounted.cleanup();
    }
  });
});
