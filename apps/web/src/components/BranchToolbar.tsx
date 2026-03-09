import type { ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";

import { cn, newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { selectProjectById, selectProjectIdForThread, selectThreadById, useStore } from "../store";
import {
  EnvMode,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
} from "./BranchToolbar.logic";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";

interface BranchToolbarProps {
  threadId: ThreadId;
  onEnvModeChange: (mode: EnvMode) => void;
  envLocked: boolean;
  onComposerFocusRequest?: () => void;
}

export default function BranchToolbar({
  threadId,
  onEnvModeChange,
  envLocked,
  onComposerFocusRequest,
}: BranchToolbarProps) {
  const setThreadBranchAction = useStore((store) => store.setThreadBranch);
  const serverThread = useStore((state) => selectThreadById(state, threadId));
  const serverProjectId = useStore((state) => selectProjectIdForThread(state, threadId));
  const draftThread = useComposerDraftStore((store) => store.getDraftThread(threadId));
  const activeProjectId = serverProjectId ?? draftThread?.projectId ?? null;
  const activeProject = useStore((state) => selectProjectById(state, activeProjectId));
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const activeThreadId = serverThread?.id ?? (draftThread ? threadId : undefined);
  const activeThreadBranch = serverThread?.branch ?? draftThread?.branch ?? null;
  const activeWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const branchCwd = activeWorktreePath ?? activeProject?.cwd ?? null;
  const hasServerThread = serverThread !== undefined;
  const effectiveEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerThread,
    draftThreadEnvMode: draftThread?.envMode,
  });

  const setThreadBranch = useCallback(
    (branch: string | null, worktreePath: string | null) => {
      if (!activeThreadId) return;
      const api = readNativeApi();
      // If the effective cwd is about to change, stop the running session so the
      // next message creates a new one with the correct cwd.
      if (serverThread?.session && worktreePath !== activeWorktreePath && api) {
        void api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId: activeThreadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
      if (api && hasServerThread) {
        void api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: activeThreadId,
          branch,
          worktreePath,
        });
      }
      if (hasServerThread) {
        setThreadBranchAction(activeThreadId, branch, worktreePath);
        return;
      }
      const nextDraftEnvMode = resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: worktreePath,
        currentWorktreePath: activeWorktreePath,
        effectiveEnvMode,
      });
      setDraftThreadContext(threadId, {
        branch,
        worktreePath,
        envMode: nextDraftEnvMode,
      });
    },
    [
      activeThreadId,
      serverThread?.session,
      activeWorktreePath,
      hasServerThread,
      setThreadBranchAction,
      setDraftThreadContext,
      threadId,
      effectiveEnvMode,
    ],
  );

  if (!activeThreadId || !activeProject) return null;

  return (
    <div className="px-3 pb-3 pt-1 sm:px-5">
      <div className="@container/branch-toolbar mx-auto flex w-full max-w-3xl min-w-0 items-center justify-between gap-2 overflow-hidden">
        <div className="flex min-w-0 shrink items-center gap-2">
          {envLocked || activeWorktreePath ? (
            <span className="border border-transparent px-[calc(--spacing(2)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs">
              {activeWorktreePath ? "Worktree" : "Local"}
            </span>
          ) : (
            <div className="inline-flex min-w-0 items-center gap-1 rounded border border-foreground/10 bg-background/60 p-0.5 shadow-[0_8px_24px_-20px_rgba(0,0,0,0.65)]">
              <button
                type="button"
                className={cn(
                  "inline-flex h-7 items-center justify-center rounded px-2.5 text-xs font-semibold whitespace-nowrap transition-colors @lg/branch-toolbar:h-8 @lg/branch-toolbar:px-4 @lg/branch-toolbar:text-sm",
                  effectiveEnvMode === "local"
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground/85",
                )}
                onClick={() => onEnvModeChange("local")}
              >
                Local
              </button>
              <button
                type="button"
                className={cn(
                  "inline-flex h-7 items-center justify-center rounded px-2.5 text-xs font-semibold whitespace-nowrap transition-colors @lg/branch-toolbar:h-8 @lg/branch-toolbar:px-4 @lg/branch-toolbar:text-sm",
                  effectiveEnvMode === "worktree"
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground/85",
                )}
                onClick={() => onEnvModeChange("worktree")}
              >
                <span className="@lg/branch-toolbar:hidden">Worktree</span>
                <span className="hidden @lg/branch-toolbar:inline">New Worktree</span>
              </button>
            </div>
          )}
        </div>

        <div className="min-w-0 shrink-0">
          <BranchToolbarBranchSelector
            activeProjectCwd={activeProject.cwd}
            activeThreadBranch={activeThreadBranch}
            activeWorktreePath={activeWorktreePath}
            branchCwd={branchCwd}
            effectiveEnvMode={effectiveEnvMode}
            envLocked={envLocked}
            onSetThreadBranch={setThreadBranch}
            {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
          />
        </div>
      </div>
    </div>
  );
}
