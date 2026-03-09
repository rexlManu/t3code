import { Fragment, type ReactNode, createElement, useEffect } from "react";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ProviderKind,
  type ProjectScript,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationSessionStatus,
} from "@t3tools/contracts";
import {
  getModelOptions,
  normalizeModelSlug,
  resolveModelSlug,
  resolveModelSlugForProvider,
} from "@t3tools/shared/model";
import { PROVIDER_ORDER } from "@t3tools/shared/provider";
import { create } from "zustand";
import { type ChatMessage, type Project, type Thread } from "./types";

// ── State ────────────────────────────────────────────────────────────

export interface AppState {
  projects: Project[];
  threads: Thread[];
  threadsHydrated: boolean;
}

const PERSISTED_STATE_KEY = "t3code:renderer-state:v8";
const LEGACY_PERSISTED_STATE_KEYS = [
  "t3code:renderer-state:v6",
  "t3code:renderer-state:v5",
  "t3code:renderer-state:v4",
  "t3code:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

const initialState: AppState = {
  projects: [],
  threads: [],
  threadsHydrated: false,
};
const persistedExpandedProjectCwds = new Set<string>();
let legacyKeysCleanedUp = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

// ── Persist helpers ──────────────────────────────────────────────────

function readPersistedState(): AppState {
  if (typeof window === "undefined") return initialState;
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as { expandedProjectCwds?: string[] };
    persistedExpandedProjectCwds.clear();
    for (const cwd of parsed.expandedProjectCwds ?? []) {
      if (typeof cwd === "string" && cwd.length > 0) {
        persistedExpandedProjectCwds.add(cwd);
      }
    }
    return { ...initialState };
  } catch {
    return initialState;
  }
}

function persistState(state: AppState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        expandedProjectCwds: state.projects
          .filter((project) => project.expanded)
          .map((project) => project.cwd),
      }),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

function debouncedPersistState(state: AppState): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistState(state);
  }, 500);
}

// ── Pure helpers ──────────────────────────────────────────────────────

function updateThread(
  threads: Thread[],
  threadId: ThreadId,
  updater: (t: Thread) => Thread,
): Thread[] {
  let changed = false;
  const next = threads.map((t) => {
    if (t.id !== threadId) return t;
    const updated = updater(t);
    if (updated !== t) changed = true;
    return updated;
  });
  return changed ? next : threads;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function deepEqual(value: unknown, other: unknown): boolean {
  if (Object.is(value, other)) {
    return true;
  }
  if (typeof value !== typeof other) {
    return false;
  }
  if (Array.isArray(value)) {
    if (!Array.isArray(other) || value.length !== other.length) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!deepEqual(value[index], other[index])) {
        return false;
      }
    }
    return true;
  }
  if (!isRecord(value) || !isRecord(other)) {
    return false;
  }
  const valueKeys = Object.keys(value);
  const otherKeys = Object.keys(other);
  if (valueKeys.length !== otherKeys.length) {
    return false;
  }
  for (const key of valueKeys) {
    if (!(key in other)) {
      return false;
    }
    if (!deepEqual(value[key], other[key])) {
      return false;
    }
  }
  return true;
}

function reconcileValue<T>(previous: T | undefined, next: T): T {
  return previous !== undefined && deepEqual(previous, next) ? previous : next;
}

function reconcileArrayByKey<TPrevious, TNext, TResult, TKey>(
  previous: readonly TPrevious[],
  next: readonly TNext[],
  getPreviousKey: (value: TPrevious) => TKey,
  getNextKey: (value: TNext) => TKey,
  reconcileItem: (previous: TPrevious | undefined, next: TNext) => TResult,
): readonly TResult[] {
  const previousByKey = new Map(previous.map((value) => [getPreviousKey(value), value] as const));
  let changed = previous.length !== next.length;
  const reconciled = next.map((value, index) => {
    const previousValue = previousByKey.get(getNextKey(value));
    const nextValue = reconcileItem(previousValue, value);
    if (!changed && previous[index] !== nextValue) {
      changed = true;
    }
    return nextValue;
  });
  return changed ? reconciled : (previous as unknown as readonly TResult[]);
}

function normalizeProjectScripts(
  scripts: readonly ProjectScript[],
  previous: readonly ProjectScript[],
): ProjectScript[] {
  return reconcileArrayByKey(
    previous,
    scripts.map((script) => ({ ...script })),
    (script) => script.id,
    (script) => script.id,
    (previousScript, nextScript) => reconcileValue(previousScript, nextScript),
  ) as ProjectScript[];
}

