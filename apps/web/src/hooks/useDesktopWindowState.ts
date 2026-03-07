import type { DesktopWindowState } from "@t3tools/contracts";
import { useEffect, useState } from "react";

const DEFAULT_WINDOW_STATE: DesktopWindowState = {
  isFocused: true,
  isFullScreen: false,
  isMaximized: false,
};

export function useDesktopWindowState(): DesktopWindowState {
  const [windowState, setWindowState] = useState<DesktopWindowState>(DEFAULT_WINDOW_STATE);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.getWindowState || !bridge.onWindowState) {
      return;
    }

    let disposed = false;

    void bridge
      .getWindowState()
      .then((state) => {
        if (!disposed && state) {
          setWindowState(state);
        }
      })
      .catch(() => undefined);

    const unsubscribe = bridge.onWindowState((state) => {
      if (!disposed) {
        setWindowState(state);
      }
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  return windowState;
}
