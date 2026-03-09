import type { WorkLogEntry } from "../session-logic";

export type WorkArtifactVariant =
  | "command"
  | "fileChanges"
  | "mcp"
  | "search"
  | "tool"
  | "agent"
  | "work";

export type RenderableWorkArtifact =
  | { kind: "entry"; entry: WorkLogEntry }
  | { kind: "command-group"; entries: WorkLogEntry[] }
  | { kind: "path-tool-group"; entries: WorkLogEntry[] };

export function resolveWorkArtifactVariant(entry: WorkLogEntry): WorkArtifactVariant {
  const itemType = entry.toolCall?.itemType;
  if (entry.command || itemType === "command_execution") return "command";
  if (itemType === "file_change" || (entry.changedFiles?.length ?? 0) > 0) return "fileChanges";
  if (itemType === "mcp_tool_call") return "mcp";
  if (itemType === "web_search") return "search";
  if (itemType === "collab_agent_tool_call") return "agent";
  if (itemType === "dynamic_tool_call") return "tool";
  return "work";
}

function isCompactPathToolEntry(entry: WorkLogEntry | null | undefined): boolean {
  return entry?.toolCall?.compact === "path" && typeof entry.toolCall.targetPath === "string";
}

function compactPathToolGroupKey(entry: WorkLogEntry | null | undefined): string | null {
  const name = entry?.toolCall?.name.trim().toLowerCase();
  return name && isCompactPathToolEntry(entry) ? name : null;
}

export function groupRenderableWorkArtifacts(
  entries: ReadonlyArray<WorkLogEntry>,
): RenderableWorkArtifact[] {
  const grouped: RenderableWorkArtifact[] = [];

  for (const entry of entries) {
    const variant = resolveWorkArtifactVariant(entry);
    const previous = grouped.at(-1);
    if (variant === "command" && previous?.kind === "command-group") {
      previous.entries.push(entry);
      continue;
    }

    if (variant === "command") {
      grouped.push({ kind: "command-group", entries: [entry] });
      continue;
    }

    const pathToolGroupKey = compactPathToolGroupKey(entry);
    if (
      pathToolGroupKey &&
      previous?.kind === "path-tool-group" &&
      compactPathToolGroupKey(previous.entries[0] ?? null) === pathToolGroupKey
    ) {
      previous.entries.push(entry);
      continue;
    }

    if (pathToolGroupKey) {
      grouped.push({ kind: "path-tool-group", entries: [entry] });
      continue;
    }

    grouped.push({ kind: "entry", entry });
  }

  return grouped;
}

export function deriveWorkRowArtifacts(
  entries: ReadonlyArray<WorkLogEntry>,
  expanded: boolean,
  maxVisibleEntries: number,
): {
  hiddenCount: number;
  renderableArtifacts: RenderableWorkArtifact[];
  showOuterToggle: boolean;
} {
  const fullArtifacts = groupRenderableWorkArtifacts(entries);
  const canDelegateCollapseToInnerArtifact =
    fullArtifacts.length === 1 && fullArtifacts[0]?.kind !== "entry";
  const hasOverflow = entries.length > maxVisibleEntries;

  if (!hasOverflow || expanded || canDelegateCollapseToInnerArtifact) {
    return {
      hiddenCount: 0,
      renderableArtifacts: fullArtifacts,
      showOuterToggle: hasOverflow && !canDelegateCollapseToInnerArtifact,
    };
  }

  const visibleEntries = entries.slice(-maxVisibleEntries);
  return {
    hiddenCount: entries.length - visibleEntries.length,
    renderableArtifacts: groupRenderableWorkArtifacts(visibleEntries),
    showOuterToggle: true,
  };
}