function mapProjectsFromReadModel(
  incoming: OrchestrationReadModel["projects"],
  previous: Project[],
): Project[] {
  const nextProjects = incoming.map((project, index) => {
    const existing =
      previous.find((entry) => entry.id === project.id) ??
      previous.find((entry) => entry.cwd === project.workspaceRoot);
    const nextProject: Project = {
      id: project.id,
      name: project.title,
      cwd: project.workspaceRoot,
      model:
        existing?.model ??
        resolveModelSlug(project.defaultModel ?? DEFAULT_MODEL_BY_PROVIDER.codex),
      expanded:
        existing?.expanded ??
        (persistedExpandedProjectCwds.size > 0
          ? persistedExpandedProjectCwds.has(project.workspaceRoot)
          : true),
      scripts: normalizeProjectScripts(project.scripts, existing?.scripts ?? []),
    };
    if (existing) {
      return reconcileValue(existing, nextProject);
    }
    const previousAtIndex = previous[index];
    return reconcileValue(previousAtIndex, nextProject);
  });
  return reconcileArrayByKey(
    previous,
    nextProjects,
    (project) => project.id,
    (project) => project.id,
    (previousProject, nextProject) => reconcileValue(previousProject, nextProject),
  ) as Project[];
}

function toLegacySessionStatus(
  status: OrchestrationSessionStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

function toLegacyProvider(providerName: string | null): ProviderKind {
  if (providerName && PROVIDER_ORDER.includes(providerName as ProviderKind)) {
    return providerName as ProviderKind;
  }
  return "codex";
}

const MODEL_SLUGS_BY_PROVIDER = PROVIDER_ORDER.reduce<Record<ProviderKind, ReadonlySet<string>>>(
  (acc, provider) => {
    acc[provider] = new Set<string>(getModelOptions(provider).map((option) => option.slug));
    return acc;
  },
  {} as Record<ProviderKind, ReadonlySet<string>>,
);

function inferProviderForThreadModel(input: {
  readonly model: string;
  readonly sessionProviderName: string | null;
}): ProviderKind {
  if (input.sessionProviderName && PROVIDER_ORDER.includes(input.sessionProviderName as ProviderKind)) {
    return input.sessionProviderName as ProviderKind;
  }

  for (const provider of PROVIDER_ORDER) {
    const normalizedModel = normalizeModelSlug(input.model, provider);
    if (normalizedModel && MODEL_SLUGS_BY_PROVIDER[provider].has(normalizedModel)) {
      return provider;
    }
  }

  return "codex";
}

function resolveWsHttpOrigin(): string {
  if (typeof window === "undefined") return "";
  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsCandidate =
    typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0
      ? bridgeWsUrl
      : typeof envWsUrl === "string" && envWsUrl.length > 0
        ? envWsUrl
        : null;
  if (!wsCandidate) return window.location.origin;
  try {
    const wsUrl = new URL(wsCandidate);
    const protocol =
      wsUrl.protocol === "wss:" ? "https:" : wsUrl.protocol === "ws:" ? "http:" : wsUrl.protocol;
    return `${protocol}//${wsUrl.host}`;
  } catch {
    return window.location.origin;
  }
}

function toAttachmentPreviewUrl(rawUrl: string): string {
  if (rawUrl.startsWith("/")) {
    return `${resolveWsHttpOrigin()}${rawUrl}`;
  }
  return rawUrl;
}

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}

function normalizeMessage(
  message: OrchestrationReadModel["threads"][number]["messages"][number],
  previous?: ChatMessage,
): ChatMessage {
  const nextAttachments = message.attachments?.map((attachment) => ({
    type: "image" as const,
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
  }));
  const attachments =
    nextAttachments && nextAttachments.length > 0
      ? reconcileArrayByKey(
          previous?.attachments ?? [],
          nextAttachments,
          (attachment) => attachment.id,
          (attachment) => attachment.id,
          (previousAttachment, nextAttachment) => reconcileValue(previousAttachment, nextAttachment),
        )
      : undefined;
  const normalizedMessage: ChatMessage = {
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
    streaming: message.streaming,
    ...(message.streaming ? {} : { completedAt: message.updatedAt }),
    ...(attachments && attachments.length > 0 ? { attachments: [...attachments] } : {}),
  };
  return reconcileValue(previous, normalizedMessage);
}

