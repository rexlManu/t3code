import type { DesktopWindowState } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { MinusIcon, XIcon } from "lucide-react";

import { APP_BASE_NAME } from "../branding";
import { useDesktopWindowState } from "../hooks/useDesktopWindowState";
import { cn } from "../lib/utils";

interface WindowControlButtonProps {
  ariaLabel: string;
  children: ReactNode;
  className: string;
  onClick: () => void;
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
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex size-5 items-center justify-center rounded-md bg-foreground text-[8px] font-black tracking-[0.18em] text-background">
        T3
      </span>
      <span
        className={cn(
          "truncate text-[13px] font-medium tracking-[0.01em]",
          props.focused ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {APP_BASE_NAME}
      </span>
    </div>
  );
}

function TitleBarWindowControls(props: { windowState: DesktopWindowState }) {
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

  return (
    <div className="no-drag ml-auto flex items-center gap-1">
      <WindowControlButton
        ariaLabel="Minimize window"
        className="flex h-8 w-10 items-center justify-center rounded-md border border-transparent text-muted-foreground/80 transition-colors hover:bg-accent/70 hover:text-foreground"
        onClick={minimizeWindow}
      >
        <MinusIcon className="size-3.5" />
      </WindowControlButton>
      <WindowControlButton
        ariaLabel={props.windowState.isMaximized ? "Restore window" : "Maximize window"}
        className="flex h-8 w-10 items-center justify-center rounded-md border border-transparent text-muted-foreground/80 transition-colors hover:bg-accent/70 hover:text-foreground"
        onClick={toggleMaximizeWindow}
      >
        <WindowControlGlyph maximized={props.windowState.isMaximized} />
      </WindowControlButton>
      <WindowControlButton
        ariaLabel="Close window"
        className="flex h-8 w-10 items-center justify-center rounded-md border border-transparent text-muted-foreground/80 transition-colors hover:border-red-500/20 hover:bg-red-500/14 hover:text-red-600 dark:hover:text-red-300"
        onClick={closeWindow}
      >
        <XIcon className="size-3.5" />
      </WindowControlButton>
    </div>
  );
}

export function DesktopTitleBar() {
  const windowState = useDesktopWindowState();

  return (
    <header
      className={cn(
        "drag-region relative flex h-10 shrink-0 items-center border-b border-border bg-card px-3",
        !windowState.isFocused && "opacity-[0.88]",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <TitleBarBrand focused={windowState.isFocused} />
        <div className="min-w-0 flex-1" />
        <TitleBarWindowControls windowState={windowState} />
      </div>
    </header>
  );
}
