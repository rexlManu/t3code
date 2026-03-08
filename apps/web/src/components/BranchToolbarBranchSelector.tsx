import type { GitBranch } from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckIcon, ChevronDownIcon, GitBranchIcon, SearchIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import { gitBranchesQueryOptions, gitQueryKeys, invalidateGitQueries } from "../lib/gitReactQuery";
import { readNativeApi } from "../nativeApi";
import {
  dedupeRemoteBranchesWithLocalMatches,
  deriveLocalBranchNameFromRemoteRef,
  EnvMode,
  resolveBranchToolbarValue,
} from "./BranchToolbar.logic";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "./ui/combobox";
import { toastManager } from "./ui/toast";

interface BranchToolbarBranchSelectorProps {
  activeProjectCwd: string;
  activeThreadBranch: string | null;
  activeWorktreePath: string | null;
  branchCwd: string | null;
  effectiveEnvMode: EnvMode;
  envLocked: boolean;
  onSetThreadBranch: (branch: string | null, worktreePath: string | null) => void;
  onComposerFocusRequest?: () => void;
}

function toBranchActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

function getBranchTriggerLabel(input: {
  activeWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
  resolvedActiveBranch: string | null;
}): string {
  const { activeWorktreePath, effectiveEnvMode, resolvedActiveBranch } = input;
  if (!resolvedActiveBranch) {
    return "Select branch";
  }
  if (effectiveEnvMode === "worktree" && !activeWorktreePath) {
    return `From ${resolvedActiveBranch}`;
  }
  return resolvedActiveBranch;
}

