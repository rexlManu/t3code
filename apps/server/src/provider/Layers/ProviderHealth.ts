/**
 * ProviderHealthLive - Startup-time provider health checks.
 *
 * Performs one-time provider readiness probes when the server starts and
 * keeps the resulting snapshot in memory for `server.getConfig`.
 *
 * Uses effect's ChildProcessSpawner to run CLI probes natively.
 *
 * @module ProviderHealthLive
 */
import type {
  ServerProviderAuthStatus,
  ServerProviderStatus,
  ServerProviderStatusState,
} from '@t3tools/contracts';
import { Data, Effect, Layer, Option, Result, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

import { ServerConfig } from '../../config';
import { resolveGeminiCliLaunchSpec } from '../../cliEnvironment';
import { fetchOpenCodeModels } from '../../opencodeServerManager';
import {
  formatCodexCliUpgradeMessage,
  isCodexCliVersionSupported,
  parseCodexCliVersion,
} from '../codexCliVersion';
import { resolveBundledCopilotCliPath } from './copilotCliPath';
import {
  ProviderHealth,
  type ProviderHealthShape,
} from '../Services/ProviderHealth';

const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_OPENCODE_SERVER_URL = 'http://127.0.0.1:6733';
const CODEX_PROVIDER = 'codex' as const;
const COPILOT_PROVIDER = 'copilot' as const;
const CLAUDE_CODE_PROVIDER = 'claudeCode' as const;
const CURSOR_PROVIDER = 'cursor' as const;
const GEMINI_PROVIDER = 'gemini' as const;
const OPENCODE_PROVIDER = 'opencode' as const;

class OpenCodeModelDiscoveryError extends Data.TaggedError(
  'OpenCodeModelDiscoveryError',
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const discoverOpenCodeModels = (input: {
  directory: string;
  serverUrl?: string;
}) =>
  Effect.tryPromise({
    try: () =>
      fetchOpenCodeModels({
        directory: input.directory,
        ...(input.serverUrl ? { serverUrl: input.serverUrl } : {}),
      }),
    catch: (cause) =>
      new OpenCodeModelDiscoveryError({
        message:
          cause instanceof Error
            ? cause.message
            : 'OpenCode model discovery failed.',
        cause,
      }),
  });

// ── Pure helpers ────────────────────────────────────────────────────

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function nonEmptyTrimmed(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isCommandMissingCause(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return (
    lower.includes('command not found: codex') ||
    lower.includes('spawn codex enoent') ||
    lower.includes('enoent') ||
    lower.includes('notfound')
  );
}

function isSpecificCommandMissingCause(
  command: string,
  error: unknown,
): boolean {
  if (!(error instanceof Error)) return false;
  const target = command.toLowerCase();
  const lower = error.message.toLowerCase();
  return (
    lower.includes(`command not found: ${target}`) ||
    lower.includes(`spawn ${target} enoent`) ||
    (lower.includes('enoent') && lower.includes(target)) ||
    (lower.includes('notfound') && lower.includes(target))
  );
}

function detailFromResult(
  result: CommandResult & { readonly timedOut?: boolean },
): string | undefined {
  if (result.timedOut) return 'Timed out while running command.';
  const stderr = nonEmptyTrimmed(result.stderr);
  if (stderr) return stderr;
  const stdout = nonEmptyTrimmed(result.stdout);
  if (stdout) return stdout;
  if (result.code !== 0) {
    return `Command exited with code ${result.code}.`;
  }
  return undefined;
}

function extractAuthBoolean(value: unknown): boolean | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractAuthBoolean(entry);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  if (!value || typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  for (const key of [
    'authenticated',
    'isAuthenticated',
    'loggedIn',
    'isLoggedIn',
  ] as const) {
    if (typeof record[key] === 'boolean') return record[key];
  }
  for (const key of ['auth', 'status', 'session', 'account'] as const) {
    const nested = extractAuthBoolean(record[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function parseAuthStatusFromOutput(result: CommandResult): {
  readonly status: ServerProviderStatusState;
  readonly authStatus: ServerProviderAuthStatus;
  readonly message?: string;
} {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (
    lowerOutput.includes('unknown command') ||
    lowerOutput.includes('unrecognized command') ||
    lowerOutput.includes('unexpected argument')
  ) {
    return {
      status: 'warning',
      authStatus: 'unknown',
      message:
        'Codex CLI authentication status command is unavailable in this Codex version.',
    };
  }

  if (
    lowerOutput.includes('not logged in') ||
    lowerOutput.includes('login required') ||
    lowerOutput.includes('authentication required') ||
    lowerOutput.includes('run `codex login`') ||
    lowerOutput.includes('run codex login')
  ) {
    return {
      status: 'error',
      authStatus: 'unauthenticated',
      message:
        'Codex CLI is not authenticated. Run `codex login` and try again.',
    };
  }

  const parsedAuth = (() => {
    const trimmed = result.stdout.trim();
    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
      return {
        attemptedJsonParse: false as const,
        auth: undefined as boolean | undefined,
      };
    }
    try {
      return {
        attemptedJsonParse: true as const,
        auth: extractAuthBoolean(JSON.parse(trimmed)),
      };
    } catch {
      return {
        attemptedJsonParse: false as const,
        auth: undefined as boolean | undefined,
      };
    }
  })();

  if (parsedAuth.auth === true) {
    return { status: 'ready', authStatus: 'authenticated' };
  }
  if (parsedAuth.auth === false) {
    return {
      status: 'error',
      authStatus: 'unauthenticated',
      message:
        'Codex CLI is not authenticated. Run `codex login` and try again.',
    };
  }
  if (parsedAuth.attemptedJsonParse) {
    return {
      status: 'warning',
      authStatus: 'unknown',
      message:
        'Could not verify Codex authentication status from JSON output (missing auth marker).',
    };
  }
  if (result.code === 0) {
    return { status: 'ready', authStatus: 'authenticated' };
  }

  const detail = detailFromResult(result);
  return {
    status: 'warning',
    authStatus: 'unknown',
    message: detail
      ? `Could not verify Codex authentication status. ${detail}`
      : 'Could not verify Codex authentication status.',
  };
}

// ── Effect-native command execution ─────────────────────────────────

const collectStreamAsString = <E>(
  stream: Stream.Stream<Uint8Array, E>,
): Effect.Effect<string, E> =>
  Stream.runFold(
    stream,
    () => '',
    (acc, chunk) => acc + new TextDecoder().decode(chunk),
  );

const runCommand = (commandName: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = ChildProcess.make(commandName, [...args], {
      shell: process.platform === 'win32',
    });

    const child = yield* spawner.spawn(command);

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: 'unbounded' },
    );

    return { stdout, stderr, code: exitCode } satisfies CommandResult;
  }).pipe(Effect.scoped);

const runCodexCommand = (args: ReadonlyArray<string>) =>
  runCommand('codex', args);
const runOpenCodeCommand = (args: ReadonlyArray<string>) =>
  runCommand('opencode', args);

function checkCliProviderStatus(input: {
  provider: ServerProviderStatus['provider'];
  displayName: string;
  command: string;
  args?: ReadonlyArray<string>;
  missingMessage: string;
  successMessage: string;
}): Effect.Effect<ServerProviderStatus, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    const checkedAt = new Date().toISOString();
    const probe = yield* runCommand(input.command, input.args ?? ['--version']).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );

    if (Result.isFailure(probe)) {
      const error = probe.failure;
      return {
        provider: input.provider,
        status: 'error' as const,
        available: false,
        authStatus: 'unknown' as const,
        checkedAt,
        message: isSpecificCommandMissingCause(input.command, error)
          ? input.missingMessage
          : `Failed to execute ${input.displayName} health check: ${error instanceof Error ? error.message : String(error)}.`,
      };
    }

    if (Option.isNone(probe.success)) {
      return {
        provider: input.provider,
        status: 'warning' as const,
        available: false,
        authStatus: 'unknown' as const,
        checkedAt,
        message: `${input.displayName} health check timed out.`,
      };
    }

    const result = probe.success.value;
    if (result.code !== 0) {
      const detail = detailFromResult(result);
      return {
        provider: input.provider,
        status: 'warning' as const,
        available: false,
        authStatus: 'unknown' as const,
        checkedAt,
        message: detail
          ? `${input.displayName} is installed but failed to run. ${detail}`
          : `${input.displayName} is installed but failed to run.`,
      };
    }

    return {
      provider: input.provider,
      status: 'ready' as const,
      available: true,
      authStatus: 'unknown' as const,
      checkedAt,
      message: input.successMessage,
    };
  });
}

