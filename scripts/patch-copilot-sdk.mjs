import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SESSION_IMPORT = '"vscode-jsonrpc/node"';
const FIXED_SESSION_IMPORT = '"vscode-jsonrpc/node.js"';

async function resolveCopilotSdkRoot() {
  const candidates = [
    path.join(process.cwd(), "apps/server/node_modules/@github/copilot-sdk"),
    path.join(process.cwd(), "node_modules/@github/copilot-sdk"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function patchFile(filePath) {
  const source = await readFile(filePath, "utf8");
  if (!source.includes(SESSION_IMPORT)) {
    return false;
  }

  await writeFile(filePath, source.replaceAll(SESSION_IMPORT, FIXED_SESSION_IMPORT), "utf8");
  return true;
}

async function main() {
  const sdkRoot = await resolveCopilotSdkRoot();
  if (!sdkRoot) {
    return;
  }

  const files = [
    path.join(sdkRoot, "dist", "session.js"),
    path.join(sdkRoot, "dist", "session.d.ts"),
  ];

  let patchedAny = false;
  for (const filePath of files) {
    if (!(await fileExists(filePath))) {
      continue;
    }
    patchedAny = (await patchFile(filePath)) || patchedAny;
  }

  if (patchedAny) {
    console.log("[patch-copilot-sdk] patched @github/copilot-sdk ESM import for Node 24");
  }
}

await main();
