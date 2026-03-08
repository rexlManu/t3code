import { describe, expect, it, vi } from "vitest";

import { openExternalUrl } from "./openExternal";

describe("openExternalUrl", () => {
  it("falls back to Electron shell outside linux", async () => {
    const shellOpenExternal = vi.fn(async () => {});

    await expect(
      openExternalUrl("https://example.com", {
        platform: "darwin",
        shellOpenExternal,
      }),
    ).resolves.toBe(true);

    expect(shellOpenExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("returns false when the fallback shell opener fails", async () => {
    const shellOpenExternal = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(
      openExternalUrl("https://example.com", {
        platform: "win32",
        shellOpenExternal,
      }),
    ).resolves.toBe(false);
  });
});
