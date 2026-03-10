import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const FAVICON_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Well-known favicon paths checked in order.
const FAVICON_CANDIDATES = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "favicon-32x32.png",
  "favicon-16x16.png",
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "public/favicon-32x32.png",
  "public/favicon-16x16.png",
  "app/favicon.ico",
  "app/favicon.png",
  "app/icon.svg",
  "app/icon.png",
  "app/icon.ico",
  "src/favicon.ico",
  "src/favicon.svg",
  "src/app/favicon.ico",
  "src/app/icon.svg",
  "src/app/icon.png",
  "assets/icon.svg",
  "assets/icon.png",
  "assets/logo.svg",
  "assets/logo.png",
];

// Files that may contain a <link rel="icon"> or icon metadata declaration.
const ICON_SOURCE_FILES = [
  "index.html",
  "public/index.html",
  "app/routes/__root.tsx",
  "src/routes/__root.tsx",
  "app/root.tsx",
  "src/root.tsx",
  "src/index.html",
];

// Matches <link ...> tags or object-like icon metadata where rel/href can appear in any order.
const LINK_ICON_HTML_RE =
  /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/i;
const LINK_ICON_OBJ_RE =
  /(?=[^}]*\brel\s*:\s*["'](?:icon|shortcut icon)["'])(?=[^}]*\bhref\s*:\s*["']([^"'?]+))[^}]*/i;

const IGNORED_APP_SEARCH_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "dist",
  "node_modules",
  "out",
]);
const APP_ROOT_MARKER_DIRECTORIES = new Set(["app", "public", "src"]);
const APP_ROOT_MARKER_FILES = new Set(["index.html", "package.json"]);
const APP_ROOT_MARKER_FILE_PREFIXES = [
  "angular.",
  "astro.config.",
  "next.config.",
  "nuxt.config.",
  "remix.config.",
  "svelte.config.",
  "vite.config.",
];
const APPS_SEARCH_MAX_DEPTH = 4;

function extractIconHref(source: string): string | null {
  const htmlMatch = source.match(LINK_ICON_HTML_RE);
  if (htmlMatch?.[1]) return htmlMatch[1];
  const objMatch = source.match(LINK_ICON_OBJ_RE);
  if (objMatch?.[1]) return objMatch[1];
  return null;
}

function resolveIconHref(projectCwd: string, href: string): string[] {
  const clean = href.replace(/^\//, "");
  return [path.join(projectCwd, "public", clean), path.join(projectCwd, clean)];
}

function isPathWithinProject(projectCwd: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(projectCwd), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fsPromises.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function resolveFaviconFromProjectRoot(projectCwd: string): Promise<string | null> {
  for (const relativeCandidate of FAVICON_CANDIDATES) {
    const candidatePath = path.join(projectCwd, relativeCandidate);
    if (!isPathWithinProject(projectCwd, candidatePath)) {
      continue;
    }
    if (await isFile(candidatePath)) {
      return candidatePath;
    }
  }

  for (const relativeSourceFile of ICON_SOURCE_FILES) {
    const sourceFilePath = path.join(projectCwd, relativeSourceFile);
    let content: string;
    try {
      content = await fsPromises.readFile(sourceFilePath, "utf8");
    } catch {
      continue;
    }

    const href = extractIconHref(content);
    if (!href) {
      continue;
    }

    for (const resolvedPath of resolveIconHref(projectCwd, href)) {
      if (!isPathWithinProject(projectCwd, resolvedPath)) {
        continue;
      }
      if (await isFile(resolvedPath)) {
        return resolvedPath;
      }
    }
  }

  return null;
}

function looksLikeWebAppRoot(entries: readonly fs.Dirent[]): boolean {
  for (const entry of entries) {
    if (entry.isDirectory() && APP_ROOT_MARKER_DIRECTORIES.has(entry.name)) {
      return true;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (APP_ROOT_MARKER_FILES.has(entry.name)) {
      return true;
    }
    if (APP_ROOT_MARKER_FILE_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) {
      return true;
    }
  }
  return false;
}

async function collectNestedAppRoots(
  directoryPath: string,
  depth: number,
  roots: string[],
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsPromises.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  const sortedEntries = entries.toSorted((left, right) => left.name.localeCompare(right.name));
  if (depth > 0 && looksLikeWebAppRoot(sortedEntries)) {
    roots.push(directoryPath);
    return;
  }

  if (depth >= APPS_SEARCH_MAX_DEPTH) {
    return;
  }

  for (const entry of sortedEntries) {
    if (
      !entry.isDirectory() ||
      IGNORED_APP_SEARCH_DIRECTORIES.has(entry.name) ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    await collectNestedAppRoots(path.join(directoryPath, entry.name), depth + 1, roots);
  }
}

async function resolveProjectFaviconPath(projectCwd: string): Promise<string | null> {
  const faviconFromRoot = await resolveFaviconFromProjectRoot(projectCwd);
  if (faviconFromRoot) {
    return faviconFromRoot;
  }

  const appsDirectoryPath = path.join(projectCwd, "apps");
  let appsDirectoryStats: fs.Stats;
  try {
    appsDirectoryStats = await fsPromises.stat(appsDirectoryPath);
  } catch {
    return null;
  }
  if (!appsDirectoryStats.isDirectory()) {
    return null;
  }

  const nestedAppRoots: string[] = [];
  await collectNestedAppRoots(appsDirectoryPath, 0, nestedAppRoots);
  for (const appRoot of nestedAppRoots) {
    const faviconFromApp = await resolveFaviconFromProjectRoot(appRoot);
    if (faviconFromApp) {
      return faviconFromApp;
    }
  }

  return null;
}

function serveFaviconFile(filePath: string, res: http.ServerResponse): void {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = FAVICON_MIME_TYPES[ext] ?? "application/octet-stream";
  fs.readFile(filePath, (readErr, data) => {
    if (readErr) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Read error");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    });
    res.end(data);
  });
}

function serveMissingFavicon(res: http.ServerResponse): void {
  res.writeHead(204, { "Cache-Control": "no-store" });
  res.end();
}

export function tryHandleProjectFaviconRequest(url: URL, res: http.ServerResponse): boolean {
  if (url.pathname !== "/api/project-favicon") {
    return false;
  }

  const projectCwd = url.searchParams.get("cwd");
  if (!projectCwd) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing cwd parameter");
    return true;
  }

  void resolveProjectFaviconPath(projectCwd)
    .then((faviconPath) => {
      if (!faviconPath) {
        serveMissingFavicon(res);
        return;
      }
      serveFaviconFile(faviconPath, res);
    })
    .catch(() => {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Failed to resolve favicon");
    });
  return true;
}
