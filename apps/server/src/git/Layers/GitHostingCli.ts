import { randomUUID } from "node:crypto";

import { Effect, FileSystem, Layer, Path } from "effect";

import { runProcess } from "../../processRunner";
import { GitHostingCliError } from "../Errors.ts";
import { GitCore } from "../Services/GitCore.ts";
import {
  GitHostingCli,
  type GitHostingCliShape,
  type GitPullRequestSummary,
} from "../Services/GitHostingCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const GITHUB_HOSTS = new Set(["github.com"]);

interface TeaLogin {
  readonly name: string;
  readonly url: string | null;
  readonly sshHost: string | null;
}

interface TeaRepoMetadata {
  readonly ownerLogin: string;
  readonly defaultBranch: string | null;
}

type GitHostingProvider =
  | { readonly kind: "github" }
  | { readonly kind: "tea"; readonly loginName: string; readonly host: string }
  | { readonly kind: "unsupported"; readonly host: string | null };

function toNormalizedHost(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const hostname = new URL(trimmed).hostname.trim().toLowerCase();
      return hostname.length > 0 ? hostname : null;
    } catch {
      return null;
    }
  }

  const withoutUser = trimmed.replace(/^[^@]+@/, "");
  const bracketMatch = withoutUser.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim().toLowerCase();
  }

  const firstColon = withoutUser.indexOf(":");
  if (firstColon >= 0 && withoutUser.indexOf(":", firstColon + 1) === -1) {
    return withoutUser.slice(0, firstColon).trim().toLowerCase() || null;
  }

  return withoutUser.trim().toLowerCase() || null;
}

function parseGitRemoteHost(remoteUrl: string | null): string | null {
  const trimmed = remoteUrl?.trim();
  if (!trimmed) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const hostname = new URL(trimmed).hostname.trim().toLowerCase();
      return hostname.length > 0 ? hostname : null;
    } catch {
      return null;
    }
  }

  const scpLikeMatch = trimmed.match(/^(?:[^@]+@)?(\[[^\]]+\]|[^:]+):.+$/);
  return scpLikeMatch?.[1] ? toNormalizedHost(scpLikeMatch[1]) : null;
}

function isGitHubHost(host: string | null): boolean {
  return host !== null && GITHUB_HOSTS.has(host);
}

function isMissingCommandError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("Command not found:") || error.message.includes("ENOENT");
}

function normalizeGitHostingCliError(
  operation: string,
  tool: "gh" | "tea",
  error: unknown,
): GitHostingCliError {
  if (tool === "gh") {
    if (isMissingCommandError(error)) {
      return new GitHostingCliError({
        operation,
        detail: "GitHub CLI (`gh`) is required but not available on PATH.",
        cause: error,
      });
    }

    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (
        lower.includes("authentication failed") ||
        lower.includes("not logged in") ||
        lower.includes("gh auth login") ||
        lower.includes("no oauth token")
      ) {
        return new GitHostingCliError({
          operation,
          detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
          cause: error,
        });
      }

      return new GitHostingCliError({
        operation,
        detail: `GitHub CLI command failed: ${error.message}`,
        cause: error,
      });
    }

    return new GitHostingCliError({
      operation,
      detail: "GitHub CLI command failed.",
      cause: error,
    });
  }

  if (isMissingCommandError(error)) {
    return new GitHostingCliError({
      operation,
      detail: "Tea CLI (`tea`) is required for this repository host but not available on PATH.",
      cause: error,
    });
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      lower.includes("unauthorized") ||
      lower.includes("authentication") ||
      lower.includes("forbidden") ||
      lower.includes("no login") ||
      lower.includes("invalid token") ||
      lower.includes("oauth")
    ) {
      return new GitHostingCliError({
        operation,
        detail: "Tea CLI is not authenticated for this instance. Run `tea login add <instance-url>` and retry.",
        cause: error,
      });
    }

    return new GitHostingCliError({
      operation,
      detail: `Tea CLI command failed: ${error.message}`,
      cause: error,
    });
  }

  return new GitHostingCliError({
    operation,
    detail: "Tea CLI command failed.",
    cause: error,
  });
}

function unsupportedProviderError(operation: string, host: string | null): GitHostingCliError {
  const hostDetail = host ? `origin host '${host}'` : "the repository origin";
  return new GitHostingCliError({
    operation,
    detail: `No supported pull request CLI is configured for ${hostDetail}. Use GitHub or configure a matching tea login for this instance.`,
  });
}

