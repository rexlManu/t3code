import type { DesktopWindowState } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { MinusIcon, TerminalIcon, XIcon } from "lucide-react";

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
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={cn(
          "inline-flex size-4 items-center justify-center text-primary transition-opacity",
          !props.focused && "opacity-75",
        )}
      >
        <TerminalIcon className="size-[13px]" />
      </span>
      <span
        className={cn(
          "truncate text-[11px] font-semibold tracking-tight transition-colors",
          props.focused
            ? "text-foreground/78"
            : "text-foreground/55",
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
    <div className="no-drag ml-auto flex items-center">
      <WindowControlButton
        ariaLabel="Minimize window"
        className="flex h-7 w-8 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
        onClick={minimizeWindow}
      >
        <MinusIcon className="size-3" />
      </WindowControlButton>
      <WindowControlButton
        ariaLabel={props.windowState.isMaximized ? "Restore window" : "Maximize window"}
        className="flex h-7 w-8 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
        onClick={toggleMaximizeWindow}
      >
        <WindowControlGlyph maximized={props.windowState.isMaximized} />
      </WindowControlButton>
      <WindowControlButton
        ariaLabel="Close window"
        className="flex h-7 w-8 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-red-500/80 hover:text-white"
        onClick={closeWindow}
      >
        <XIcon className="size-3" />
      </WindowControlButton>
    </div>
  );
}

export function DesktopTitleBar() {
  const windowState = useDesktopWindowState();

  return (
    <header
      className={cn(
        "drag-region relative z-20 flex h-7 shrink-0 items-center justify-between border-b border-border-subtle bg-surface px-3",
        !windowState.isFocused && "opacity-[0.9]",
      )}
    >
      <TitleBarBrand focused={windowState.isFocused} />
      <TitleBarWindowControls windowState={windowState} />
    </header>
  );
}
