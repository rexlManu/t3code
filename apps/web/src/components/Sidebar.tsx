import {
  Columns2Icon,
  CopyIcon,
  FolderIcon,
  FolderOpenIcon,
  GitPullRequestIcon,
  MailIcon,
  PlusIcon,
  RocketIcon,
  SquarePenIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { type MouseEvent, type MutableRefObject, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type DesktopUpdateState,
  ProjectId,
  ThreadId,
  type GitStatusResult,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useAppSettings } from "../appSettings";
import { isElectron } from "../env";
import { APP_STAGE_LABEL } from "../branding";
import { cn, newCommandId, newProjectId } from "../lib/utils";
import {
  selectProjectById,
  selectProjectIdForThread,
  selectSortedThreadIdsForProject,
  selectThreadById,
  selectThreadGitTargets,
  selectThreadSidebarSummaryById,
  useStore,
} from "../store";
import { isChatNewLocalShortcut, isChatNewShortcut, shortcutLabelForCommand } from "../keybindings";
import { gitRemoveWorktreeMutationOptions, gitStatusQueryOptions } from "../lib/gitReactQuery";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { type DraftThreadEnvMode, useComposerDraftStore } from "../composerDraftStore";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useProjectNavigation } from "../hooks/useProjectNavigation";
import { getTerminalStatusIndicator, getThreadStatusPill } from "../lib/threadStatus";
import { copyTextToClipboard } from "../lib/clipboard";
import { toastManager } from "./ui/toast";
import {
  AlertDialog,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldHighlightDesktopUpdateError,
  shouldShowArm64IntelBuildWarning,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarContextMenu,
  type SidebarContextMenuEntry,
} from "./SidebarContextMenu";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  SidebarTrigger,
} from "./ui/sidebar";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { isNonEmpty as isNonEmptyString } from "effect/String";
import { stripDiffSearchParams } from "../diffRouteSearch";
import {
  MAX_SPLIT_PANES,
  appendSplitPane,
  buildPaneIds,
  parseSplitViewRouteSearch,
  removeSplitPane,
  stripSplitSearchParams,
} from "../splitViewRouteSearch";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const THREAD_PREVIEW_LIMIT = 6;

type ThreadContextMenuAction =
  | "rename"
  | "mark-unread"
  | "open-in-split"
  | "copy-thread-id"
  | "delete";
type ProjectContextMenuAction = "delete";
type SidebarMenuAction = ThreadContextMenuAction | ProjectContextMenuAction;

type SidebarContextMenuState =
  | {
      kind: "thread";
      id: ThreadId;
      position: { x: number; y: number };
    }
  | {
      kind: "project";
      id: ProjectId;
      position: { x: number; y: number };
    };

type DeleteDialogState =
  | {
      kind: "thread";
      threadId: ThreadId;
      threadTitle: string;
      canDeleteWorktree: boolean;
      worktreeDisplayPath: string | null;
    }
  | {
      kind: "project";
      projectId: ProjectId;
      projectName: string;
    };

const THREAD_CONTEXT_MENU_ENTRIES: readonly SidebarContextMenuEntry<ThreadContextMenuAction>[] = [
  { type: "section", label: "Actions" },
  { type: "item", id: "rename", label: "Rename thread", icon: SquarePenIcon },
  { type: "item", id: "mark-unread", label: "Mark as unread", icon: MailIcon },
  { type: "section", label: "View & share" },
  { type: "item", id: "open-in-split", label: "Open in split view", icon: Columns2Icon },
  { type: "item", id: "copy-thread-id", label: "Copy thread ID", icon: CopyIcon },
  { type: "section", label: "More" },
  { type: "item", id: "delete", label: "Delete", icon: Trash2Icon },
];

const PROJECT_CONTEXT_MENU_ENTRIES: readonly SidebarContextMenuEntry<ProjectContextMenuAction>[] = [
  { type: "section", label: "More" },
  { type: "item", id: "delete", label: "Delete", icon: Trash2Icon },
];

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface PrStatusIndicator {
  label: "PR open" | "PR closed" | "PR merged";
  colorClass: string;
  tooltip: string;
  url: string;
}

type ThreadPr = GitStatusResult["pr"];