function parseGitHubPullRequests(raw: string): ReadonlyArray<GitPullRequestSummary> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error("GitHub CLI returned non-array JSON.");
  }

  const result: Array<GitPullRequestSummary> = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;

    const record = entry as Record<string, unknown>;
    const number = record.number;
    const title = record.title;
    const url = record.url;
    const baseRefName = record.baseRefName;
    const headRefName = record.headRefName;
    const state = record.state;
    const mergedAt = record.mergedAt;
    const updatedAt = record.updatedAt;
    if (
      typeof number !== "number" ||
      !Number.isInteger(number) ||
      number <= 0 ||
      typeof title !== "string" ||
      typeof url !== "string" ||
      typeof baseRefName !== "string" ||
      typeof headRefName !== "string"
    ) {
      continue;
    }

    let normalizedState: "open" | "closed" | "merged";
    if ((typeof mergedAt === "string" && mergedAt.trim().length > 0) || state === "MERGED") {
      normalizedState = "merged";
    } else if (state === "CLOSED") {
      normalizedState = "closed";
    } else {
      normalizedState = "open";
    }

    result.push({
      number,
      title,
      url,
      baseRefName,
      headRefName,
      state: normalizedState,
      updatedAt: typeof updatedAt === "string" && updatedAt.trim().length > 0 ? updatedAt : null,
    });
  }

  return result;
}

function parseTeaLogins(raw: string): ReadonlyArray<TeaLogin> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error("Tea CLI returned non-array login JSON.");
  }

  const result: Array<TeaLogin> = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = record.name;
    if (typeof name !== "string" || name.trim().length === 0) continue;
    result.push({
      name,
      url: typeof record.url === "string" && record.url.trim().length > 0 ? record.url : null,
      sshHost:
        typeof record.ssh_host === "string" && record.ssh_host.trim().length > 0
          ? record.ssh_host
          : null,
    });
  }

  return result;
}

function findTeaLoginForHost(logins: ReadonlyArray<TeaLogin>, host: string): TeaLogin | null {
  const normalizedHost = toNormalizedHost(host);
  if (!normalizedHost) return null;

  for (const login of logins) {
    const loginHosts = [toNormalizedHost(login.url), toNormalizedHost(login.sshHost)].filter(
      (value): value is string => value !== null,
    );
    if (loginHosts.includes(normalizedHost)) {
      return login;
    }
  }

  return null;
}

function parseTeaRepoMetadata(raw: string): TeaRepoMetadata {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Tea CLI returned empty repository JSON.");
  }

  const parsed: unknown = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Tea CLI returned invalid repository JSON.");
  }

  const record = parsed as Record<string, unknown>;
  const defaultBranch =
    typeof record.default_branch === "string" && record.default_branch.trim().length > 0
      ? record.default_branch.trim()
      : null;
  const owner = record.owner;
  const ownerLogin =
    owner && typeof owner === "object"
      ? ((owner as Record<string, unknown>).login ??
          (owner as Record<string, unknown>).username ??
          (owner as Record<string, unknown>).name)
      : null;
  if (typeof ownerLogin !== "string" || ownerLogin.trim().length === 0) {
    throw new Error("Tea CLI repository JSON did not include an owner login.");
  }

  return {
    ownerLogin: ownerLogin.trim(),
    defaultBranch,
  };
}

function extractTeaBranchRef(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const ref = record.ref;
  return typeof ref === "string" && ref.trim().length > 0 ? ref.trim() : null;
}

function parseTeaPullRequests(raw: string): ReadonlyArray<GitPullRequestSummary> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error("Tea CLI returned non-array pull request JSON.");
  }

  const result: Array<GitPullRequestSummary> = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;

    const number = record.number;
    const title = record.title;
    const url = record.html_url;
    const baseRefName = extractTeaBranchRef(record.base);
    const headRefName = extractTeaBranchRef(record.head);
    const merged = record.merged;
    const mergedAt = record.merged_at;
    const state = record.state;
    const updatedAt = record.updated_at;
    if (
      typeof number !== "number" ||
      !Number.isInteger(number) ||
      number <= 0 ||
      typeof title !== "string" ||
      typeof url !== "string" ||
      baseRefName === null ||
      headRefName === null
    ) {
      continue;
    }

    let normalizedState: "open" | "closed" | "merged";
    if (merged === true || (typeof mergedAt === "string" && mergedAt.trim().length > 0)) {
      normalizedState = "merged";
    } else if (typeof state === "string" && state.toLowerCase() === "closed") {
      normalizedState = "closed";
    } else {
      normalizedState = "open";
    }

    result.push({
      number,
      title,
      url,
      baseRefName,
      headRefName,
      state: normalizedState,
      updatedAt: typeof updatedAt === "string" && updatedAt.trim().length > 0 ? updatedAt : null,
    });
  }

  return result;
}