// ── Health check ────────────────────────────────────────────────────

export const checkCodexProviderStatus: Effect.Effect<
  ServerProviderStatus,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const checkedAt = new Date().toISOString();

  // Probe 1: `codex --version` — is the CLI reachable?
  const versionProbe = yield* runCodexCommand(['--version']).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return {
      provider: CODEX_PROVIDER,
      status: 'error' as const,
      available: false,
      authStatus: 'unknown' as const,
      checkedAt,
      message: isCommandMissingCause(error)
        ? 'Codex CLI (`codex`) is not installed or not on PATH.'
        : `Failed to execute Codex CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }

  if (Option.isNone(versionProbe.success)) {
    return {
      provider: CODEX_PROVIDER,
      status: 'error' as const,
      available: false,
      authStatus: 'unknown' as const,
      checkedAt,
      message:
        'Codex CLI is installed but failed to run. Timed out while running command.',
    };
  }

  const version = versionProbe.success.value;
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return {
      provider: CODEX_PROVIDER,
      status: 'error' as const,
      available: false,
      authStatus: 'unknown' as const,
      checkedAt,
      message: detail
        ? `Codex CLI is installed but failed to run. ${detail}`
        : 'Codex CLI is installed but failed to run.',
    };
  }

  const parsedVersion = parseCodexCliVersion(`${version.stdout}\n${version.stderr}`);
  if (parsedVersion && !isCodexCliVersionSupported(parsedVersion)) {
    return {
      provider: CODEX_PROVIDER,
      status: "error" as const,
      available: false,
      authStatus: "unknown" as const,
      checkedAt,
      message: formatCodexCliUpgradeMessage(parsedVersion),
    };
  }

  // Probe 2: `codex login status` — is the user authenticated?
  const authProbe = yield* runCodexCommand(['login', 'status']).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(authProbe)) {
    const error = authProbe.failure;
    return {
      provider: CODEX_PROVIDER,
      status: 'warning' as const,
      available: true,
      authStatus: 'unknown' as const,
      checkedAt,
      message:
        error instanceof Error
          ? `Could not verify Codex authentication status: ${error.message}.`
          : 'Could not verify Codex authentication status.',
    };
  }

  if (Option.isNone(authProbe.success)) {
    return {
      provider: CODEX_PROVIDER,
      status: 'warning' as const,
      available: true,
      authStatus: 'unknown' as const,
      checkedAt,
      message:
        'Could not verify Codex authentication status. Timed out while running command.',
    };
  }

  const parsed = parseAuthStatusFromOutput(authProbe.success.value);
  return {
    provider: CODEX_PROVIDER,
    status: parsed.status,
    available: true,
    authStatus: parsed.authStatus,
    checkedAt,
    ...(parsed.message ? { message: parsed.message } : {}),
  } satisfies ServerProviderStatus;
});

export const checkOpenCodeProviderStatus: Effect.Effect<
  ServerProviderStatus,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const checkedAt = new Date().toISOString();
  const versionProbe = yield* runOpenCodeCommand(['--version']).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return {
      provider: OPENCODE_PROVIDER,
      status: 'error' as const,
      available: false,
      authStatus: 'unknown' as const,
      checkedAt,
      message: isSpecificCommandMissingCause('opencode', error)
        ? 'OpenCode CLI (`opencode`) is not installed or not on PATH.'
        : `Failed to execute OpenCode CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }

  if (Option.isNone(versionProbe.success)) {
    return {
      provider: OPENCODE_PROVIDER,
      status: 'error' as const,
      available: false,
      authStatus: 'unknown' as const,
      checkedAt,
      message:
        'OpenCode CLI is installed but failed to run. Timed out while running command.',
    };
  }

  const version = versionProbe.success.value;
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return {
      provider: OPENCODE_PROVIDER,
      status: 'error' as const,
      available: false,
      authStatus: 'unknown' as const,
      checkedAt,
      message: detail
        ? `OpenCode CLI is installed but failed to run. ${detail}`
        : 'OpenCode CLI is installed but failed to run.',
    };
  }

  return {
    provider: OPENCODE_PROVIDER,
    status: 'ready' as const,
    available: true,
    authStatus: 'unknown' as const,
    checkedAt,
    message: 'OpenCode CLI is available.',
  } satisfies ServerProviderStatus;
});

