import { spawn } from "node:child_process";

import { shell } from "electron";

const LINUX_BROWSER_OVERRIDE_ENV_VARS = ["BROWSER", "BROWSER_ARGS"] as const;

function omitLinuxBrowserOverrides(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = { ...env };
  for (const key of LINUX_BROWSER_OVERRIDE_ENV_VARS) {
    delete nextEnv[key];
  }
  return nextEnv;
}

function spawnLinuxExternalOpener(
  target: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("xdg-open", [target], {
        detached: true,
        stdio: "ignore",
        env: omitLinuxBrowserOverrides(env),
      });
    } catch {
      resolve(false);
      return;
    }

    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
    child.once("error", () => resolve(false));
  });
}

export async function openExternalUrl(
  target: string,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly env?: NodeJS.ProcessEnv;
    readonly shellOpenExternal?: typeof shell.openExternal;
    readonly linuxOpenExternal?: typeof spawnLinuxExternalOpener;
  } = {},
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  try {
    await (options.shellOpenExternal ?? shell.openExternal)(target);
    return true;
  } catch {
    if (platform === "linux") {
      return (options.linuxOpenExternal ?? spawnLinuxExternalOpener)(target, options.env);
    }
    return false;
  }
}
