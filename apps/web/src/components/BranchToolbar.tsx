import type { ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";

import { cn, newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStore } from "../store";
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
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const setThreadBranchAction = useStore((store) => store.setThreadBranch);
  const draftThread = useComposerDraftStore((store) => store.getDraftThread(threadId));
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);

  const serverThread = threads.find((thread) => thread.id === threadId);
  const activeProjectId = serverThread?.projectId ?? draftThread?.projectId ?? null;
  const activeProject = projects.find((project) => project.id === activeProjectId);
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
    <div className="mx-auto flex w-full max-w-3xl items-center justify-between pb-3 pt-1">
      <div className="flex items-center gap-2">
        {envLocked || activeWorktreePath ? (
          <span className="border border-transparent px-[calc(--spacing(2)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs">
            {activeWorktreePath ? "Worktree" : "Local"}
          </span>
        ) : (
          <div className="inline-flex items-center gap-1 rounded border border-foreground/10 bg-background/60 p-1 shadow-[0_8px_24px_-20px_rgba(0,0,0,0.65)]">
            <button
              type="button"
              className={cn(
                "inline-flex h-9 items-center justify-center rounded px-4 text-sm font-semibold transition-colors",
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
                "inline-flex h-9 items-center justify-center rounded px-4 text-sm font-semibold transition-colors",
                effectiveEnvMode === "worktree"
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground/85",
              )}
              onClick={() => onEnvModeChange("worktree")}
            >
              New Worktree
            </button>
          </div>
        )}
      </div>

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
  );
}
