import {
  ApprovalRequestId,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  type OrchestrationProposedPlanId,
  type ProviderKind,
  type UserInputQuestion,
  type TurnId,
} from "@t3tools/contracts";
import { getProviderLabel, PROVIDER_ORDER } from "@t3tools/shared/provider";

import type {
  ChatMessage,
  ProposedPlan,
  SessionPhase,
  ThreadSession,
  TurnDiffSummary,
} from "./types";

export type ProviderPickerKind = ProviderKind;

export const PROVIDER_OPTIONS: Array<{
  value: ProviderPickerKind;
  label: string;
  available: boolean;
}> = PROVIDER_ORDER.map((provider) => ({
  value: provider,
  label: getProviderLabel(provider),
  available: true,
}));

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  label: string;
  detail?: string;
  command?: string;
  changedFiles?: ReadonlyArray<{
    path: string;
    additions?: number;
    deletions?: number;
  }>;
  toolCall?: {
    name: string;
    status?: string;
    itemType?: string;
    input?: string;
    output?: string;
    targetPath?: string;
    compact?: "path";
  };
  tone: "thinking" | "tool" | "info" | "error";
}

export interface PendingApproval {
  requestId: ApprovalRequestId;
  requestKind: "command" | "file-read" | "file-change";
  createdAt: string;
  detail?: string;
}

export interface PendingUserInput {
  requestId: ApprovalRequestId;
  createdAt: string;
  questions: ReadonlyArray<UserInputQuestion>;
}

export interface ActivePlanState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
}

export type TimelineEntry =
  | {
      id: string;
      kind: "message";
      createdAt: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "proposed-plan";
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      id: string;
      kind: "work";
      createdAt: string;
      entry: WorkLogEntry;
    };

export function formatTimestamp(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(isoDate));
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  if (seconds === 0) return `${minutes}m`;
  if (seconds === 60) return `${minutes + 1}m`;
  return `${minutes}m ${seconds}s`;
}

export function formatElapsed(startIso: string, endIso: string | undefined): string | null {
  if (!endIso) return null;
  const startedAt = Date.parse(startIso);
  const endedAt = Date.parse(endIso);
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) {
    return null;
  }
  return formatDuration(endedAt - startedAt);
}

type LatestTurnTiming = Pick<OrchestrationLatestTurn, "turnId" | "startedAt" | "completedAt">;
type SessionActivityState = Pick<ThreadSession, "orchestrationStatus" | "activeTurnId">;

export function isLatestTurnSettled(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
): boolean {
  if (!latestTurn?.startedAt) return false;
  if (!latestTurn.completedAt) return false;
  if (!session) return true;
  if (session.orchestrationStatus === "running") return false;
  return true;
}

export function deriveActiveWorkStartedAt(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
  sendStartedAt: string | null,
): string | null {
  if (!isLatestTurnSettled(latestTurn, session)) {
    return latestTurn?.startedAt ?? sendStartedAt;
  }
  return sendStartedAt;
}

function requestKindFromRequestType(requestType: unknown): PendingApproval["requestKind"] | null {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return null;
  }
}

