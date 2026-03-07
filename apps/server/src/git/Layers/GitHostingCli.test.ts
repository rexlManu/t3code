import { beforeEach, describe, expect, it, vi } from "vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";

import type { ProcessRunOptions, ProcessRunResult } from "../../processRunner";
import { GitCore, type GitCoreShape } from "../Services/GitCore.ts";
import { GitHostingCli } from "../Services/GitHostingCli.ts";
import { GitHostingCliLive } from "./GitHostingCli.ts";

const { runProcessMock } = vi.hoisted(() => ({
  runProcessMock:
    vi.fn<
      (
        command: string,
        args: readonly string[],
        options?: ProcessRunOptions,
      ) => Promise<ProcessRunResult>
    >(),
}));

vi.mock("../../processRunner", () => ({
  runProcess: runProcessMock,
}));

function processResult(
  overrides: Partial<ProcessRunResult> & Pick<ProcessRunResult, "stdout" | "code">,
): ProcessRunResult {
  return {
    stdout: overrides.stdout,
    code: overrides.code,
    stderr: overrides.stderr ?? "",
    signal: overrides.signal ?? null,
    timedOut: overrides.timedOut ?? false,
    stdoutTruncated: overrides.stdoutTruncated ?? false,
    stderrTruncated: overrides.stderrTruncated ?? false,
  };
}

function createGitCore(originUrl: string | null): GitCoreShape {
  return {
    getOriginUrl: () => Effect.succeed(originUrl),
  } as unknown as GitCoreShape;
}

async function makeService(originUrl: string | null) {
  const layer = Layer.mergeAll(
    GitHostingCliLive,
    Layer.succeed(GitCore, createGitCore(originUrl)),
    NodeServices.layer,
  );

  return Effect.runPromise(Effect.service(GitHostingCli).pipe(Effect.provide(layer)));
}

describe("GitHostingCli", () => {
  beforeEach(() => {
    runProcessMock.mockReset();
  });

  it("uses the origin GitHub repo slug for PR listing on forks", async () => {
    runProcessMock.mockResolvedValue(processResult({ code: 0, stdout: "[]\n" }));
    const service = await makeService("git@github.com:rexlmanu/t3code.git");

    await Effect.runPromise(
      service.listPullRequests({
        cwd: "/virtual/repo",
        headBranch: "feature/fork-pr",
        state: "open",
        limit: 5,
      }),
    );

    expect(runProcessMock).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["--repo", "rexlmanu/t3code", "pr", "list"]),
      expect.objectContaining({ cwd: "/virtual/repo" }),
    );
  });

  it("uses the origin GitHub repo slug for PR creation on forks", async () => {
    runProcessMock.mockImplementation(async (_command, args) => {
      if (args.includes("pr") && args.includes("create")) {
        return processResult({ code: 0, stdout: "" });
      }
      throw new Error(`Unexpected command: gh ${args.join(" ")}`);
    });
    const service = await makeService("git@github.com:rexlmanu/t3code.git");

    await Effect.runPromise(
      service.createPullRequest({
        cwd: "/virtual/repo",
        baseBranch: "main",
        headBranch: "feature/fork-pr",
        title: "Fix fork PR target",
        body: "Body",
      }),
    );

    expect(runProcessMock).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining([
        "--repo",
        "rexlmanu/t3code",
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        "feature/fork-pr",
      ]),
      expect.objectContaining({ cwd: "/virtual/repo" }),
    );
  });

  it("uses the origin GitHub repo slug for default branch lookup on forks", async () => {
    runProcessMock.mockResolvedValue(processResult({ code: 0, stdout: "main\n" }));
    const service = await makeService("https://github.com/rexlmanu/t3code.git");

    const branch = await Effect.runPromise(service.getDefaultBranch({ cwd: "/virtual/repo" }));

    expect(branch).toBe("main");
    expect(runProcessMock).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["--repo", "rexlmanu/t3code", "repo", "view"]),
      expect.objectContaining({ cwd: "/virtual/repo" }),
    );
  });
});
