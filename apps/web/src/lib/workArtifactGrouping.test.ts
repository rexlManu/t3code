import { describe, expect, it } from "vitest";

import type { WorkLogEntry } from "../session-logic";
import { deriveWorkRowArtifacts } from "./workArtifactGrouping";

function buildWorkEntry(
  id: string,
  overrides: Partial<WorkLogEntry> = {},
): WorkLogEntry {
  return {
    id,
    createdAt: `2026-03-09T00:00:0${id}Z`,
    label: `entry-${id}`,
    tone: "tool",
    ...overrides,
  };
}

describe("deriveWorkRowArtifacts", () => {
  it("delegates overflow to a single command group", () => {
    const entries = Array.from({ length: 9 }, (_, index) =>
      buildWorkEntry(String(index), {
        command: `echo ${index}`,
        toolCall: {
          name: "bash",
          itemType: "command_execution",
        },
      }),
    );

    const result = deriveWorkRowArtifacts(entries, false, 6);

    expect(result.hiddenCount).toBe(0);
    expect(result.showOuterToggle).toBe(false);
    expect(result.renderableArtifacts).toHaveLength(1);
    expect(result.renderableArtifacts[0]).toMatchObject({
      kind: "command-group",
    });
    if (result.renderableArtifacts[0]?.kind !== "command-group") {
      throw new Error("expected command-group");
    }
    expect(result.renderableArtifacts[0].entries).toHaveLength(9);
  });

  it("keeps the outer overflow toggle for mixed artifacts", () => {
    const entries = [
      buildWorkEntry("0", {
        command: "echo 0",
        toolCall: { name: "bash", itemType: "command_execution" },
      }),
      buildWorkEntry("1", {
        command: "echo 1",
        toolCall: { name: "bash", itemType: "command_execution" },
      }),
      buildWorkEntry("2", {
        toolCall: { name: "read", itemType: "dynamic_tool_call", targetPath: "/tmp/a", compact: "path" },
      }),
      buildWorkEntry("3", {
        toolCall: { name: "read", itemType: "dynamic_tool_call", targetPath: "/tmp/b", compact: "path" },
      }),
      buildWorkEntry("4", {
        label: "search",
        toolCall: { name: "web_search", itemType: "web_search" },
      }),
      buildWorkEntry("5", {
        label: "agent",
        toolCall: { name: "delegate", itemType: "collab_agent_tool_call" },
      }),
      buildWorkEntry("6", {
        command: "echo 6",
        toolCall: { name: "bash", itemType: "command_execution" },
      }),
    ];

    const result = deriveWorkRowArtifacts(entries, false, 6);

    expect(result.hiddenCount).toBe(1);
    expect(result.showOuterToggle).toBe(true);
    expect(result.renderableArtifacts).toHaveLength(5);
    expect(result.renderableArtifacts.map((artifact) => artifact.kind)).toEqual([
      "command-group",
      "path-tool-group",
      "entry",
      "entry",
      "command-group",
    ]);
  });

  it("returns full artifacts once the outer group is expanded", () => {
    const entries = [
      buildWorkEntry("0", {
        command: "echo 0",
        toolCall: { name: "bash", itemType: "command_execution" },
      }),
      buildWorkEntry("1", {
        toolCall: { name: "read", itemType: "dynamic_tool_call", targetPath: "/tmp/a", compact: "path" },
      }),
      buildWorkEntry("2", {
        label: "search",
        toolCall: { name: "web_search", itemType: "web_search" },
      }),
      buildWorkEntry("3", {
        label: "agent",
        toolCall: { name: "delegate", itemType: "collab_agent_tool_call" },
      }),
      buildWorkEntry("4", {
        command: "echo 4",
        toolCall: { name: "bash", itemType: "command_execution" },
      }),
      buildWorkEntry("5", {
        command: "echo 5",
        toolCall: { name: "bash", itemType: "command_execution" },
      }),
      buildWorkEntry("6", {
        label: "search-2",
        toolCall: { name: "web_search", itemType: "web_search" },
      }),
    ];

    const result = deriveWorkRowArtifacts(entries, true, 6);

    expect(result.hiddenCount).toBe(0);
    expect(result.showOuterToggle).toBe(true);
    expect(result.renderableArtifacts).toHaveLength(6);
  });
});
