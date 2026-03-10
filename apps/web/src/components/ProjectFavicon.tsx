import { FolderIcon, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils";

function getServerHttpOrigin(): string {
  const bridgeUrl = window.desktopBridge?.getWsUrl();
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsUrl =
    bridgeUrl && bridgeUrl.length > 0
      ? bridgeUrl
      : envUrl && envUrl.length > 0
        ? envUrl
        : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:${window.location.port}`;
  const httpUrl = wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  try {
    return new URL(httpUrl).origin;
  } catch {
    return httpUrl;
  }
}

const serverHttpOrigin = getServerHttpOrigin();

export function ProjectFavicon(props: {
  cwd: string;
  className?: string;
  fallbackClassName?: string;
  fallbackIcon?: LucideIcon;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const src = `${serverHttpOrigin}/api/project-favicon?cwd=${encodeURIComponent(props.cwd)}`;
  const FallbackIcon = props.fallbackIcon ?? FolderIcon;

  useEffect(() => {
    setStatus("loading");
  }, [src]);

  if (status === "error") {
    return (
      <FallbackIcon
        className={cn("size-3.5 shrink-0 text-muted-foreground/50", props.fallbackClassName)}
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={cn(
        "size-3.5 shrink-0 rounded-sm object-contain",
        status === "loading" && "hidden",
        props.className,
      )}
      onLoad={(event) => {
        const image = event.currentTarget;
        setStatus(image.naturalWidth > 0 || image.naturalHeight > 0 ? "loaded" : "error");
      }}
      onError={() => setStatus("error")}
    />
  );
}
