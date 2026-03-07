/**
 * GitHostingCli - Effect service contract for repository hosting CLI interactions.
 *
 * Selects the appropriate provider CLI (`gh` for GitHub, `tea` for configured
 * Gitea/Forgejo instances) and exposes normalized pull request operations.
 *
 * @module GitHostingCli
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { GitHostingCliError } from "../Errors.ts";

export interface GitPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state: "open" | "closed" | "merged";
  readonly updatedAt: string | null;
}

/**
 * GitHostingCliShape - Service API for executing pull request operations.
 */
export interface GitHostingCliShape {
  /**
   * List pull requests for a head branch.
   */
  readonly listPullRequests: (input: {
    readonly cwd: string;
    readonly headBranch: string;
    readonly state: "open" | "all";
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitPullRequestSummary>, GitHostingCliError>;

  /**
   * Create a pull request from branch context and body content.
   */
  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headBranch: string;
    readonly title: string;
    readonly body: string;
  }) => Effect.Effect<void, GitHostingCliError>;

  /**
   * Resolve repository default branch through hosting metadata.
   */
  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHostingCliError>;
}

/**
 * GitHostingCli - Service tag for hosting CLI process execution.
 */
export class GitHostingCli extends ServiceMap.Service<GitHostingCli, GitHostingCliShape>()(
  "t3/git/Services/GitHostingCli",
) {}