function normalizeThread(
  thread: OrchestrationReadModel["threads"][number],
  previous?: Thread,
): Thread {
  const messages = reconcileArrayByKey(
    previous?.messages ?? [],
    thread.messages,
    (message) => message.id,
    (message) => message.id,
    (previousMessage, nextMessage) => normalizeMessage(nextMessage, previousMessage),
  ) as ChatMessage[];
  const proposedPlans = reconcileArrayByKey(
    previous?.proposedPlans ?? [],
    thread.proposedPlans.map((proposedPlan) => ({
      id: proposedPlan.id,
      turnId: proposedPlan.turnId,
      planMarkdown: proposedPlan.planMarkdown,
      createdAt: proposedPlan.createdAt,
      updatedAt: proposedPlan.updatedAt,
    })),
    (proposedPlan) => proposedPlan.id,
    (proposedPlan) => proposedPlan.id,
    (previousProposedPlan, nextProposedPlan) =>
      reconcileValue(previousProposedPlan, nextProposedPlan),
  ) as Thread["proposedPlans"];
  const turnDiffSummaries = reconcileArrayByKey(
    previous?.turnDiffSummaries ?? [],
    thread.checkpoints.map((checkpoint) => ({
      turnId: checkpoint.turnId,
      completedAt: checkpoint.completedAt,
      status: checkpoint.status,
      assistantMessageId: checkpoint.assistantMessageId ?? undefined,
      checkpointTurnCount: checkpoint.checkpointTurnCount,
      checkpointRef: checkpoint.checkpointRef,
      files: reconcileArrayByKey(
        previous?.turnDiffSummaries.find((summary) => summary.turnId === checkpoint.turnId)?.files ?? [],
        checkpoint.files.map((file) => ({ ...file })),
        (file) => file.path,
        (file) => file.path,
        (previousFile, nextFile) => reconcileValue(previousFile, nextFile),
      ) as Thread["turnDiffSummaries"][number]["files"],
    })),
    (summary) => summary.turnId,
    (summary) => summary.turnId,
    (previousSummary, nextSummary) => reconcileValue(previousSummary, nextSummary),
  ) as Thread["turnDiffSummaries"];
  const activities = reconcileArrayByKey(
    previous?.activities ?? [],
    thread.activities.map((activity) => ({ ...activity })),
    (activity) => activity.id,
    (activity) => activity.id,
    (previousActivity, nextActivity) => reconcileValue(previousActivity, nextActivity),
  ) as Thread["activities"];
  const session = thread.session
    ? reconcileValue(
        previous?.session ?? undefined,
        {
          provider: toLegacyProvider(thread.session.providerName),
          status: toLegacySessionStatus(thread.session.status),
          orchestrationStatus: thread.session.status,
          activeTurnId: thread.session.activeTurnId ?? undefined,
          createdAt: thread.session.updatedAt,
          updatedAt: thread.session.updatedAt,
          ...(thread.session.lastError ? { lastError: thread.session.lastError } : {}),
        },
      )
    : null;
  const normalizedThread: Thread = {
    id: thread.id,
    codexThreadId: null,
    projectId: thread.projectId,
    title: thread.title,
    model: resolveModelSlugForProvider(
      inferProviderForThreadModel({
        model: thread.model,
        sessionProviderName: thread.session?.providerName ?? null,
      }),
      thread.model,
    ),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    session,
    messages,
    proposedPlans,
    error: thread.session?.lastError ?? null,
    createdAt: thread.createdAt,
    latestTurn: reconcileValue(previous?.latestTurn ?? undefined, thread.latestTurn),
    lastVisitedAt: previous?.lastVisitedAt ?? thread.updatedAt,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    turnDiffSummaries,
    activities,
  };
  return reconcileValue(previous, normalizedThread);
}

// ── Pure state transition functions ────────────────────────────────────

export function syncServerReadModel(state: AppState, readModel: OrchestrationReadModel): AppState {
  const projects = mapProjectsFromReadModel(
    readModel.projects.filter((project) => project.deletedAt === null),
    state.projects,
  );
  const activeThreads = readModel.threads.filter((thread) => thread.deletedAt === null);
  const threads = reconcileArrayByKey(
    state.threads,
    activeThreads,
    (thread) => thread.id,
    (thread) => thread.id,
    (previousThread, nextThread) => normalizeThread(nextThread, previousThread),
  ) as Thread[];
  if (
    projects === state.projects &&
    threads === state.threads &&
    state.threadsHydrated
  ) {
    return state;
  }
  return {
    ...state,
    projects,
    threads,
    threadsHydrated: true,
  };
}