function sortPullRequestsByUpdatedAt(
  pullRequests: ReadonlyArray<GitPullRequestSummary>,
): ReadonlyArray<GitPullRequestSummary> {
  return pullRequests.toSorted((left, right) => {
    const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
    const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
    return rightTime - leftTime;
  });
}

const makeGitHostingCli = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";

  const executeGitHub = (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly operation: string;
    readonly timeoutMs?: number;
  }) =>
    Effect.tryPromise({
      try: () =>
        runProcess("gh", [...input.args], {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      catch: (error) => normalizeGitHostingCliError(input.operation, "gh", error),
    });

  const executeTea = (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly operation: string;
    readonly timeoutMs?: number;
  }) =>
    Effect.tryPromise({
      try: () =>
        runProcess("tea", [...input.args], {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      catch: (error) => normalizeGitHostingCliError(input.operation, "tea", error),
    });

  const listTeaLogins = (cwd: string) =>
    executeTea({
      cwd,
      operation: "listTeaLogins",
      args: ["logins", "list", "--output", "json"],
    }).pipe(
      Effect.map((result) => result.stdout),
      Effect.flatMap((raw) =>
        Effect.try({
          try: () => parseTeaLogins(raw),
          catch: (error) =>
            new GitHostingCliError({
              operation: "listTeaLogins",
              detail:
                error instanceof Error
                  ? `Tea CLI returned invalid login JSON: ${error.message}`
                  : "Tea CLI returned invalid login JSON.",
              ...(error !== undefined ? { cause: error } : {}),
            }),
        }),
      ),
    );

  const resolveProvider = (cwd: string): Effect.Effect<GitHostingProvider, GitHostingCliError> =>
    Effect.gen(function* () {
      const originUrl = yield* gitCore.getOriginUrl(cwd).pipe(Effect.catch(() => Effect.succeed(null)));
      const host = parseGitRemoteHost(originUrl);
      if (isGitHubHost(host)) {
        return { kind: "github" } as const;
      }
      if (!host) {
        return { kind: "unsupported", host: null } as const;
      }

      const teaLogins = yield* listTeaLogins(cwd).pipe(
        Effect.catch((error) => {
          if (error.detail.includes("not available on PATH")) {
            return Effect.succeed([] as const);
          }
          return Effect.fail(error);
        }),
      );
      const matchedLogin = findTeaLoginForHost(teaLogins, host);
      if (matchedLogin) {
        return { kind: "tea", loginName: matchedLogin.name, host } as const;
      }

      return { kind: "unsupported", host } as const;
    });

  const executeTeaApi = (input: {
    readonly cwd: string;
    readonly loginName: string;
    readonly endpoint: string;
    readonly operation: string;
    readonly method?: "GET" | "POST";
    readonly data?: unknown;
  }) => {
    const args = ["api", "--login", input.loginName, "--remote", "origin"];
    if (input.method && input.method !== "GET") {
      args.push("--method", input.method);
    }
    if (input.data !== undefined) {
      args.push("--data", JSON.stringify(input.data));
    }
    args.push(input.endpoint);
    return executeTea({
      cwd: input.cwd,
      operation: input.operation,
      args,
    }).pipe(Effect.map((result) => result.stdout));
  };

  const getTeaRepoMetadata = (cwd: string, loginName: string) =>
    executeTeaApi({
      cwd,
      loginName,
      endpoint: "/repos/{owner}/{repo}",
      operation: "getTeaRepoMetadata",
    }).pipe(
      Effect.flatMap((raw) =>
        Effect.try({
          try: () => parseTeaRepoMetadata(raw),
          catch: (error) =>
            new GitHostingCliError({
              operation: "getTeaRepoMetadata",
              detail:
                error instanceof Error
                  ? `Tea CLI returned invalid repository JSON: ${error.message}`
                  : "Tea CLI returned invalid repository JSON.",
              ...(error !== undefined ? { cause: error } : {}),
            }),
        }),
      ),
    );

  const service = {
    listPullRequests: (input) =>
      resolveProvider(input.cwd).pipe(
        Effect.flatMap((provider) => {
          if (provider.kind === "github") {
            return executeGitHub({
              cwd: input.cwd,
              operation: "listPullRequests",
              args: [
                "pr",
                "list",
                "--head",
                input.headBranch,
                "--state",
                input.state,
                "--limit",
                String(input.limit ?? (input.state === "open" ? 1 : 20)),
                "--json",
                "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt",
              ],
            }).pipe(
              Effect.map((result) => result.stdout),
              Effect.flatMap((raw) =>
                Effect.try({
                  try: () => parseGitHubPullRequests(raw),
                  catch: (error) =>
                    new GitHostingCliError({
                      operation: "listPullRequests",
                      detail:
                        error instanceof Error
                          ? `GitHub CLI returned invalid PR list JSON: ${error.message}`
                          : "GitHub CLI returned invalid PR list JSON.",
                      ...(error !== undefined ? { cause: error } : {}),
                    }),
                }),
              ),
            );
          }

          if (provider.kind === "unsupported") {
            return Effect.fail(unsupportedProviderError("listPullRequests", provider.host));
          }

          const fetchLimit = Math.max(input.limit ?? (input.state === "open" ? 1 : 20), input.state === "open" ? 50 : 100);
          return executeTeaApi({
            cwd: input.cwd,
            loginName: provider.loginName,
            endpoint: `/repos/{owner}/{repo}/pulls?state=${input.state}&page=1&limit=${fetchLimit}`,
            operation: "listPullRequests",
          }).pipe(
            Effect.flatMap((raw) =>
              Effect.try({
                try: () =>
                  sortPullRequestsByUpdatedAt(parseTeaPullRequests(raw).filter((pr) => pr.headRefName === input.headBranch)).slice(
                    0,
                    input.limit ?? Number.MAX_SAFE_INTEGER,
                  ),
                catch: (error) =>
                  new GitHostingCliError({
                    operation: "listPullRequests",
                    detail:
                      error instanceof Error
                        ? `Tea CLI returned invalid PR list JSON: ${error.message}`
                        : "Tea CLI returned invalid PR list JSON.",
                    ...(error !== undefined ? { cause: error } : {}),
                  }),
              }),
            ),
          );
        }),
      ),
    createPullRequest: (input) =>
      resolveProvider(input.cwd).pipe(
        Effect.flatMap((provider) => {
          if (provider.kind === "github") {
            const bodyFile = path.join(tempDir, `t3code-pr-body-${process.pid}-${randomUUID()}.md`);
            return fileSystem
              .writeFileString(bodyFile, input.body)
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new GitHostingCliError({
                      operation: "createPullRequest",
                      detail: "Failed to write pull request body temp file.",
                      ...(cause !== undefined ? { cause } : {}),
                    }),
                ),
                Effect.flatMap(() =>
                  executeGitHub({
                    cwd: input.cwd,
                    operation: "createPullRequest",
                    args: [
                      "pr",
                      "create",
                      "--base",
                      input.baseBranch,
                      "--head",
                      input.headBranch,
                      "--title",
                      input.title,
                      "--body-file",
                      bodyFile,
                    ],
                  }),
                ),
                Effect.ensuring(fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))),
                Effect.asVoid,
              );
          }

          if (provider.kind === "unsupported") {
            return Effect.fail(unsupportedProviderError("createPullRequest", provider.host));
          }

          return executeTeaApi({
            cwd: input.cwd,
            loginName: provider.loginName,
            endpoint: "/repos/{owner}/{repo}/pulls",
            operation: "createPullRequest",
            method: "POST",
            data: {
              base: input.baseBranch,
              head: input.headBranch,
              title: input.title,
              body: input.body,
            },
          }).pipe(Effect.asVoid);
        }),
      ),
    getDefaultBranch: (input) =>
      resolveProvider(input.cwd).pipe(
        Effect.flatMap((provider) => {
          if (provider.kind === "github") {
            return executeGitHub({
              cwd: input.cwd,
              operation: "getDefaultBranch",
              args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
            }).pipe(
              Effect.map((result) => {
                const trimmed = result.stdout.trim();
                return trimmed.length > 0 ? trimmed : null;
              }),
            );
          }

          if (provider.kind === "unsupported") {
            return Effect.fail(unsupportedProviderError("getDefaultBranch", provider.host));
          }

          return getTeaRepoMetadata(input.cwd, provider.loginName).pipe(
            Effect.map((metadata) => metadata.defaultBranch),
          );
        }),
      ),
  } satisfies GitHostingCliShape;

  return service;
});

export const GitHostingCliLive = Layer.effect(GitHostingCli, makeGitHostingCli);
