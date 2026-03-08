import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadScript } from "./load.js";

const createUtils = loadScript("utils.js", {
  globals: ["fetch"],
  returnExpr:
    "{ API_BASE, DEFAULT_PRIORITY, MAX_BACKOFF_MULTIPLIER, todayStr, fetchJson, postJson }",
});

describe("utils.js", () => {
  describe("constants", () => {
    const utils = createUtils(() => {});

    it("API_BASE points to the todo app API", () => {
      expect(utils.API_BASE).toBe("https://api.nexus.brooksmcmillin.com/api");
    });

    it("DEFAULT_PRIORITY is medium", () => {
      expect(utils.DEFAULT_PRIORITY).toBe("medium");
    });

    it("MAX_BACKOFF_MULTIPLIER is 8", () => {
      expect(utils.MAX_BACKOFF_MULTIPLIER).toBe(8);
    });
  });

  describe("todayStr", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("formats date as YYYY-MM-DD", () => {
      vi.setSystemTime(new Date(2026, 1, 24));
      const utils = createUtils(() => {});
      expect(utils.todayStr()).toBe("2026-02-24");
    });

    it("pads single-digit month and day", () => {
      vi.setSystemTime(new Date(2026, 0, 5));
      const utils = createUtils(() => {});
      expect(utils.todayStr()).toBe("2026-01-05");
    });

    it("handles December 31", () => {
      vi.setSystemTime(new Date(2025, 11, 31));
      const utils = createUtils(() => {});
      expect(utils.todayStr()).toBe("2025-12-31");
    });
  });

  describe("fetchJson", () => {
    it("sends GET with credentials include", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
      const utils = createUtils(mockFetch);
      await utils.fetchJson("https://example.com/api");
      expect(mockFetch).toHaveBeenCalledWith("https://example.com/api", {
        credentials: "include",
      });
    });

    it("returns parsed JSON on success", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [1, 2] }),
      });
      const utils = createUtils(mockFetch);
      const result = await utils.fetchJson("https://example.com/api");
      expect(result).toEqual({ data: [1, 2] });
    });

    it("throws on non-ok response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      const utils = createUtils(mockFetch);
      await expect(utils.fetchJson("https://example.com/api")).rejects.toThrow(
        "HTTP 404",
      );
    });
  });

  describe("postJson", () => {
    it("sends POST with JSON body and credentials", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
      const utils = createUtils(mockFetch);
      await utils.postJson("https://example.com/api", { id: 1 });
      expect(mockFetch).toHaveBeenCalledWith("https://example.com/api", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: '{"id":1}',
      });
    });

    it("returns parsed JSON on success", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
      const utils = createUtils(mockFetch);
      const result = await utils.postJson("https://example.com/api", {});
      expect(result).toEqual({ success: true });
    });

    it("throws on non-ok response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      const utils = createUtils(mockFetch);
      await expect(
        utils.postJson("https://example.com/api", {}),
      ).rejects.toThrow("HTTP 500");
    });
  });
});