export const checkCopilotProviderStatus: Effect.Effect<
  ServerProviderStatus,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const bundledCliPath = resolveBundledCopilotCliPath();
  if (bundledCliPath) {
    return {
      provider: COPILOT_PROVIDER,
      status: 'ready' as const,
      available: true,
      authStatus: 'unknown' as const,
      checkedAt: new Date().toISOString(),
      message: 'GitHub Copilot runtime is available.',
    } satisfies ServerProviderStatus;
  }

  return yield* checkCliProviderStatus({
    provider: COPILOT_PROVIDER,
    displayName: 'GitHub Copilot CLI',
    command: 'copilot',
    missingMessage: 'GitHub Copilot CLI is not installed and no bundled runtime was found.',
    successMessage: 'GitHub Copilot CLI is available.',
  });
});

export const checkClaudeCodeProviderStatus = checkCliProviderStatus({
  provider: CLAUDE_CODE_PROVIDER,
  displayName: 'Claude Code CLI',
  command: 'claude',
  missingMessage: 'Claude Code CLI (`claude`) is not installed or not on PATH.',
  successMessage: 'Claude Code CLI is available.',
});

export const checkCursorProviderStatus = checkCliProviderStatus({
  provider: CURSOR_PROVIDER,
  displayName: 'Cursor Agent CLI',
  command: 'agent',
  missingMessage: 'Cursor Agent CLI (`agent`) is not installed or not on PATH.',
  successMessage: 'Cursor Agent CLI is available.',
});

