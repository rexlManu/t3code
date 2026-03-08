import { ThreadId } from "@t3tools/contracts";

export const MAX_SPLIT_PANES = 3;

export interface SplitViewRouteSearch {
  split?: string;
}

export const PANE_CAPACITY_BREAKPOINTS = {
  triple: "(min-width: 1400px)",
  double: "(min-width: 900px)",
} as const;

export function getMaxPaneCount(viewportWidth: number): number {
  if (viewportWidth >= 1400) return 3;
  if (viewportWidth >= 900) return 2;
  return 1;
}

export function parseSplitViewRouteSearch(
  search: Record<string, unknown>,
): SplitViewRouteSearch {
  const raw = search.split;
  if (typeof raw !== "string") return {};
  const trimmed = raw.trim();
  return trimmed.length > 0 ? { split: trimmed } : {};
}

export function stripSplitSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "split"> {
  const { split: _split, ...rest } = params;
  return rest as Omit<T, "split">;
}

export function parseSplitPaneIds(split: string | undefined): ThreadId[] {
  if (!split) return [];

  return split
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => ThreadId.makeUnsafe(segment));
}

export function encodeSplitPaneIds(ids: ThreadId[]): string | undefined {
  if (ids.length === 0) return undefined;
  return ids.join(",");
}

export function buildPaneIds(
  primaryId: ThreadId,
  splitParam: string | undefined,
  maxPanes: number,
): ThreadId[] {
  const extras = parseSplitPaneIds(splitParam);
  const seen = new Set<string>([primaryId]);
  const unique: ThreadId[] = [];

  for (const id of extras) {
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }

  return [primaryId, ...unique].slice(0, maxPanes);
}

export function appendSplitPane(
  primaryId: ThreadId,
  splitParam: string | undefined,
  newId: ThreadId,
  maxPanes: number,
): string | undefined {
  const current = buildPaneIds(primaryId, splitParam, maxPanes);
  if (current.some((id) => id === newId)) {
    return encodeSplitPaneIds(current.slice(1));
  }

  const next = [...current, newId].slice(0, maxPanes);
  return encodeSplitPaneIds(next.slice(1));
}

export function removeSplitPane(
  primaryId: ThreadId,
  splitParam: string | undefined,
  removeId: ThreadId,
): { primaryId: ThreadId; splitParam: string | undefined } {
  const splitIds = parseSplitPaneIds(splitParam);

  if (removeId === primaryId) {
    const [newPrimary, ...rest] = splitIds;
    if (!newPrimary) {
      return { primaryId, splitParam: undefined };
    }
    return { primaryId: newPrimary, splitParam: encodeSplitPaneIds(rest) };
  }

  const next = splitIds.filter((id) => id !== removeId);
  return { primaryId, splitParam: encodeSplitPaneIds(next) };
}

export function promoteSplitPane(
  primaryId: ThreadId,
  splitParam: string | undefined,
  promoteId: ThreadId,
): { primaryId: ThreadId; splitParam: string | undefined } {
  if (promoteId === primaryId) {
    return { primaryId, splitParam };
  }

  const splitIds = parseSplitPaneIds(splitParam);
  const others = [primaryId, ...splitIds].filter((id) => id !== promoteId);
  return {
    primaryId: promoteId,
    splitParam: encodeSplitPaneIds(others),
  };
}

export function reorderSplitPane(
  primaryId: ThreadId,
  splitParam: string | undefined,
  draggedId: ThreadId,
  targetId: ThreadId,
): { primaryId: ThreadId; splitParam: string | undefined } {
  if (draggedId === targetId) {
    return { primaryId, splitParam };
  }

  const paneIds = [primaryId, ...parseSplitPaneIds(splitParam)];
  const draggedIndex = paneIds.findIndex((id) => id === draggedId);
  const targetIndex = paneIds.findIndex((id) => id === targetId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return { primaryId, splitParam };
  }

  const nextPaneIds = [...paneIds];
  const [draggedPaneId] = nextPaneIds.splice(draggedIndex, 1);
  if (!draggedPaneId) {
    return { primaryId, splitParam };
  }
  nextPaneIds.splice(targetIndex, 0, draggedPaneId);

  const [nextPrimaryId, ...nextSplitIds] = nextPaneIds;
  if (!nextPrimaryId) {
    return { primaryId, splitParam };
  }

  return {
    primaryId: nextPrimaryId,
    splitParam: encodeSplitPaneIds(nextSplitIds),
  };
}
