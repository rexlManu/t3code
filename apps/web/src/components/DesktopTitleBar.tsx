import type { DesktopWindowState } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { MinusIcon, XIcon } from "lucide-react";

import { APP_BASE_NAME, APP_STAGE_LABEL } from "../branding";
import { useDesktopWindowState } from "../hooks/useDesktopWindowState";
import { cn, isMacPlatform } from "../lib/utils";
import { Badge } from "./ui/badge";

interface DesktopTitleBarProps {
  meta?: ReactNode;
  subtitle?: string;
  title: string;
  trailing?: ReactNode;
}

interface WindowControlButtonProps {
  ariaLabel: string;
  children: ReactNode;
  className: string;
  onClick: () => void;
}

function currentPlatform(): string {
  if (typeof navigator === "undefined") {
    return "";
  }

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };

  return (
    navigatorWithUserAgentData.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent
  );
}

function WindowControlGlyph(props: { className?: string; maximized: boolean }) {
  if (props.maximized) {
    return (
      <svg aria-hidden="true" className={cn("size-3.5", props.className)} viewBox="0 0 16 16" fill="none">
        <path
          d="M4.75 5.75h6.5v6.5h-6.5z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.2"
        />
        <path
          d="M6 4.5h5.25v5.25"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.2"
        />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className={cn("size-3.5", props.className)} viewBox="0 0 16 16" fill="none">
      <rect
        x="4.25"
        y="4.25"
        width="7.5"
        height="7.5"
        rx="1.25"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function WindowControlButton({
  ariaLabel,
  children,
  className,
  onClick,
}: WindowControlButtonProps) {
  return (
    <button aria-label={ariaLabel} className={className} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function TitleBarBrand(props: { focused: boolean }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full border border-border/70 bg-background/78 px-2.5 py-1.5 shadow-xs backdrop-blur-md",
        props.focused ? "text-foreground" : "text-muted-foreground/85",
      )}
    >
      <span className="flex size-6 items-center justify-center rounded-lg bg-foreground text-[9px] font-black tracking-[0.22em] text-background">
        T3
      </span>
      <span className="hidden text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase lg:inline">
        {APP_BASE_NAME}
      </span>
      <Badge
        variant="outline"
        size="sm"
        className="border-border/70 bg-background/85 px-1.5 text-[9px] tracking-[0.16em] uppercase"
      >
        {APP_STAGE_LABEL}
      </Badge>
    </div>
  );
}

function TitleBarWindowControls(props: { windowState: DesktopWindowState }) {
  const isMac = isMacPlatform(currentPlatform());
  const bridge = window.desktopBridge;

  const minimizeWindow = () => {
    void bridge?.minimizeWindow?.();
  };
  const toggleMaximizeWindow = () => {
    void bridge?.toggleMaximizeWindow?.();
  };
  const closeWindow = () => {
    void bridge?.closeWindow?.();
  };

  if (isMac) {
    return (
      <div className="no-drag flex items-center gap-2">
        <WindowControlButton
          ariaLabel="Close window"
          className="group/control flex size-3.5 items-center justify-center rounded-full bg-[#ff5f57] text-[#7a1711] shadow-[0_0_0_1px_rgba(0,0,0,0.12)_inset]"
          onClick={closeWindow}
        >
          <XIcon className="size-2.5 opacity-0 transition-opacity group-hover/control:opacity-85" />
        </WindowControlButton>
        <WindowControlButton
          ariaLabel="Minimize window"
          className="group/control flex size-3.5 items-center justify-center rounded-full bg-[#febc2e] text-[#7a5410] shadow-[0_0_0_1px_rgba(0,0,0,0.12)_inset]"
          onClick={minimizeWindow}
        >
          <MinusIcon className="size-2.5 opacity-0 transition-opacity group-hover/control:opacity-85" />
        </WindowControlButton>
        <WindowControlButton
          ariaLabel={props.windowState.isMaximized ? "Restore window" : "Maximize window"}
          className="group/control flex size-3.5 items-center justify-center rounded-full bg-[#28c840] text-[#0d5d17] shadow-[0_0_0_1px_rgba(0,0,0,0.12)_inset]"
          onClick={toggleMaximizeWindow}
        >
          <WindowControlGlyph
            maximized={props.windowState.isMaximized}
            className="opacity-0 transition-opacity group-hover/control:opacity-85"
          />
        </WindowControlButton>
      </div>
    );
  }

  return (
    <div className="no-drag ml-auto flex items-center gap-1">
      <WindowControlButton
        ariaLabel="Minimize window"
        className="flex h-8 w-11 items-center justify-center rounded-lg border border-transparent text-muted-foreground/80 transition-colors hover:bg-accent/70 hover:text-foreground"
        onClick={minimizeWindow}
      >
        <MinusIcon className="size-3.5" />
      </WindowControlButton>
      <WindowControlButton
        ariaLabel={props.windowState.isMaximized ? "Restore window" : "Maximize window"}
        className="flex h-8 w-11 items-center justify-center rounded-lg border border-transparent text-muted-foreground/80 transition-colors hover:bg-accent/70 hover:text-foreground"
        onClick={toggleMaximizeWindow}
      >
        <WindowControlGlyph maximized={props.windowState.isMaximized} />
      </WindowControlButton>
      <WindowControlButton
        ariaLabel="Close window"
        className="flex h-8 w-11 items-center justify-center rounded-lg border border-transparent text-muted-foreground/80 transition-colors hover:border-red-500/20 hover:bg-red-500/14 hover:text-red-600 dark:hover:text-red-300"
        onClick={closeWindow}
      >
        <XIcon className="size-3.5" />
      </WindowControlButton>
    </div>
  );
}

export function DesktopTitleBar(props: DesktopTitleBarProps) {
  const windowState = useDesktopWindowState();
  const isMac = isMacPlatform(currentPlatform());

  return (
    <header
      className={cn(
        "drag-region relative flex h-14 shrink-0 items-center border-b border-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_88%,var(--color-white)_12%)_0%,color-mix(in_srgb,var(--background)_97%,var(--color-black)_3%)_100%)] px-3 sm:px-4",
        !windowState.isFocused && "opacity-[0.88]",
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/35 dark:bg-white/8" />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {isMac ? <TitleBarWindowControls windowState={windowState} /> : null}
        <TitleBarBrand focused={windowState.isFocused} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold tracking-tight text-foreground">
              {props.title}
            </p>
            {props.meta ? <div className="flex min-w-0 items-center gap-1.5">{props.meta}</div> : null}
          </div>
          {props.subtitle ? (
            <p className="truncate text-[11px] tracking-[0.04em] text-muted-foreground/80">
              {props.subtitle}
            </p>
          ) : null}
        </div>
        {props.trailing ? (
          <div className="no-drag hidden min-w-0 shrink-0 items-center gap-2 md:flex">
            {props.trailing}
          </div>
        ) : null}
        {!isMac ? <TitleBarWindowControls windowState={windowState} /> : null}
      </div>
    </header>
  );
}