export const checkGeminiProviderStatus: Effect.Effect<
  ServerProviderStatus,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const launch = resolveGeminiCliLaunchSpec();
  if (!launch) {
    return {
      provider: GEMINI_PROVIDER,
      status: 'error' as const,
      available: false,
      authStatus: 'unknown' as const,
      checkedAt: new Date().toISOString(),
      message: 'Gemini CLI is not installed or could not be resolved.',
    } satisfies ServerProviderStatus;
  }

  return yield* checkCliProviderStatus({
    provider: GEMINI_PROVIDER,
    displayName: 'Gemini CLI',
    command: launch.command,
    args: [...launch.argsPrefix, '--version'],
    missingMessage: 'Gemini CLI is not installed or could not be resolved.',
    successMessage: 'Gemini CLI is available.',
  });
});

const resolveOpenCodeProviderStatus = (directory: string) =>
  Effect.gen(function* () {
    const opencodeBaseStatus = yield* checkOpenCodeProviderStatus;
    let opencodeStatus = opencodeBaseStatus;

    if (opencodeBaseStatus.available && opencodeBaseStatus.status !== 'error') {
      opencodeStatus = yield* discoverOpenCodeModels({
        directory,
      }).pipe(
        Effect.map(({ modelCatalog, models }) => ({
          ...opencodeBaseStatus,
          ...(models.length > 0 ? { models } : {}),
          ...(modelCatalog ? { modelCatalog } : {}),
          ...(models.length === 0
            ? {
                status: 'warning' as const,
                message: 'OpenCode is available but did not return any models.',
              }
            : {}),
        })),
        Effect.catch((cause) =>
          Effect.succeed({
            ...opencodeBaseStatus,
            status: 'warning' as const,
            message: `OpenCode is available but model discovery failed: ${cause.message}`,
          }),
        ),
      );
    }

    if (!opencodeStatus.available || opencodeStatus.status === 'error') {
      const discovered = yield* discoverOpenCodeModels({
        directory,
        serverUrl: DEFAULT_OPENCODE_SERVER_URL,
      }).pipe(Effect.result);
      if (Result.isSuccess(discovered)) {
        const { modelCatalog, models } = discovered.success;
        opencodeStatus = {
          provider: OPENCODE_PROVIDER,
          status: models.length > 0 ? 'ready' : 'warning',
          available: true,
          authStatus: 'unknown',
          checkedAt: new Date().toISOString(),
          message:
            models.length > 0
              ? 'Connected to a running OpenCode server at http://127.0.0.1:6733.'
              : 'Connected to a running OpenCode server, but it returned no models.',
          ...(models.length > 0 ? { models } : {}),
          ...(modelCatalog ? { modelCatalog } : {}),
        };
      }
    }

    return opencodeStatus;
  });

// ── Layer ───────────────────────────────────────────────────────────