export function BranchToolbarBranchSelector({
  activeProjectCwd,
  activeThreadBranch,
  activeWorktreePath,
  branchCwd,
  effectiveEnvMode,
  envLocked,
  onSetThreadBranch,
  onComposerFocusRequest,
}: BranchToolbarBranchSelectorProps) {
  const queryClient = useQueryClient();
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");

  const branchesQuery = useQuery(gitBranchesQueryOptions(branchCwd));
  const branches = useMemo(
    () => dedupeRemoteBranchesWithLocalMatches(branchesQuery.data?.branches ?? []),
    [branchesQuery.data?.branches],
  );
  const currentGitBranch = branches.find((branch) => branch.current)?.name ?? null;
  const canonicalActiveBranch = resolveBranchToolbarValue({
    envMode: effectiveEnvMode,
    activeWorktreePath,
    activeThreadBranch,
    currentGitBranch,
  });
  const branchNames = useMemo(() => branches.map((branch) => branch.name), [branches]);
  const branchByName = useMemo(
    () => new Map(branches.map((branch) => [branch.name, branch] as const)),
    [branches],
  );
  const trimmedBranchQuery = branchQuery.trim();
  const normalizedBranchQuery = trimmedBranchQuery.toLowerCase();
  const canCreateBranch = effectiveEnvMode === "local" && trimmedBranchQuery.length > 0;
  const hasExactBranchMatch = branchByName.has(trimmedBranchQuery);
  const createBranchItemValue = canCreateBranch
    ? `__create_new_branch__:${trimmedBranchQuery}`
    : null;
  const branchPickerItems = useMemo(
    () =>
      createBranchItemValue && !hasExactBranchMatch
        ? [...branchNames, createBranchItemValue]
        : branchNames,
    [branchNames, createBranchItemValue, hasExactBranchMatch],
  );
  const filteredBranchPickerItems = useMemo(
    () =>
      normalizedBranchQuery.length === 0
        ? branchPickerItems
        : branchPickerItems.filter((itemValue) => {
            if (createBranchItemValue && itemValue === createBranchItemValue) return true;
            return itemValue.toLowerCase().includes(normalizedBranchQuery);
          }),
    [branchPickerItems, createBranchItemValue, normalizedBranchQuery],
  );
  const [resolvedActiveBranch, setOptimisticBranch] = useOptimistic(
    canonicalActiveBranch,
    (_currentBranch: string | null, optimisticBranch: string | null) => optimisticBranch,
  );
  const [isBranchActionPending, startBranchActionTransition] = useTransition();

  const runBranchAction = (action: () => Promise<void>) => {
    startBranchActionTransition(async () => {
      await action().catch(() => undefined);
      await invalidateGitQueries(queryClient).catch(() => undefined);
    });
  };

  const selectBranch = (branch: GitBranch) => {
    const api = readNativeApi();
    if (!api || !branchCwd || isBranchActionPending) return;

    // In new-worktree mode, selecting a branch sets the base branch.
    if (effectiveEnvMode === "worktree" && !envLocked && !activeWorktreePath) {
      onSetThreadBranch(branch.name, null);
      setIsBranchMenuOpen(false);
      onComposerFocusRequest?.();
      return;
    }

    // If the branch already lives in a worktree, point the thread there.
    if (branch.worktreePath) {
      const isMainWorktree = branch.worktreePath === activeProjectCwd;
      onSetThreadBranch(branch.name, isMainWorktree ? null : branch.worktreePath);
      setIsBranchMenuOpen(false);
      onComposerFocusRequest?.();
      return;
    }

    const selectedBranchName = branch.isRemote
      ? deriveLocalBranchNameFromRemoteRef(branch.name)
      : branch.name;

    setIsBranchMenuOpen(false);
    onComposerFocusRequest?.();

    runBranchAction(async () => {
      setOptimisticBranch(selectedBranchName);
      try {
        await api.git.checkout({ cwd: branchCwd, branch: branch.name });
        await invalidateGitQueries(queryClient);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to checkout branch.",
          description: toBranchActionErrorMessage(error),
        });
        return;
      }

      let nextBranchName = selectedBranchName;
      if (branch.isRemote) {
        const status = await api.git.status({ cwd: branchCwd }).catch(() => null);
        if (status?.branch) {
          nextBranchName = status.branch;
        }
      }

      setOptimisticBranch(nextBranchName);
      onSetThreadBranch(nextBranchName, activeWorktreePath);
    });
  };

  const createBranch = (rawName: string) => {
    const name = rawName.trim();
    const api = readNativeApi();
    if (!api || !branchCwd || !name || isBranchActionPending) return;

    setIsBranchMenuOpen(false);
    onComposerFocusRequest?.();

    runBranchAction(async () => {
      setOptimisticBranch(name);

      try {
        await api.git.createBranch({ cwd: branchCwd, branch: name });
        try {
          await api.git.checkout({ cwd: branchCwd, branch: name });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to checkout branch.",
            description: toBranchActionErrorMessage(error),
          });
          return;
        }
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to create branch.",
          description: toBranchActionErrorMessage(error),
        });
        return;
      }

      setOptimisticBranch(name);
      onSetThreadBranch(name, activeWorktreePath);
      setBranchQuery("");
    });
  };

  useEffect(() => {
    if (
      effectiveEnvMode !== "worktree" ||
      activeWorktreePath ||
      activeThreadBranch ||
      !currentGitBranch
    ) {
      return;
    }
    onSetThreadBranch(currentGitBranch, null);
  }, [
    activeThreadBranch,
    activeWorktreePath,
    currentGitBranch,
    effectiveEnvMode,
    onSetThreadBranch,
  ]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsBranchMenuOpen(open);
      if (!open) {
        setBranchQuery("");
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: gitQueryKeys.branches(branchCwd),
      });
    },
    [branchCwd, queryClient],
  );

  const branchListScrollElementRef = useRef<HTMLDivElement | null>(null);
  const branchListVirtualizer = useVirtualizer({
    count: filteredBranchPickerItems.length,
    estimateSize: () => 44,
    getScrollElement: () => branchListScrollElementRef.current,
    overscan: 12,
    enabled: isBranchMenuOpen,
    initialRect: {
      height: 224,
      width: 0,
    },
  });
  const virtualBranchRows = branchListVirtualizer.getVirtualItems();
  const setBranchListRef = useCallback(
    (element: HTMLDivElement | null) => {
      branchListScrollElementRef.current =
        (element?.parentElement as HTMLDivElement | null) ?? null;
      if (element) {
        branchListVirtualizer.measure();
      }
    },
    [branchListVirtualizer],
  );

  useEffect(() => {
    if (!isBranchMenuOpen) return;
    queueMicrotask(() => {
      branchListVirtualizer.measure();
    });
  }, [branchListVirtualizer, filteredBranchPickerItems.length, isBranchMenuOpen]);

  const triggerLabel = getBranchTriggerLabel({
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch,
  });

  return (
    <Combobox
      items={branchPickerItems}
      filteredItems={filteredBranchPickerItems}
      autoHighlight
      virtualized
      onItemHighlighted={(_value, eventDetails) => {
        if (!isBranchMenuOpen || eventDetails.index < 0) return;
        branchListVirtualizer.scrollToIndex(eventDetails.index, { align: "auto" });
      }}
      onOpenChange={handleOpenChange}
      open={isBranchMenuOpen}
      value={resolvedActiveBranch}
    >
      <ComboboxTrigger
        render={
          <Button
            variant="toolbar"
            size="toolbar"
            className="min-w-[10.5rem] justify-between px-3 text-xs font-medium"
          />
        }
        disabled={branchesQuery.isLoading || isBranchActionPending}
      >
        <span className="flex min-w-0 items-center gap-2">
          <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="max-w-[240px] truncate">{triggerLabel}</span>
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform data-[popup-open]:rotate-180 data-[popup-open]:text-foreground/80" />
      </ComboboxTrigger>
      <ComboboxPopup
        align="end"
        side="top"
        className="w-[26rem] overflow-hidden rounded border-foreground/10 bg-background/98 p-0 shadow-[0_24px_80px_-28px_rgba(0,0,0,0.75)] before:hidden"
      >
        <div className="border-b border-foreground/10 p-2">
          <ComboboxInput
            className="[&_input]:font-sans rounded"
            inputClassName="rounded border-foreground/10 bg-foreground/4 text-sm shadow-none before:hidden hover:bg-foreground/6 focus-visible:bg-foreground/6 [&_input]:text-xs [&_input::placeholder]:text-muted-foreground/60"
            placeholder="Search branches..."
            showTrigger={false}
            startAddon={<SearchIcon className="size-4 text-muted-foreground/70" />}
            size="sm"
            value={branchQuery}
            onChange={(event) => setBranchQuery(event.target.value)}
          />
        </div>
        <div className="px-4 pb-0 pt-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/75">
          {normalizedBranchQuery.length > 0 ? "Matching branches" : "Recent branches"}
        </div>
        <ComboboxEmpty className="px-4 pt-1 text-left text-sm text-muted-foreground/75">
          No branches found.
        </ComboboxEmpty>

        <ComboboxList ref={setBranchListRef} className="max-h-72 px-2 pb-2 pt-0">
          <div
            className="relative -mt-0.5"
            style={{
              height: `${branchListVirtualizer.getTotalSize()}px`,
            }}
          >
            {virtualBranchRows.map((virtualRow) => {
              const itemValue = filteredBranchPickerItems[virtualRow.index];
              if (!itemValue) return null;
              if (createBranchItemValue && itemValue === createBranchItemValue) {
                return (
                  <ComboboxItem
                    hideIndicator
                  key={itemValue}
                  index={virtualRow.index}
                  value={itemValue}
                  className="min-h-11 rounded px-3 py-2.5 text-sm font-medium text-foreground/85 data-highlighted:bg-foreground/5 data-highlighted:text-foreground"
                  style={{
                    position: "absolute",
                    top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    onClick={() => createBranch(trimmedBranchQuery)}
                  >
                    <div className="flex w-full items-center gap-3">
                      <GitBranchIcon className="size-4 shrink-0 text-primary" />
                      <span className="truncate">Create new branch "{trimmedBranchQuery}"</span>
                    </div>
                  </ComboboxItem>
                );
              }

              const branch = branchByName.get(itemValue);
              if (!branch) return null;

              const hasSecondaryWorktree =
                branch.worktreePath && branch.worktreePath !== activeProjectCwd;
              const badge = branch.current
                ? "current"
                : hasSecondaryWorktree
                  ? "worktree"
                  : branch.isRemote
                    ? "remote"
                    : branch.isDefault
                      ? "default"
                      : null;
              const isSelected = itemValue === resolvedActiveBranch;
              return (
                <ComboboxItem
                  hideIndicator
                  key={itemValue}
                  index={virtualRow.index}
                  value={itemValue}
                  className={isSelected
                    ? "min-h-11 rounded bg-primary/14 px-3 py-2.5 text-sm font-medium text-primary data-highlighted:bg-primary/14 data-highlighted:text-primary"
                    : "min-h-11 rounded px-3 py-2.5 text-sm font-medium text-foreground/72 data-highlighted:bg-foreground/5 data-highlighted:text-foreground"
                  }
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() => selectBranch(branch)}
                >
                  <div className="flex w-full items-center gap-3">
                    <GitBranchIcon
                      className={
                        isSelected ? "size-4 shrink-0 text-primary" : "size-4 shrink-0 text-muted-foreground/55"
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{itemValue}</span>
                    {isSelected ? <CheckIcon className="size-4 shrink-0 text-primary" /> : null}
                    {!isSelected && badge ? (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/38">
                        {badge}
                      </span>
                    ) : null}
                  </div>
                </ComboboxItem>
              );
            })}
          </div>
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