function prStatusIndicator(pr: ThreadPr): PrStatusIndicator | null {
  if (!pr) return null;

  if (pr.state === "open") {
    return {
      label: "PR open",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      tooltip: `#${pr.number} PR open: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "closed") {
    return {
      label: "PR closed",
      colorClass: "text-zinc-500 dark:text-zinc-400/80",
      tooltip: `#${pr.number} PR closed: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "merged") {
    return {
      label: "PR merged",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      tooltip: `#${pr.number} PR merged: ${pr.title}`,
      url: pr.url,
    };
  }
  return null;
}

function T3Wordmark() {
  return (
    <svg
      aria-label="T3"
      className="h-2.5 w-auto shrink-0 text-foreground"
      viewBox="15.5309 37 94.3941 56.96"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"
        fill="currentColor"
      />
    </svg>
  );
}

const SidebarThreadRow = memo(function SidebarThreadRow(props: {
  threadId: ThreadId;
  isActive: boolean;
  isRenaming: boolean;
  renamingTitle: string;
  renamingInputRef: MutableRefObject<HTMLInputElement | null>;
  renamingCommittedRef: MutableRefObject<boolean>;
  setRenamingTitle: (value: string) => void;
  commitRename: (threadId: ThreadId, nextTitle: string, previousTitle: string) => Promise<void>;
  cancelRename: () => void;
  openThreadContextMenu: (threadId: ThreadId, position: { x: number; y: number }) => void;
  openPrLink: (event: MouseEvent<HTMLElement>, prUrl: string) => void;
  handleOpenInSplitView: (threadId: ThreadId) => void;
  navigateToSingleThread: (threadId: ThreadId) => void;
  pr: ThreadPr;
}) {
  const thread = useStore((state) => selectThreadSidebarSummaryById(state, props.threadId));
  const runningTerminalIds = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, props.threadId).runningTerminalIds,
  );

  if (!thread) {
    return null;
  }

  const threadStatus = getThreadStatusPill(thread);
  const prStatus = prStatusIndicator(props.pr);
  const terminalStatus = getTerminalStatusIndicator(runningTerminalIds);

  return (
    <SidebarMenuSubItem className="w-full">
      <SidebarMenuSubButton
        render={<div role="button" tabIndex={0} />}
        size="sm"
        isActive={props.isActive}
        className={`group/thread-row h-auto min-h-7 w-full translate-x-0 cursor-default justify-start rounded px-2 py-1.5 text-left transition-colors ${
          props.isActive
            ? "bg-accent/70 text-foreground font-medium"
            : "text-muted-foreground/90 hover:bg-accent/55 hover:text-foreground"
        }`}
        onClick={() => {
          props.navigateToSingleThread(thread.id);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          props.navigateToSingleThread(thread.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          props.openThreadContextMenu(thread.id, {
            x: event.clientX,
            y: event.clientY,
          });
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {prStatus ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={prStatus.tooltip}
                    className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                    onClick={(event) => {
                      props.openPrLink(event, prStatus.url);
                    }}
                  >
                    <GitPullRequestIcon className="size-3" />
                  </button>
                }
              />
              <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
            </Tooltip>
          ) : null}
          {threadStatus ? (
            <span className={`inline-flex items-center gap-1 text-[10px] ${threadStatus.colorClass}`}>
              <span
                className={`h-1.5 w-1.5 rounded-full ${threadStatus.dotClass} ${
                  threadStatus.pulse ? "animate-pulse" : ""
                }`}
              />
              <span className="hidden md:inline">{threadStatus.label}</span>
            </span>
          ) : null}
          {props.isRenaming ? (
            <input
              ref={(element) => {
                if (element && props.renamingInputRef.current !== element) {
                  props.renamingInputRef.current = element;
                  element.focus();
                  element.select();
                }
              }}
              className="min-w-0 flex-1 truncate border border-ring bg-transparent px-0.5 text-xs outline-none"
              value={props.renamingTitle}
              onChange={(event) => props.setRenamingTitle(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  props.renamingCommittedRef.current = true;
                  void props.commitRename(thread.id, props.renamingTitle, thread.title);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  props.renamingCommittedRef.current = true;
                  props.cancelRename();
                }
              }}
              onBlur={() => {
                if (!props.renamingCommittedRef.current) {
                  void props.commitRename(thread.id, props.renamingTitle, thread.title);
                }
              }}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs">{thread.title}</span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          {terminalStatus ? (
            <span
              role="img"
              aria-label={terminalStatus.label}
              title={terminalStatus.label}
              className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
            >
              <TerminalIcon className={`size-3 ${terminalStatus.pulse ? "animate-pulse" : ""}`} />
            </span>
          ) : null}
          <button
            type="button"
            aria-label={`Open ${thread.title} in split view`}
            title="Open in split view"
            className="hidden size-4 items-center justify-center rounded text-muted-foreground/40 hover:bg-accent hover:text-muted-foreground group-hover/thread-row:inline-flex"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.handleOpenInSplitView(thread.id);
            }}
          >
            <Columns2Icon className="size-3" />
          </button>
          <span
            className={`text-[10px] ${
              props.isActive ? "text-foreground/65" : "text-muted-foreground/40"
            }`}
          >
            {formatRelativeTime(thread.createdAt)}
          </span>
        </div>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
});