export const ProviderHealthLive = Layer.effect(
  ProviderHealth,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const serverConfig = yield* ServerConfig;
    let cachedStatuses: ReadonlyArray<ServerProviderStatus> = [
      {
        provider: CODEX_PROVIDER,
        status: 'warning',
        available: false,
        authStatus: 'unknown',
        checkedAt: new Date().toISOString(),
        message: 'Checking Codex CLI availability...',
      },
      {
        provider: OPENCODE_PROVIDER,
        status: 'warning',
        available: false,
        authStatus: 'unknown',
        checkedAt: new Date().toISOString(),
        message: 'Checking OpenCode availability...',
      },
      {
        provider: COPILOT_PROVIDER,
        status: 'warning',
        available: false,
        authStatus: 'unknown',
        checkedAt: new Date().toISOString(),
        message: 'Checking GitHub Copilot availability...',
      },
      {
        provider: CLAUDE_CODE_PROVIDER,
        status: 'warning',
        available: false,
        authStatus: 'unknown',
        checkedAt: new Date().toISOString(),
        message: 'Checking Claude Code availability...',
      },
      {
        provider: CURSOR_PROVIDER,
        status: 'warning',
        available: false,
        authStatus: 'unknown',
        checkedAt: new Date().toISOString(),
        message: 'Checking Cursor availability...',
      },
      {
        provider: GEMINI_PROVIDER,
        status: 'warning',
        available: false,
        authStatus: 'unknown',
        checkedAt: new Date().toISOString(),
        message: 'Checking Gemini availability...',
      },
    ];

    let readyListeners: Array<(statuses: ReadonlyArray<ServerProviderStatus>) => void> = [];
    let resolved = false;

    const notifyReady = (statuses: ReadonlyArray<ServerProviderStatus>) => {
      resolved = true;
      cachedStatuses = statuses;
      for (const listener of readyListeners) {
        try {
          listener(statuses);
        } catch {
          // Ignore listener failures and keep notifying remaining listeners.
        }
      }
      readyListeners = [];
    };

    Effect.all(
      [
        checkCodexProviderStatus.pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
        resolveOpenCodeProviderStatus(serverConfig.cwd).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
        checkCopilotProviderStatus.pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
        checkClaudeCodeProviderStatus.pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
        checkCursorProviderStatus.pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
        checkGeminiProviderStatus.pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
      ],
      { concurrency: 'unbounded' },
    )
      .pipe(Effect.runPromise)
      .then(
        ([
          codexStatus,
          opencodeStatus,
          copilotStatus,
          claudeCodeStatus,
          cursorStatus,
          geminiStatus,
        ]) => {
          notifyReady([
            codexStatus,
            opencodeStatus,
            copilotStatus,
            claudeCodeStatus,
            cursorStatus,
            geminiStatus,
          ]);
        },
      )
      .catch(() => {
        const checkedAt = new Date().toISOString();
        notifyReady([
          {
            provider: CODEX_PROVIDER,
            status: 'error',
            available: false,
            authStatus: 'unknown',
            checkedAt,
            message: 'Failed to check Codex CLI status.',
          },
          {
            provider: OPENCODE_PROVIDER,
            status: 'error',
            available: false,
            authStatus: 'unknown',
            checkedAt,
            message: 'Failed to check OpenCode status.',
          },
          {
            provider: COPILOT_PROVIDER,
            status: 'error',
            available: false,
            authStatus: 'unknown',
            checkedAt,
            message: 'Failed to check GitHub Copilot status.',
          },
          {
            provider: CLAUDE_CODE_PROVIDER,
            status: 'error',
            available: false,
            authStatus: 'unknown',
            checkedAt,
            message: 'Failed to check Claude Code status.',
          },
          {
            provider: CURSOR_PROVIDER,
            status: 'error',
            available: false,
            authStatus: 'unknown',
            checkedAt,
            message: 'Failed to check Cursor status.',
          },
          {
            provider: GEMINI_PROVIDER,
            status: 'error',
            available: false,
            authStatus: 'unknown',
            checkedAt,
            message: 'Failed to check Gemini status.',
          },
        ]);
      })
      ;

    return {
      getStatuses: Effect.sync(() => cachedStatuses),
      onReady: (cb) => {
        if (resolved) {
          try {
            cb(cachedStatuses);
          } catch {
            // Ignore listener failures.
          }
          return;
        }
        readyListeners.push(cb);
      },
    } satisfies ProviderHealthShape;
  }),
);
