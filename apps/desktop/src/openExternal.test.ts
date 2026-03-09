import { describe, expect, it, vi } from "vitest";

import { openExternalUrl } from "./openExternal";

describe("openExternalUrl", () => {
  it("prefers Electron shell on linux when it succeeds", async () => {
    const shellOpenExternal = vi.fn(async () => {});
    const linuxOpenExternal = vi.fn(async () => true);

    await expect(
      openExternalUrl("https://example.com", {
        platform: "linux",
        shellOpenExternal,
        linuxOpenExternal,
      }),
    ).resolves.toBe(true);

    expect(shellOpenExternal).toHaveBeenCalledWith("https://example.com");
    expect(linuxOpenExternal).not.toHaveBeenCalled();
  });

  it("falls back to the linux opener when Electron shell fails", async () => {
    const shellOpenExternal = vi.fn(async () => {
      throw new Error("boom");
    });
    const linuxOpenExternal = vi.fn(async () => true);

    await expect(
      openExternalUrl("https://example.com", {
        platform: "linux",
        shellOpenExternal,
        linuxOpenExternal,
      }),
    ).resolves.toBe(true);

    expect(shellOpenExternal).toHaveBeenCalledWith("https://example.com");
    expect(linuxOpenExternal).toHaveBeenCalledWith("https://example.com", undefined);
  });

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

  it("returns false when both linux openers fail", async () => {
    const shellOpenExternal = vi.fn(async () => {
      throw new Error("boom");
    });
    const linuxOpenExternal = vi.fn(async () => false);

    await expect(
      openExternalUrl("https://example.com", {
        platform: "linux",
        shellOpenExternal,
        linuxOpenExternal,
      }),
    ).resolves.toBe(false);
  });
});