export function markThreadVisited(
  state: AppState,
  threadId: ThreadId,
  visitedAt?: string,
): AppState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const threads = updateThread(state.threads, threadId, (thread) => {
    const previousVisitedAtMs = thread.lastVisitedAt ? Date.parse(thread.lastVisitedAt) : NaN;
    if (
      Number.isFinite(previousVisitedAtMs) &&
      Number.isFinite(visitedAtMs) &&
      previousVisitedAtMs >= visitedAtMs
    ) {
      return thread;
    }
    return { ...thread, lastVisitedAt: at };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function markThreadUnread(state: AppState, threadId: ThreadId): AppState {
  const threads = updateThread(state.threads, threadId, (thread) => {
    if (!thread.latestTurn?.completedAt) return thread;
    const latestTurnCompletedAtMs = Date.parse(thread.latestTurn.completedAt);
    if (Number.isNaN(latestTurnCompletedAtMs)) return thread;
    const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
    if (thread.lastVisitedAt === unreadVisitedAt) return thread;
    return { ...thread, lastVisitedAt: unreadVisitedAt };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function toggleProject(state: AppState, projectId: Project["id"]): AppState {
  return {
    ...state,
    projects: state.projects.map((p) => (p.id === projectId ? { ...p, expanded: !p.expanded } : p)),
  };
}

export function setProjectExpanded(
  state: AppState,
  projectId: Project["id"],
  expanded: boolean,
): AppState {
  let changed = false;
  const projects = state.projects.map((p) => {
    if (p.id !== projectId || p.expanded === expanded) return p;
    changed = true;
    return { ...p, expanded };
  });
  return changed ? { ...state, projects } : state;
}

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.error === error) return t;
    return { ...t, error };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function setThreadBranch(
  state: AppState,
  threadId: ThreadId,
  branch: string | null,
  worktreePath: string | null,
): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.branch === branch && t.worktreePath === worktreePath) return t;
    const cwdChanged = t.worktreePath !== worktreePath;
    return {
      ...t,
      branch,
      worktreePath,
      ...(cwdChanged ? { session: null } : {}),
    };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function selectThreadById(state: AppState, threadId: ThreadId | null | undefined): Thread | undefined {
  if (!threadId) return undefined;
  return state.threads.find((thread) => thread.id === threadId);
}

export function selectProjectById(
  state: AppState,
  projectId: Project["id"] | null | undefined,
): Project | undefined {
  if (!projectId) return undefined;
  return state.projects.find((project) => project.id === projectId);
}

export function selectThreadExists(state: AppState, threadId: ThreadId | null | undefined): boolean {
  return selectThreadById(state, threadId) !== undefined;
}

export function selectThreadTitle(
  state: AppState,
  threadId: ThreadId | null | undefined,
): string | undefined {
  return selectThreadById(state, threadId)?.title;
}

export function selectProjectIdForThread(
  state: AppState,
  threadId: ThreadId | null | undefined,
): Project["id"] | null {
  return selectThreadById(state, threadId)?.projectId ?? null;
}

let cachedThreadIdSource: AppState["threads"] | null = null;
let cachedThreadIds: ThreadId[] = [];

export function selectThreadIds(state: AppState): ThreadId[] {
  if (state.threads === cachedThreadIdSource) {
    return cachedThreadIds;
  }
  cachedThreadIdSource = state.threads;
  cachedThreadIds = state.threads.map((thread) => thread.id);
  return cachedThreadIds;
}

let cachedProjectIdSource: AppState["projects"] | null = null;
let cachedProjectIds: Project["id"][] = [];

export function selectProjectIds(state: AppState): Project["id"][] {
  if (state.projects === cachedProjectIdSource) {
    return cachedProjectIds;
  }
  cachedProjectIdSource = state.projects;
  cachedProjectIds = state.projects.map((project) => project.id);
  return cachedProjectIds;
}

const cachedThreadIdsForProject = new Map<
  Project["id"],
  { threads: AppState["threads"]; ids: ThreadId[] }
>();

export function selectThreadIdsForProject(state: AppState, projectId: Project["id"]): ThreadId[] {
  const cached = cachedThreadIdsForProject.get(projectId);
  if (cached && cached.threads === state.threads) {
    return cached.ids;
  }
  const ids = state.threads.filter((thread) => thread.projectId === projectId).map((thread) => thread.id);
  cachedThreadIdsForProject.set(projectId, { threads: state.threads, ids });
  return ids;
}

// ── Zustand store ────────────────────────────────────────────────────

interface AppStore extends AppState {
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId) => void;
  toggleProject: (projectId: Project["id"]) => void;
  setProjectExpanded: (projectId: Project["id"], expanded: boolean) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadBranch: (threadId: ThreadId, branch: string | null, worktreePath: string | null) => void;
}

export const useStore = create<AppStore>((set) => ({
  ...readPersistedState(),
  syncServerReadModel: (readModel) => set((state) => syncServerReadModel(state, readModel)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId) => set((state) => markThreadUnread(state, threadId)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  setError: (threadId, error) => set((state) => setError(state, threadId, error)),
  setThreadBranch: (threadId, branch, worktreePath) =>
    set((state) => setThreadBranch(state, threadId, branch, worktreePath)),
}));

useStore.subscribe((state) => debouncedPersistState(state));

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
      persistState(useStore.getState());
    }
  });
}

export function StoreProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    persistState(useStore.getState());
  }, []);
  return createElement(Fragment, null, children);
}