const SidebarProjectSection = memo(function SidebarProjectSection(props: {
  projectId: ProjectId;
  activeProjectId: ProjectId | null;
  routeThreadId: ThreadId | null;
  renamingThreadId: ThreadId | null;
  renamingTitle: string;
  renamingInputRef: MutableRefObject<HTMLInputElement | null>;
  renamingCommittedRef: MutableRefObject<boolean>;
  setRenamingTitle: (value: string) => void;
  commitRename: (threadId: ThreadId, nextTitle: string, previousTitle: string) => Promise<void>;
  cancelRename: () => void;
  openProjectContextMenu: (projectId: ProjectId, position: { x: number; y: number }) => void;
  openThreadContextMenu: (threadId: ThreadId, position: { x: number; y: number }) => void;
  openPrLink: (event: MouseEvent<HTMLElement>, prUrl: string) => void;
  handleOpenInSplitView: (threadId: ThreadId) => void;
  navigateToSingleThread: (threadId: ThreadId, options?: { replace?: boolean }) => void;
  handleNewThread: (
    projectId: ProjectId,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
    },
  ) => Promise<void>;
  toggleProject: (projectId: ProjectId) => void;
  newThreadShortcutLabel: string | null;
  expandedThreadListsByProject: ReadonlySet<ProjectId>;
  expandThreadListForProject: (projectId: ProjectId) => void;
  collapseThreadListForProject: (projectId: ProjectId) => void;
  prByThreadId: ReadonlyMap<ThreadId, ThreadPr>;
}) {
  const project = useStore((state) => selectProjectById(state, props.projectId));
  const threadIds = useStore((state) => selectSortedThreadIdsForProject(state, props.projectId));

  if (!project) {
    return null;
  }

  const isThreadListExpanded = props.expandedThreadListsByProject.has(project.id);
  const hasHiddenThreads = threadIds.length > THREAD_PREVIEW_LIMIT;
  const visibleThreadIds =
    hasHiddenThreads && !isThreadListExpanded
      ? threadIds.slice(0, THREAD_PREVIEW_LIMIT)
      : threadIds;
  const isProjectActive = props.activeProjectId === project.id || project.expanded;
  const ProjectFolderIcon = project.expanded ? FolderOpenIcon : FolderIcon;

  return (
    <Collapsible
      className="group/collapsible"
      open={project.expanded}
      onOpenChange={(open) => {
        if (open === project.expanded) return;
        props.toggleProject(project.id);
      }}
    >
      <SidebarMenuItem>
        <div className="group/project-header relative">
          <CollapsibleTrigger
            render={
              <SidebarMenuButton
                size="sm"
                className={cn(
                  "rounded gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-accent/80 hover:text-foreground group-hover/project-header:bg-accent/80 group-hover/project-header:text-foreground",
                  isProjectActive &&
                    "bg-primary/14 text-primary hover:bg-primary/16 hover:text-primary group-hover/project-header:bg-primary/16 group-hover/project-header:text-primary",
                )}
              />
            }
            onContextMenu={(event) => {
              event.preventDefault();
              props.openProjectContextMenu(project.id, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            <ProjectFolderIcon
              className={cn(
                "size-4 shrink-0 transition-colors",
                isProjectActive ? "text-primary" : "text-muted-foreground/70",
              )}
            />
            <span
              className={cn(
                "flex-1 truncate text-xs font-medium transition-colors",
                isProjectActive ? "text-primary" : "text-muted-foreground/70",
              )}
            >
              {project.name}
            </span>
          </CollapsibleTrigger>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`Create new thread in ${project.name}`}
                  className={cn(
                    "absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded opacity-0 transition-all duration-150 group-hover/project-header:opacity-100 focus-visible:opacity-100",
                    isProjectActive
                      ? "text-primary/80 hover:bg-primary/10 hover:text-primary"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground/80",
                  )}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void props.handleNewThread(project.id);
                  }}
                >
                  <SquarePenIcon className="size-3.5" />
                </button>
              }
            />
            <TooltipPopup side="top">
              {props.newThreadShortcutLabel
                ? `New thread (${props.newThreadShortcutLabel})`
                : "New thread"}
            </TooltipPopup>
          </Tooltip>
        </div>

        <CollapsibleContent>
          <SidebarMenuSub className="relative mx-0 my-1.5 w-full translate-x-0 gap-1 border-l-0 px-0 py-0 pl-7 before:absolute before:top-0 before:bottom-2 before:left-[1.125rem] before:w-px before:bg-border/60 before:content-['']">
            {visibleThreadIds.map((threadId) => (
              <SidebarThreadRow
                key={threadId}
                threadId={threadId}
                isActive={props.routeThreadId === threadId}
                isRenaming={props.renamingThreadId === threadId}
                renamingTitle={props.renamingTitle}
                renamingInputRef={props.renamingInputRef}
                renamingCommittedRef={props.renamingCommittedRef}
                setRenamingTitle={props.setRenamingTitle}
                commitRename={props.commitRename}
                cancelRename={props.cancelRename}
                openThreadContextMenu={props.openThreadContextMenu}
                openPrLink={props.openPrLink}
                handleOpenInSplitView={props.handleOpenInSplitView}
                navigateToSingleThread={props.navigateToSingleThread}
                pr={props.prByThreadId.get(threadId) ?? null}
              />
            ))}

            {hasHiddenThreads && !isThreadListExpanded && (
              <SidebarMenuSubItem className="w-full">
                <SidebarMenuSubButton
                  render={<button type="button" />}
                  size="sm"
                  className="h-6 w-full translate-x-0 justify-start rounded px-2 text-left text-[10px] text-muted-foreground/60 transition-colors hover:bg-accent/55 hover:text-foreground/80"
                  onClick={() => {
                    props.expandThreadListForProject(project.id);
                  }}
                >
                  <span>Show more</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
            {hasHiddenThreads && isThreadListExpanded && (
              <SidebarMenuSubItem className="w-full">
                <SidebarMenuSubButton
                  render={<button type="button" />}
                  size="sm"
                  className="h-6 w-full translate-x-0 justify-start rounded px-2 text-left text-[10px] text-muted-foreground/60 transition-colors hover:bg-accent/55 hover:text-foreground/80"
                  onClick={() => {
                    props.collapseThreadListForProject(project.id);
                  }}
                >
                  <span>Show less</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
});

export default function Sidebar() {
  const projects = useStore((store) => store.projects);
  const threadGitTargets = useStore((state) => selectThreadGitTargets(state));
  const markThreadUnread = useStore((store) => store.markThreadUnread);
  const toggleProject = useStore((store) => store.toggleProject);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearThreadDraft);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const { createOrFocusDraftThread } = useProjectNavigation();
  const navigate = useNavigate();
  const currentSearch = useSearch({ strict: false });
  const currentSplitParam = parseSplitViewRouteSearch(currentSearch as Record<string, unknown>).split;
  const { settings: appSettings } = useAppSettings();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const handleOpenInSplitView = useCallback(
    (splitThreadId: ThreadId) => {
      if (!routeThreadId) {
        void navigate({ to: "/$threadId", params: { threadId: splitThreadId } });
        return;
      }
      if (splitThreadId === routeThreadId) return;

      const newSplitParam = appendSplitPane(
        routeThreadId,
        currentSplitParam,
        splitThreadId,
        MAX_SPLIT_PANES,
      );

      void navigate({
        to: "/$threadId",
        params: { threadId: routeThreadId },
        search: (previous) => ({
          ...previous,
          ...(newSplitParam ? { split: newSplitParam } : {}),
        }),
      });
    },
    [currentSplitParam, navigate, routeThreadId],
  );
  const navigateToSingleThread = useCallback(
    (nextThreadId: ThreadId, options?: { replace?: boolean }) => {
      void navigate({
        to: "/$threadId",
        params: { threadId: nextThreadId },
        ...(options?.replace ? { replace: true } : {}),
        search: (previous) => stripSplitSearchParams(stripDiffSearchParams(previous)),
      });
    },
    [navigate],
  );
  const { data: keybindings = EMPTY_KEYBINDINGS } = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.keybindings,
  });
  const queryClient = useQueryClient();
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));
  const [addProjectDialogOpen, setAddProjectDialogOpen] = useState(false);
  const [newCwd, setNewCwd] = useState("");
  const [contextMenuState, setContextMenuState] = useState<SidebarContextMenuState | null>(null);
  const [deleteDialogState, setDeleteDialogState] = useState<DeleteDialogState | null>(null);
  const [deleteDialogDeleteWorktree, setDeleteDialogDeleteWorktree] = useState(false);
  const [deleteDialogSubmitting, setDeleteDialogSubmitting] = useState(false);
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<ProjectId>
  >(() => new Set());
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const getCurrentStoreState = useCallback(() => useStore.getState(), []);
  const projectCwdById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cwd] as const)),
    [projects],
  );
  const threadGitStatusTargets = useMemo(
    () =>
      threadGitTargets.map((thread) => ({
        threadId: thread.threadId,
        branch: thread.branch,
        cwd: thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null,
      })),
    [projectCwdById, threadGitTargets],
  );
  const threadGitStatusCwds = useMemo(
    () => [
      ...new Set(
        threadGitStatusTargets
          .filter((target) => target.branch !== null)
          .map((target) => target.cwd)
          .filter((cwd): cwd is string => cwd !== null),
      ),
    ],
    [threadGitStatusTargets],
  );
  const threadGitStatusQueries = useQueries({
    queries: threadGitStatusCwds.map((cwd) => ({
      ...gitStatusQueryOptions(cwd),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  const prByThreadId = useMemo(() => {
    const statusByCwd = new Map<string, GitStatusResult>();
    for (let index = 0; index < threadGitStatusCwds.length; index += 1) {
      const cwd = threadGitStatusCwds[index];
      if (!cwd) continue;
      const status = threadGitStatusQueries[index]?.data;
      if (status) {
        statusByCwd.set(cwd, status);
      }
    }

    const map = new Map<ThreadId, ThreadPr>();
    for (const target of threadGitStatusTargets) {
      const status = target.cwd ? statusByCwd.get(target.cwd) : undefined;
      const branchMatches =
        target.branch !== null && status?.branch !== null && status?.branch === target.branch;
      map.set(target.threadId, branchMatches ? (status?.pr ?? null) : null);
    }
    return map;
  }, [threadGitStatusCwds, threadGitStatusQueries, threadGitStatusTargets]);

  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, []);

  const handleNewThread = useCallback(
    (
      projectId: ProjectId,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
      },
    ): Promise<void> => createOrFocusDraftThread(projectId, options),
    [createOrFocusDraftThread],
  );

  const focusMostRecentThreadForProject = useCallback(
    (projectId: ProjectId) => {
      const latestThreadId = selectSortedThreadIdsForProject(getCurrentStoreState(), projectId)[0];
      if (!latestThreadId) return;
      navigateToSingleThread(latestThreadId);
    },
    [getCurrentStoreState, navigateToSingleThread],
  );

  const addProjectFromPath = useCallback(
    async (rawCwd: string) => {
      const cwd = rawCwd.trim();
      if (!cwd || isAddingProject) return;
      const api = readNativeApi();
      if (!api) return;

      setIsAddingProject(true);
      const finishAddingProject = () => {
        setIsAddingProject(false);
        setNewCwd("");
        setAddProjectDialogOpen(false);
      };

      const existing = projects.find((project) => project.cwd === cwd);
      if (existing) {
        focusMostRecentThreadForProject(existing.id);
        finishAddingProject();
        return;
      }

      const projectId = newProjectId();
      const createdAt = new Date().toISOString();
      const title = cwd.split(/[/\\]/).findLast(isNonEmptyString) ?? cwd;
      try {
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot: cwd,
          defaultModel: DEFAULT_MODEL_BY_PROVIDER.codex,
          createdAt,
        });
        await handleNewThread(projectId).catch(() => undefined);
      } catch (error) {
        setIsAddingProject(false);
        toastManager.add({
          type: "error",
          title: "Unable to add project",
          description:
            error instanceof Error ? error.message : "An error occurred while adding the project.",
        });
        return;
      }
      finishAddingProject();
    },
    [focusMostRecentThreadForProject, handleNewThread, isAddingProject, projects],
  );

  const handleAddProject = () => {
    void addProjectFromPath(newCwd);
  };

  const handlePickFolder = async () => {
    const api = readNativeApi();
    if (!api || isPickingFolder) return;
    setIsPickingFolder(true);
    let pickedPath: string | null = null;
    try {
      pickedPath = await api.dialogs.pickFolder();
    } catch {
      // Ignore picker failures and leave the current thread selection unchanged.
    }
    if (pickedPath) {
      await addProjectFromPath(pickedPath);
    }
    setIsPickingFolder(false);
  };

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (threadId: ThreadId, newTitle: string, originalTitle: string) => {
      const finishRename = () => {
        setRenamingThreadId((current) => {
          if (current !== threadId) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readNativeApi();
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      finishRename();
    },
    [],
  );

  const closeDeleteDialog = useCallback(() => {
    if (deleteDialogSubmitting) return;
    setDeleteDialogState(null);
    setDeleteDialogDeleteWorktree(false);
  }, [deleteDialogSubmitting]);

  const performThreadDelete = useCallback(
    async (threadId: ThreadId, options?: { deleteWorktree?: boolean }) => {
      const api = readNativeApi();
      if (!api) return false;

      const currentState = getCurrentStoreState();
      const thread = selectThreadById(currentState, threadId);
      if (!thread) return true;

      const threadProject = selectProjectById(currentState, thread.projectId);
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(currentState.threads, threadId);
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const shouldDeleteWorktree =
        options?.deleteWorktree === true &&
        orphanedWorktreePath !== null &&
        threadProject !== undefined;

      if (thread.session && thread.session.status !== "closed") {
        await api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }

      try {
        await api.terminal.close({
          threadId,
          deleteHistory: true,
        });
      } catch {
        // Terminal may already be closed
      }

      const visiblePaneIds = routeThreadId
        ? buildPaneIds(routeThreadId, currentSplitParam, MAX_SPLIT_PANES)
        : [];
      const shouldNavigateToFallback = visiblePaneIds.includes(threadId);
      const fallbackThreadId = currentState.threads.find((entry) => entry.id !== threadId)?.id ?? null;

      try {
        await api.orchestration.dispatchCommand({
          type: "thread.delete",
          commandId: newCommandId(),
          threadId,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: `Failed to delete "${thread.title}"`,
          description: error instanceof Error ? error.message : "An error occurred.",
        });
        return false;
      }

      clearComposerDraftForThread(threadId);
      clearProjectDraftThreadById(thread.projectId, thread.id);
      clearTerminalState(threadId);
      if (shouldNavigateToFallback) {
        const nextSplitRoute =
          routeThreadId !== null ? removeSplitPane(routeThreadId, currentSplitParam, threadId) : null;
        if (nextSplitRoute && nextSplitRoute.primaryId !== threadId) {
          void navigate({
            to: "/$threadId",
            params: { threadId: nextSplitRoute.primaryId },
            replace: true,
            search: (previous) => {
              const base =
                nextSplitRoute.primaryId === routeThreadId
                  ? stripSplitSearchParams(previous)
                  : stripSplitSearchParams(stripDiffSearchParams(previous));
              return nextSplitRoute.splitParam ? { ...base, split: nextSplitRoute.splitParam } : base;
            },
          });
        } else if (fallbackThreadId) {
          navigateToSingleThread(fallbackThreadId, { replace: true });
        } else {
          void navigate({ to: "/", replace: true });
        }
      }

      if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
        return true;
      }

      try {
        await removeWorktreeMutation.mutateAsync({
          cwd: threadProject.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after thread deletion", {
          threadId,
          projectCwd: threadProject.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add({
          type: "error",
          title: "Thread deleted, but worktree removal failed",
          description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
        });
      }

      return true;
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalState,
      currentSplitParam,
      getCurrentStoreState,
      navigate,
      navigateToSingleThread,
      removeWorktreeMutation,
      routeThreadId,
    ],
  );

  const performProjectDelete = useCallback(
    async (projectId: ProjectId) => {
      const api = readNativeApi();
      if (!api) return false;

      const project = selectProjectById(getCurrentStoreState(), projectId);
      if (!project) return true;

      try {
        const projectDraftThread = getDraftThreadByProjectId(projectId);
        if (projectDraftThread) {
          clearComposerDraftForThread(projectDraftThread.threadId);
        }
        clearProjectDraftThreadId(projectId);
        await api.orchestration.dispatchCommand({
          type: "project.delete",
          commandId: newCommandId(),
          projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error deleting project.";
        console.error("Failed to remove project", { projectId, error });
        toastManager.add({
          type: "error",
          title: `Failed to delete "${project.name}"`,
          description: message,
        });
        return false;
      }

      return true;
    },
    [clearComposerDraftForThread, clearProjectDraftThreadId, getCurrentStoreState, getDraftThreadByProjectId],
  );

  const handleDeleteDialogConfirm = useCallback(async () => {
    if (!deleteDialogState || deleteDialogSubmitting) return;

    setDeleteDialogSubmitting(true);
    try {
      const didDelete =
        deleteDialogState.kind === "thread"
          ? await performThreadDelete(deleteDialogState.threadId, {
              deleteWorktree:
                deleteDialogState.canDeleteWorktree && deleteDialogDeleteWorktree,
            })
          : await performProjectDelete(deleteDialogState.projectId);

      if (didDelete) {
        setDeleteDialogState(null);
        setDeleteDialogDeleteWorktree(false);
      }
    } finally {
      setDeleteDialogSubmitting(false);
    }
  }, [
    deleteDialogDeleteWorktree,
    deleteDialogState,
    deleteDialogSubmitting,
    performProjectDelete,
    performThreadDelete,
  ]);

  const handleThreadContextMenuAction = useCallback(
    async (threadId: ThreadId, clicked: ThreadContextMenuAction) => {
      const api = readNativeApi();
      if (!api) return;
      const currentState = getCurrentStoreState();
      const thread = selectThreadById(currentState, threadId);
      if (!thread) return;

      if (clicked === "rename") {
        setRenamingThreadId(threadId);
        setRenamingTitle(thread.title);
        renamingCommittedRef.current = false;
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadId);
        return;
      }
      if (clicked === "open-in-split") {
        handleOpenInSplitView(threadId);
        return;
      }
      if (clicked === "copy-thread-id") {
        try {
          await copyTextToClipboard(threadId);
          toastManager.add({
            type: "success",
            title: "Thread ID copied",
            description: threadId,
          });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to copy thread ID",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }
      if (clicked !== "delete") return;

      const threadProject = selectProjectById(currentState, thread.projectId);
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(currentState.threads, threadId);
      const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;

      if (!appSettings.confirmThreadDelete && !canDeleteWorktree) {
        void performThreadDelete(threadId);
        return;
      }

      setDeleteDialogDeleteWorktree(false);
      setDeleteDialogState({
        kind: "thread",
        threadId,
        threadTitle: thread.title,
        canDeleteWorktree,
        worktreeDisplayPath: orphanedWorktreePath
          ? formatWorktreePathForDisplay(orphanedWorktreePath)
          : null,
      });
    },
    [
      appSettings.confirmThreadDelete,
      getCurrentStoreState,
      handleOpenInSplitView,
      markThreadUnread,
      performThreadDelete,
    ],
  );

  const handleProjectContextMenuAction = useCallback(
    async (projectId: ProjectId, clicked: ProjectContextMenuAction) => {
      if (clicked !== "delete") return;

      const currentState = getCurrentStoreState();
      const project = selectProjectById(currentState, projectId);
      if (!project) return;

      const projectThreads = selectSortedThreadIdsForProject(currentState, projectId);
      if (projectThreads.length > 0) {
        toastManager.add({
          type: "warning",
          title: "Project is not empty",
          description: "Delete all threads in this project before deleting it.",
        });
        return;
      }

      setDeleteDialogDeleteWorktree(false);
      setDeleteDialogState({
        kind: "project",
        projectId,
        projectName: project.name,
      });
    },
    [getCurrentStoreState],
  );

  const openThreadContextMenu = useCallback(
    (threadId: ThreadId, position: { x: number; y: number }) => {
      const thread = selectThreadById(getCurrentStoreState(), threadId);
      if (!thread) return;
      setContextMenuState({
        kind: "thread",
        id: threadId,
        position,
      });
    },
    [getCurrentStoreState],
  );

  const openProjectContextMenu = useCallback(
    (projectId: ProjectId, position: { x: number; y: number }) => {
      const project = projects.find((entry) => entry.id === projectId);
      if (!project) return;
      setContextMenuState({
        kind: "project",
        id: projectId,
        position,
      });
    },
    [projects],
  );

  const handleSidebarContextMenuOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setContextMenuState(null);
    }
  }, []);

  const handleSidebarContextMenuSelect = useCallback(
    (action: SidebarMenuAction) => {
      const activeMenu = contextMenuState;
      setContextMenuState(null);
      if (!activeMenu) return;

      if (activeMenu.kind === "thread") {
        void handleThreadContextMenuAction(activeMenu.id, action as ThreadContextMenuAction);
        return;
      }

      void handleProjectContextMenuAction(activeMenu.id, action as ProjectContextMenuAction);
    },
    [contextMenuState, handleProjectContextMenuAction, handleThreadContextMenuAction],
  );

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      const activeThread = routeThreadId
        ? selectThreadById(getCurrentStoreState(), routeThreadId)
        : undefined;
      const activeDraftThread = routeThreadId ? getDraftThread(routeThreadId) : null;
      if (isChatNewLocalShortcut(event, keybindings)) {
        const projectId =
          activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
        if (!projectId) return;
        event.preventDefault();
        void handleNewThread(projectId);
        return;
      }

      if (!isChatNewShortcut(event, keybindings)) return;
      const projectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
      if (!projectId) return;
      event.preventDefault();
      void handleNewThread(projectId, {
        branch: activeThread?.branch ?? activeDraftThread?.branch ?? null,
        worktreePath: activeThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
        envMode: activeDraftThread?.envMode ?? (activeThread?.worktreePath ? "worktree" : "local"),
      });
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [getCurrentStoreState, getDraftThread, handleNewThread, keybindings, projects, routeThreadId]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const showDesktopUpdateButton = isElectron && shouldShowDesktopUpdateButton(desktopUpdateState);
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);

  const desktopUpdateTooltip = desktopUpdateState
    ? getDesktopUpdateButtonTooltip(desktopUpdateState)
    : "Update available";
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const desktopUpdateButtonInteractivityClasses = desktopUpdateButtonDisabled
    ? "cursor-not-allowed opacity-60"
    : "hover:bg-accent hover:text-foreground";
  const desktopUpdateButtonClasses =
    desktopUpdateState?.status === "downloaded"
      ? "text-emerald-500"
      : desktopUpdateState?.status === "downloading"
        ? "text-sky-400"
        : shouldHighlightDesktopUpdateError(desktopUpdateState)
          ? "text-rose-500 animate-pulse"
          : "text-amber-500 animate-pulse";
  const newThreadShortcutLabel = useMemo(
    () =>
      shortcutLabelForCommand(keybindings, "chat.newLocal") ??
      shortcutLabelForCommand(keybindings, "chat.new"),
    [keybindings],
  );
  const activeProjectId = useStore((state) => {
    if (!routeThreadId) {
      return null;
    }
    return selectProjectIdForThread(state, routeThreadId) ?? getDraftThread(routeThreadId)?.projectId ?? null;
  });

  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectId)) return current;
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  }, []);

  const wordmark = (
    <div className="flex items-center gap-2">
      <SidebarTrigger className="shrink-0 md:hidden" />
      <div className="flex min-w-0 flex-1 items-center gap-1 mt-2 ml-1">
        <T3Wordmark />
        <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
          Code
        </span>
        <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
          {APP_STAGE_LABEL}
        </span>
      </div>
    </div>
  );

  return (
    <>
      {isElectron ? null : (
        <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">
          {wordmark}
        </SidebarHeader>
      )}

      <SidebarContent className="gap-0">
        <SidebarGroup className="px-2 py-2">
          <div className="mb-2 flex items-center justify-between px-2 py-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/75">
              Projects
            </span>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-bold uppercase text-muted-foreground/75 transition-colors",
                addProjectDialogOpen
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-accent/70 hover:text-foreground",
              )}
              onClick={() => {
                if (isElectron) {
                  void handlePickFolder();
                  return;
                }
                setAddProjectDialogOpen(true);
              }}
            >
              <PlusIcon className="size-3.5" />
              <span>Add project</span>
            </button>
          </div>

          <SidebarMenu>
            {projects.map((project) => (
              <SidebarProjectSection
                key={project.id}
                projectId={project.id}
                activeProjectId={activeProjectId}
                routeThreadId={routeThreadId}
                renamingThreadId={renamingThreadId}
                renamingTitle={renamingTitle}
                renamingInputRef={renamingInputRef}
                renamingCommittedRef={renamingCommittedRef}
                setRenamingTitle={setRenamingTitle}
                commitRename={commitRename}
                cancelRename={cancelRename}
                openProjectContextMenu={openProjectContextMenu}
                openThreadContextMenu={openThreadContextMenu}
                openPrLink={openPrLink}
                handleOpenInSplitView={handleOpenInSplitView}
                navigateToSingleThread={navigateToSingleThread}
                handleNewThread={handleNewThread}
                toggleProject={toggleProject}
                newThreadShortcutLabel={newThreadShortcutLabel}
                expandedThreadListsByProject={expandedThreadListsByProject}
                expandThreadListForProject={expandThreadListForProject}
                collapseThreadListForProject={collapseThreadListForProject}
                prByThreadId={prByThreadId}
              />
            ))}
          </SidebarMenu>

          {projects.length === 0 && (
            <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
              No projects yet.
              <br />
              Add one to get started.
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>

      {showDesktopUpdateButton || showArm64IntelBuildWarning ? (
        <>
          <SidebarSeparator />
          <SidebarFooter className="gap-2 p-3">
            {showDesktopUpdateButton ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={desktopUpdateTooltip}
                      aria-disabled={desktopUpdateButtonDisabled || undefined}
                      disabled={desktopUpdateButtonDisabled}
                      className={`flex w-full items-center justify-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs transition-colors ${desktopUpdateButtonInteractivityClasses} ${desktopUpdateButtonClasses}`}
                      onClick={handleDesktopUpdateButtonClick}
                    >
                      <RocketIcon className="size-3.5" />
                      <span className="truncate">
                        {desktopUpdateButtonAction === "install"
                          ? "Install update"
                          : desktopUpdateState?.status === "downloading"
                            ? "Downloading update..."
                            : "Update available"}
                      </span>
                    </button>
                  }
                />
                <TooltipPopup side="top">{desktopUpdateTooltip}</TooltipPopup>
              </Tooltip>
            ) : null}
            {arm64IntelBuildWarningDescription ? (
              <p className="text-xs leading-5 text-amber-600 dark:text-amber-300/80">
                {arm64IntelBuildWarningDescription}
              </p>
            ) : null}
          </SidebarFooter>
        </>
      ) : null}

      <SidebarContextMenu
        entries={
          contextMenuState?.kind === "thread"
            ? THREAD_CONTEXT_MENU_ENTRIES
            : PROJECT_CONTEXT_MENU_ENTRIES
        }
        onOpenChange={handleSidebarContextMenuOpenChange}
        onSelect={handleSidebarContextMenuSelect}
        open={contextMenuState !== null}
        position={contextMenuState?.position ?? null}
      />

      <Dialog
        open={addProjectDialogOpen}
        onOpenChange={(open) => {
          if (isAddingProject) return;
          setAddProjectDialogOpen(open);
        }}
        onOpenChangeComplete={(open) => {
          if (open) return;
          setNewCwd("");
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader className="pb-5">
            <div className="flex items-center gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                <FolderOpenIcon />
              </div>
              <div className="min-w-0">
                <DialogTitle>Add workspace project</DialogTitle>
              </div>
            </div>
          </DialogHeader>
          <DialogPanel>
            <form
              id="add-project-form"
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                handleAddProject();
              }}
            >
              <Field className="gap-2">
                <FieldLabel htmlFor="project-workspace-root" className="text-muted-foreground">
                  Workspace path
                </FieldLabel>
                {isElectron ? (
                  <InputGroup>
                    <InputGroupInput
                      id="project-workspace-root"
                      autoFocus
                      placeholder="/path/to/project"
                      value={newCwd}
                      onChange={(event) => setNewCwd(event.target.value)}
                    />
                    <InputGroupAddon align="inline-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => void handlePickFolder()}
                        disabled={isPickingFolder || isAddingProject}
                      >
                        {isPickingFolder ? "Picking..." : "Browse"}
                      </Button>
                    </InputGroupAddon>
                  </InputGroup>
                ) : (
                  <Input
                    id="project-workspace-root"
                    autoFocus
                    placeholder="/path/to/project"
                    value={newCwd}
                    onChange={(event) => setNewCwd(event.target.value)}
                  />
                )}
              </Field>
            </form>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="toolbar"
              onClick={() => {
                setAddProjectDialogOpen(false);
              }}
              disabled={isAddingProject}
            >
              Cancel
            </Button>
            <Button
              form="add-project-form"
              type="submit"
              variant="toolbar-primary"
              size="toolbar"
              disabled={isAddingProject}
            >
              {isAddingProject ? "Adding..." : "Add project"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog
        open={deleteDialogState !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeDeleteDialog();
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader className="pb-5">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-xl border",
                  deleteDialogState?.kind === "project"
                    ? "border-orange-500/20 bg-orange-500/10 text-orange-400"
                    : "border-destructive/25 bg-destructive/10 text-destructive",
                )}
              >
                {deleteDialogState?.kind === "project" ? <FolderIcon /> : <Trash2Icon />}
              </div>
              <div className="min-w-0 text-left">
                <AlertDialogTitle>
                  {deleteDialogState?.kind === "project" ? "Delete project" : "Delete thread"}
                </AlertDialogTitle>
              </div>
            </div>
          </AlertDialogHeader>

          <div className="bg-popover px-6 py-5 max-sm:px-5">
            <p className="text-sm leading-6 text-muted-foreground">
              {deleteDialogState?.kind === "project"
                ? `This removes "${deleteDialogState.projectName}" from the sidebar. This action cannot be undone.`
                : deleteDialogState
                  ? `This permanently clears the conversation history for "${deleteDialogState.threadTitle}".`
                  : ""}
            </p>
          </div>

          {deleteDialogState?.kind === "thread" && deleteDialogState.canDeleteWorktree ? (
            <div className="bg-popover px-6 pb-6 pt-0 max-sm:px-5">
              <label
                className="flex items-start gap-3"
                htmlFor="delete-thread-worktree"
              >
                <Checkbox
                  checked={deleteDialogDeleteWorktree}
                  className="mt-0.5"
                  id="delete-thread-worktree"
                  onCheckedChange={(checked) => setDeleteDialogDeleteWorktree(checked === true)}
                />
                <span className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-foreground">Also delete worktree</span>
                  <span className="text-sm text-muted-foreground">
                    {deleteDialogState.worktreeDisplayPath ??
                      "Remove the orphaned worktree from disk too."}
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          <AlertDialogFooter>
            <Button
              disabled={deleteDialogSubmitting}
              variant="ghost"
              size="toolbar"
              onClick={closeDeleteDialog}
            >
              Cancel
            </Button>
            <Button
              disabled={deleteDialogSubmitting}
              variant="destructive"
              size="toolbar"
              onClick={() => {
                void handleDeleteDialogConfirm();
              }}
            >
              {deleteDialogSubmitting ? "Deleting..." : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
