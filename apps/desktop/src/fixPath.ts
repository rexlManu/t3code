import { readPathFromLoginShell } from "@t3tools/shared/shell";

export function fixPath(): void {
  if (process.platform === "win32") return;

  try {
    const shell = process.env.SHELL ?? (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
    const result = readPathFromLoginShell(shell);
    if (result) {
      process.env.PATH = result;
    }
  } catch {
    // Keep inherited PATH if shell lookup fails.
  }

}