export function derivePendingApprovals(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingApproval[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingApproval>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.makeUnsafe(payload.requestId)
        : null;
    const requestKind =
      payload &&
      (payload.requestKind === "command" ||
        payload.requestKind === "file-read" ||
        payload.requestKind === "file-change")
        ? payload.requestKind
        : payload
          ? requestKindFromRequestType(payload.requestType)
          : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "approval.requested" && requestId && requestKind) {
      openByRequestId.set(requestId, {
        requestId,
        requestKind,
        createdAt: activity.createdAt,
        ...(detail ? { detail } : {}),
      });
      continue;
    }

    if (activity.kind === "approval.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.approval.respond.failed" &&
      requestId &&
      detail?.includes("Unknown pending permission request")
    ) {
      openByRequestId.delete(requestId);
      continue;
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function parseUserInputQuestions(
  payload: Record<string, unknown> | null,
): ReadonlyArray<UserInputQuestion> | null {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }
  const parsed = questions
    .map<UserInputQuestion | null>((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const question = entry as Record<string, unknown>;
      if (
        typeof question.id !== "string" ||
        typeof question.header !== "string" ||
        typeof question.question !== "string" ||
        !Array.isArray(question.options)
      ) {
        return null;
      }
      const options = question.options
        .map<UserInputQuestion["options"][number] | null>((option) => {
          if (!option || typeof option !== "object") return null;
          const optionRecord = option as Record<string, unknown>;
          if (
            typeof optionRecord.label !== "string" ||
            typeof optionRecord.description !== "string"
          ) {
            return null;
          }
          return {
            label: optionRecord.label,
            description: optionRecord.description,
          };
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);
      if (options.length === 0) {
        return null;
      }
      return {
        id: question.id,
        header: question.header,
        question: question.question,
        options,
      };
    })
    .filter((question): question is UserInputQuestion => question !== null);
  return parsed.length > 0 ? parsed : null;
}

export function derivePendingUserInputs(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingUserInput[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingUserInput>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.makeUnsafe(payload.requestId)
        : null;

    if (activity.kind === "user-input.requested" && requestId) {
      const questions = parseUserInputQuestions(payload);
      if (!questions) {
        continue;
      }
      openByRequestId.set(requestId, {
        requestId,
        createdAt: activity.createdAt,
        questions,
      });
      continue;
    }

    if (activity.kind === "user-input.resolved" && requestId) {
      openByRequestId.delete(requestId);
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function deriveActivePlanState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): ActivePlanState | null {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const candidates = ordered.filter((activity) => {
    if (activity.kind !== "turn.plan.updated") {
      return false;
    }
    if (!latestTurnId) {
      return true;
    }
    return activity.turnId === latestTurnId;
  });
  const latest = candidates.at(-1);
  if (!latest) {
    return null;
  }
  const payload =
    latest.payload && typeof latest.payload === "object"
      ? (latest.payload as Record<string, unknown>)
      : null;
  const rawPlan = payload?.plan;
  if (!Array.isArray(rawPlan)) {
    return null;
  }
  const steps = rawPlan
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      if (typeof record.step !== "string") {
        return null;
      }
      const status =
        record.status === "completed" || record.status === "inProgress" ? record.status : "pending";
      return {
        step: record.step,
        status,
      };
    })
    .filter(
      (
        step,
      ): step is {
        step: string;
        status: "pending" | "inProgress" | "completed";
      } => step !== null,
    );
  if (steps.length === 0) {
    return null;
  }
  return {
    createdAt: latest.createdAt,
    turnId: latest.turnId,
    ...(payload && "explanation" in payload
      ? { explanation: payload.explanation as string | null }
      : {}),
    steps,
  };
}

export function findLatestProposedPlan(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  latestTurnId: TurnId | string | null | undefined,
): LatestProposedPlanState | null {
  if (latestTurnId) {
    const matchingTurnPlan = [...proposedPlans]
      .filter((proposedPlan) => proposedPlan.turnId === latestTurnId)
      .toSorted(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
      )
      .at(-1);
    if (matchingTurnPlan) {
      return {
        id: matchingTurnPlan.id,
        createdAt: matchingTurnPlan.createdAt,
        updatedAt: matchingTurnPlan.updatedAt,
        turnId: matchingTurnPlan.turnId,
        planMarkdown: matchingTurnPlan.planMarkdown,
      };
    }
  }

  const latestPlan = [...proposedPlans]
    .toSorted(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
    )
    .at(-1);
  if (!latestPlan) {
    return null;
  }

  return {
    id: latestPlan.id,
    createdAt: latestPlan.createdAt,
    updatedAt: latestPlan.updatedAt,
    turnId: latestPlan.turnId,
    planMarkdown: latestPlan.planMarkdown,
  };
}

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
  provider?: ProviderKind | null,
): WorkLogEntry[] {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const visibleActivities = ordered
    .filter((activity) => (latestTurnId ? activity.turnId === latestTurnId : true))
    .filter((activity) => !shouldHideWorkLogActivity(activity, provider))
  return mergeReasoningActivities(visibleActivities)
    .map((activity) => {
      const payload =
        activity.payload && typeof activity.payload === "object"
          ? (activity.payload as Record<string, unknown>)
          : null;
      const command = extractToolCommand(payload);
      const changedFiles = extractChangedFiles(payload);
      const toolName = resolveToolName(payload);
      const entry: WorkLogEntry = {
        id: activity.id,
        createdAt: activity.createdAt,
        label: activity.summary,
        tone:
          activity.kind === "reasoning.delta"
            ? "thinking"
            : activity.tone === "approval"
              ? "info"
              : activity.tone,
      };
      if (
        payload &&
        typeof payload.detail === "string" &&
        payload.detail.length > 0 &&
        !shouldHideToolDetail(payload.detail, toolName)
      ) {
        entry.detail = payload.detail;
      }
      if (command) {
        entry.command = command;
      }
      if (shouldSurfaceChangedFiles(payload, activity.summary, changedFiles)) {
        entry.changedFiles = changedFiles;
      }
      const toolCall = extractToolCall(payload, command);
      if (toolCall) {
        entry.toolCall = toolCall;
      }
      return entry;
    })
    .filter((entry) => !isEmptyGenericToolEntry(entry));
}

function shouldHideWorkLogActivity(
  activity: OrchestrationThreadActivity,
  provider?: ProviderKind | null,
): boolean {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  if (activity.kind === "tool.started") {
    return true;
  }
  if (activity.kind === "task.started" || activity.kind === "task.completed") {
    return true;
  }
  if (activity.summary === "Checkpoint captured") {
    return true;
  }
  if (isInternalPlanToolActivity(payload)) {
    return true;
  }
  if (activity.kind === "user-input.requested" || activity.kind === "user-input.resolved") {
    return true;
  }
  if (provider !== "opencode") {
    return false;
  }

  return (
    activity.kind === "reasoning.delta" ||
    activity.kind === "task.progress" ||
    activity.kind === "tool.updated" ||
    activity.kind === "turn.plan.updated" ||
    activity.kind === "approval.resolved" ||
    activity.kind === "user-input.resolved"
  );
}

function mergeReasoningActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity[] {
  const merged: OrchestrationThreadActivity[] = [];

  for (const activity of activities) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.kind === "reasoning.delta" &&
      activity.kind === "reasoning.delta" &&
      previous.turnId === activity.turnId &&
      previous.summary === activity.summary
    ) {
      const previousPayload =
        previous.payload && typeof previous.payload === "object"
          ? ({ ...(previous.payload as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      const nextPayload =
        activity.payload && typeof activity.payload === "object"
          ? (activity.payload as Record<string, unknown>)
          : null;
      const previousDetail = typeof previousPayload.detail === "string" ? previousPayload.detail : "";
      const nextDetail = typeof nextPayload?.detail === "string" ? nextPayload.detail : "";
      previousPayload.detail = mergeReasoningDetail(previousDetail, nextDetail);
      merged[merged.length - 1] = {
        ...previous,
        payload: previousPayload,
      };
      continue;
    }

    merged.push(activity);
  }

  return merged;
}

function mergeReasoningDetail(current: string, next: string, limit = 1_600): string {
  const merged = `${current}${next}`;
  if (merged.length <= limit) {
    return merged;
  }
  return `${merged.slice(0, limit - 3)}...`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCommandValue(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

function normalizeToolName(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/[\s_-]+/g, "") ?? "";
}

function isPathLookupToolName(name: string | null | undefined): boolean {
  const normalized = normalizeToolName(name);
  return (
    normalized === "read" ||
    normalized === "cat" ||
    normalized === "glob" ||
    normalized === "grep" ||
    normalized === "list" ||
    normalized === "ls" ||
    normalized.includes("readfile") ||
    normalized.includes("glob") ||
    normalized.includes("grep") ||
    normalized.includes("listfiles")
  );
}

function isInternalPlanToolName(name: string | null | undefined): boolean {
  const normalized = normalizeToolName(name);
  return normalized === "todowrite" || normalized === "todo";
}

function isGenericToolName(name: string | null | undefined): boolean {
  const normalized = normalizeToolName(name);
  return normalized === "tool" || normalized === "geminitool";
}

function toolPayloadState(payload: Record<string, unknown> | null) {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const state = asRecord(item?.state);
  const stateInput = asRecord(state?.input);
  const dataInput = asRecord(data?.input);
  const parameters = asRecord(data?.parameters);
  const rawInput = asRecord(data?.rawInput);
  const locations = Array.isArray(data?.locations) ? data.locations : null;
  return {
    data,
    item,
    state,
    stateInput,
    dataInput,
    parameters,
    rawInput,
    locations,
  };
}

function inferToolNameFromInput(
  input: Record<string, unknown> | null,
  locations: ReadonlyArray<unknown> | null,
): string | null {
  if (!input) {
    if (Array.isArray(locations) && locations.length > 0) {
      return "read";
    }
    return null;
  }
  if (
    asTrimmedString(input.filePath) ||
    asTrimmedString(input.file_path) ||
    asTrimmedString(input.relativePath) ||
    asTrimmedString(input.relative_path) ||
    asTrimmedString(input.uri)
  ) {
    return "read";
  }
  if (asTrimmedString(input.pattern) && asTrimmedString(input.path)) {
    return "glob";
  }
  if (asTrimmedString(input.query) || asTrimmedString(input.regex)) {
    return "grep";
  }
  if (asTrimmedString(input.path) && Array.isArray(locations) && locations.length > 0) {
    return "grep";
  }
  return null;
}

function resolveToolName(payload: Record<string, unknown> | null): string | null {
  const { data, item, stateInput, dataInput, parameters, rawInput, locations } =
    toolPayloadState(payload);
  const candidates = [
    asTrimmedString(item?.tool),
    asTrimmedString(payload?.title),
    asTrimmedString(data?.toolName),
    asTrimmedString(data?.tool_name),
    asTrimmedString(data?.title),
    asTrimmedString(data?.name),
    asTrimmedString(data?.tool),
    asTrimmedString(data?.toolKind),
    asTrimmedString(data?.tool_kind),
    asTrimmedString(parameters?.tool),
    asTrimmedString(parameters?.name),
    asTrimmedString(rawInput?.tool),
    asTrimmedString(rawInput?.name),
    inferToolNameFromInput(stateInput, locations),
    inferToolNameFromInput(dataInput, locations),
    inferToolNameFromInput(parameters, locations),
    inferToolNameFromInput(rawInput, locations),
  ];
  return (
    candidates.find(
      (candidate): candidate is string =>
        candidate !== null && candidate.length > 0 && !isGenericToolName(candidate),
    ) ?? null
  );
}

function isInternalPlanToolActivity(payload: Record<string, unknown> | null): boolean {
  return isInternalPlanToolName(resolveToolName(payload));
}

function extractToolCommand(payload: Record<string, unknown> | null): string | null {
  const { data, item, state, stateInput, dataInput, rawInput } = toolPayloadState(payload);
  const itemResult = asRecord(item?.result);
  const itemInput = asRecord(item?.input);
  const candidates = [
    normalizeCommandValue(item?.command),
    normalizeCommandValue(itemInput?.command),
    normalizeCommandValue(itemInput?.cmd),
    normalizeCommandValue(itemInput?.argv),
    normalizeCommandValue(stateInput?.command),
    normalizeCommandValue(stateInput?.cmd),
    normalizeCommandValue(stateInput?.argv),
    normalizeCommandValue(dataInput?.command),
    normalizeCommandValue(dataInput?.cmd),
    normalizeCommandValue(dataInput?.argv),
    normalizeCommandValue(rawInput?.command),
    normalizeCommandValue(rawInput?.cmd),
    normalizeCommandValue(rawInput?.argv),
    normalizeCommandValue(state?.raw),
    normalizeCommandValue(itemResult?.command),
    normalizeCommandValue(data?.command),
  ];
  return candidates.find((candidate) => candidate !== null) ?? null;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function truncatePreview(value: string, maxChars = 800, maxLines = 10): string | null {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return null;
  }
  const lines = normalized.split("\n");
  const lineLimited =
    lines.length > maxLines ? `${lines.slice(0, maxLines).join("\n")}\n...` : normalized;
  if (lineLimited.length <= maxChars) {
    return lineLimited;
  }
  return `${lineLimited.slice(0, maxChars - 3).trimEnd()}...`;
}

function stringifyPreview(value: unknown): string | null {
  if (typeof value === "string") {
    return truncatePreview(value);
  }
  if (value === null || value === undefined) {
    return null;
  }
  try {
    const serialized = JSON.stringify(value, null, 2);
    return typeof serialized === "string" ? truncatePreview(serialized) : null;
  } catch {
    return null;
  }
}

function summarizeScalarValue(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value
    .map((entry) => summarizeScalarValue(entry))
    .filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

function summarizeToolInput(
  input: Record<string, unknown> | null,
  command: string | null,
): string | null {
  if (!input) {
    return null;
  }
  const entries = Object.entries(input)
    .filter(([key]) => key !== "command" && key !== "cmd" && key !== "argv")
    .map(([key, value]) => {
      const summary = summarizeScalarValue(value);
      return summary ? `${key}: ${summary}` : null;
    })
    .filter((entry): entry is string => entry !== null)
    .slice(0, 4);
  if (entries.length === 0) {
    return null;
  }
  const summary = entries.join("  ·  ");
  if (command && summary === command) {
    return null;
  }
  return summary;
}

function summarizeToolTargetPath(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const candidate = value
    .map((entry) => summarizeToolTargetPath(entry))
    .find((entry): entry is string => entry !== null);
  return candidate ?? null;
}

function extractToolTargetPath(payload: Record<string, unknown> | null): string | null {
  const { data, stateInput, dataInput, parameters, rawInput, locations } = toolPayloadState(payload);
  const candidateRecords = [stateInput, dataInput, parameters, rawInput];
  for (const record of candidateRecords) {
    if (!record) {
      continue;
    }
    const pathCandidate =
      summarizeToolTargetPath(record.filePath) ??
      summarizeToolTargetPath(record.file_path) ??
      summarizeToolTargetPath(record.path) ??
      summarizeToolTargetPath(record.relativePath) ??
      summarizeToolTargetPath(record.relative_path) ??
      summarizeToolTargetPath(record.filename) ??
      summarizeToolTargetPath(record.newPath) ??
      summarizeToolTargetPath(record.new_path) ??
      summarizeToolTargetPath(record.oldPath) ??
      summarizeToolTargetPath(record.old_path) ??
      summarizeToolTargetPath(record.uri);
    if (pathCandidate) {
      return pathCandidate;
    }
  }

  if (Array.isArray(locations)) {
    for (const location of locations) {
      const record = asRecord(location);
      if (!record) {
        continue;
      }
      const pathCandidate =
        summarizeToolTargetPath(record.path) ??
        summarizeToolTargetPath(record.filePath) ??
        summarizeToolTargetPath(record.file_path) ??
        summarizeToolTargetPath(record.uri);
      if (pathCandidate) {
        return pathCandidate;
      }
    }
  }

  return (
    summarizeToolTargetPath(data?.filePath) ??
    summarizeToolTargetPath(data?.file_path) ??
    summarizeToolTargetPath(data?.path) ??
    summarizeToolTargetPath(data?.relativePath) ??
    summarizeToolTargetPath(data?.relative_path) ??
    null
  );
}

function extractToolCall(
  payload: Record<string, unknown> | null,
  command: string | null,
): WorkLogEntry["toolCall"] | undefined {
  const itemType = asTrimmedString(payload?.itemType);
  const status = asTrimmedString(payload?.status);
  const { state, stateInput, dataInput, parameters, rawInput } = toolPayloadState(payload);
  const metadata = asRecord(state?.metadata);
  const name = resolveToolName(payload);

  if (!name && !itemType) {
    return undefined;
  }

  const toolCall: NonNullable<WorkLogEntry["toolCall"]> = {
    name: name ?? "tool",
    ...(status ? { status } : {}),
    ...(itemType ? { itemType } : {}),
  };

  const targetPath = extractToolTargetPath(payload);
  const toolInput = stateInput ?? dataInput ?? parameters ?? rawInput;
  const inputPreview =
    isPathLookupToolName(name) && targetPath ? targetPath : summarizeToolInput(toolInput, command);
  const outputPreview =
    status === "failed"
      ? stringifyPreview(state?.error) ??
        stringifyPreview(state?.output) ??
        stringifyPreview(metadata?.output)
      : null;

  if (inputPreview && inputPreview !== command) {
    toolCall.input = inputPreview;
  }
  if (outputPreview) {
    toolCall.output = outputPreview;
  }
  if (isPathLookupToolName(name) && targetPath) {
    toolCall.targetPath = targetPath;
    toolCall.compact = "path";
  }

  return toolCall;
}

function pushChangedFile(
  target: Array<{ path: string; additions?: number; deletions?: number }>,
  seen: Map<string, number>,
  value: unknown,
  statSource?: Record<string, unknown> | null,
) {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return;
  }

  const additions = asOptionalNumber(statSource?.additions);
  const deletions = asOptionalNumber(statSource?.deletions);
  const existingIndex = seen.get(normalized);
  if (existingIndex !== undefined) {
    const existing = target[existingIndex];
    if (!existing) return;
    if (existing.additions === undefined && additions !== undefined) {
      existing.additions = additions;
    }
    if (existing.deletions === undefined && deletions !== undefined) {
      existing.deletions = deletions;
    }
    return;
  }

  seen.set(normalized, target.length);
  target.push({
    path: normalized,
    ...(additions !== undefined ? { additions } : {}),
    ...(deletions !== undefined ? { deletions } : {}),
  });
}

function collectChangedFiles(
  value: unknown,
  target: Array<{ path: string; additions?: number; deletions?: number }>,
  seen: Map<string, number>,
  depth: number,
) {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path, record);
  pushChangedFile(target, seen, record.filePath, record);
  pushChangedFile(target, seen, record.file_path, record);
  pushChangedFile(target, seen, record.relativePath, record);
  pushChangedFile(target, seen, record.relative_path, record);
  pushChangedFile(target, seen, record.filename, record);
  pushChangedFile(target, seen, record.newPath, record);
  pushChangedFile(target, seen, record.new_path, record);
  pushChangedFile(target, seen, record.oldPath, record);
  pushChangedFile(target, seen, record.old_path, record);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

function collectChangedFilesFromText(
  value: string | null,
  target: Array<{ path: string; additions?: number; deletions?: number }>,
  seen: Map<string, number>,
) {
  if (!value) {
    return;
  }

  const normalized = value.replace(/\r\n/g, "\n");
  const updatedFilesMatch = normalized.match(/updated the following files:\s*([^\n]+)/i);
  if (updatedFilesMatch?.[1]) {
    const fragments = updatedFilesMatch[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    for (const fragment of fragments) {
      const cleaned = fragment.replace(/^(?:[A-Z?]{1,3})\s+/, "").trim();
      if (cleaned.includes("/")) {
        pushChangedFile(target, seen, cleaned);
      }
    }
  }

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || !line.includes("/")) {
      continue;
    }
    const cleaned = line
      .replace(/^[•*-]\s+/, "")
      .replace(/^(?:[A-Z?]{1,3})\s+/, "")
      .replace(/\s+complete$/i, "")
      .trim();
    if (
      cleaned.length === 0 ||
      cleaned.includes(" ") ||
      !/[./]/.test(cleaned) ||
      cleaned.startsWith("filePath:") ||
      cleaned.startsWith("path:")
    ) {
      continue;
    }
    pushChangedFile(target, seen, cleaned);
  }
}

function shouldSurfaceChangedFiles(
  payload: Record<string, unknown> | null,
  label: string,
  changedFiles: ReadonlyArray<{ path: string; additions?: number; deletions?: number }>,
): boolean {
  if (changedFiles.length === 0) {
    return false;
  }
  const itemType = asTrimmedString(payload?.itemType);
  if (itemType === "file_change" || itemType === "command_execution") {
    return true;
  }

  const toolName = resolveToolName(payload);
  if (toolName && isPathLookupToolName(toolName)) {
    return false;
  }

  const detail = asTrimmedString(payload?.detail)?.toLowerCase() ?? "";
  const normalizedLabel = label.toLowerCase();
  return (
    detail.includes("updated the following files") ||
    normalizedLabel.includes("patch applied") ||
    normalizedLabel.includes("file change") ||
    normalizedLabel.includes("updated")
  );
}

function shouldHideToolDetail(detail: string | undefined, toolName: string | null): boolean {
  if (!detail) {
    return false;
  }
  const trimmed = detail.trim();
  if (trimmed === "{}") {
    return true;
  }
  return toolName !== null && trimmed === `${toolName}: {}`;
}

function isEmptyGenericToolEntry(entry: WorkLogEntry): boolean {
  if (entry.tone !== "tool" || !entry.toolCall) {
    return false;
  }
  if (entry.command || (entry.changedFiles?.length ?? 0) > 0) {
    return false;
  }
  if (entry.toolCall.input || entry.toolCall.output || entry.detail) {
    return false;
  }
  return (
    entry.label === "Tool call complete" ||
    entry.label === "Tool call" ||
    entry.label === "File change complete" ||
    entry.label === "File change"
  );
}

function extractChangedFiles(
  payload: Record<string, unknown> | null,
): Array<{ path: string; additions?: number; deletions?: number }> {
  const data = asRecord(payload?.data);
  const changedFiles: Array<{ path: string; additions?: number; deletions?: number }> = [];
  const seen = new Map<string, number>();
  collectChangedFiles(data, changedFiles, seen, 0);
  collectChangedFilesFromText(asTrimmedString(payload?.detail), changedFiles, seen);
  collectChangedFilesFromText(asTrimmedString(payload?.title), changedFiles, seen);
  return changedFiles;
}

function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function hasToolActivityForTurn(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  turnId: TurnId | null | undefined,
): boolean {
  if (!turnId) return false;
  return activities.some((activity) => activity.turnId === turnId && activity.tone === "tool");
}

export function deriveTimelineEntries(
  messages: ChatMessage[],
  proposedPlans: ProposedPlan[],
  workEntries: WorkLogEntry[],
): TimelineEntry[] {
  const messageRows: TimelineEntry[] = messages.map((message) => ({
    id: message.id,
    kind: "message",
    createdAt: message.createdAt,
    message,
  }));
  const proposedPlanRows: TimelineEntry[] = proposedPlans.map((proposedPlan) => ({
    id: proposedPlan.id,
    kind: "proposed-plan",
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  }));
  const workRows: TimelineEntry[] = workEntries.map((entry) => ({
    id: entry.id,
    kind: "work",
    createdAt: entry.createdAt,
    entry,
  }));
  return [...messageRows, ...proposedPlanRows, ...workRows].toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export function inferCheckpointTurnCountByTurnId(
  summaries: TurnDiffSummary[],
): Record<TurnId, number> {
  const sorted = [...summaries].toSorted((a, b) => a.completedAt.localeCompare(b.completedAt));
  const result: Record<TurnId, number> = {};
  for (let index = 0; index < sorted.length; index += 1) {
    const summary = sorted[index];
    if (!summary) continue;
    result[summary.turnId] = index + 1;
  }
  return result;
}

export function derivePhase(session: ThreadSession | null): SessionPhase {
  if (!session || session.status === "closed") return "disconnected";
  if (session.status === "connecting") return "connecting";
  if (session.status === "running") return "running";
  return "ready";
}
