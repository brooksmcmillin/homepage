import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadScript } from "./load.js";

const createBackground = loadScript("background.js", {
  globals: [
    "API_BASE",
    "MAX_BACKOFF_MULTIPLIER",
    "todayStr",
    "fetchJson",
    "browser",
    "console",
  ],
  returnExpr: `{
    POLL_INTERVAL_MINUTES,
    fetchTaskCount,
    scheduleNextPoll,
    updateBadge,
    get consecutiveFailures() { return consecutiveFailures; },
    set consecutiveFailures(v) { consecutiveFailures = v; },
  }`,
  stripAfterLast: "// Toggle sidebar",
});

function makeBrowser() {
  return {
    alarms: { create: vi.fn() },
    browserAction: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    sidebarAction: { toggle: vi.fn() },
  };
}

describe("background.js", () => {
  let bg;
  let mockBrowser;
  let mockFetchJson;

  beforeEach(() => {
    mockBrowser = makeBrowser();
    mockFetchJson = vi.fn();
    bg = createBackground(
      "https://api.nexus.brooksmcmillin.com/api",
      8,
      () => "2026-02-24",
      mockFetchJson,
      mockBrowser,
      { error: vi.fn(), log: vi.fn() },
    );
  });

  describe("fetchTaskCount", () => {
    it("returns combined count of today and overdue tasks", async () => {
      mockFetchJson
        .mockResolvedValueOnce({ data: [{ id: 1 }, { id: 2 }] })
        .mockResolvedValueOnce({
          data: [{ id: 3, due_date: "2026-02-20" }],
        });
      expect(await bg.fetchTaskCount()).toBe(3);
    });

    it("excludes overdue tasks whose due_date is today (dedup)", async () => {
      mockFetchJson
        .mockResolvedValueOnce({ data: [{ id: 1 }] })
        .mockResolvedValueOnce({
          data: [
            { id: 2, due_date: "2026-02-24" },
            { id: 3, due_date: "2026-02-01" },
          ],
        });
      expect(await bg.fetchTaskCount()).toBe(2);
    });

    it("handles empty data arrays", async () => {
      mockFetchJson
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });
      expect(await bg.fetchTaskCount()).toBe(0);
    });

    it("handles missing data property", async () => {
      mockFetchJson.mockResolvedValueOnce({}).mockResolvedValueOnce({});
      expect(await bg.fetchTaskCount()).toBe(0);
    });
  });

  describe("scheduleNextPoll", () => {
    it("uses base interval with no failures", () => {
      bg.consecutiveFailures = 0;
      bg.scheduleNextPoll();
      expect(mockBrowser.alarms.create).toHaveBeenCalledWith("badge-update", {
        delayInMinutes: 5,
      });
    });

    it("doubles interval after one failure", () => {
      bg.consecutiveFailures = 1;
      bg.scheduleNextPoll();
      expect(mockBrowser.alarms.create).toHaveBeenCalledWith("badge-update", {
        delayInMinutes: 10,
      });
    });

    it("caps at MAX_BACKOFF_MULTIPLIER", () => {
      bg.consecutiveFailures = 10;
      bg.scheduleNextPoll();
      expect(mockBrowser.alarms.create).toHaveBeenCalledWith("badge-update", {
        delayInMinutes: 40,
      });
    });
  });

  describe("updateBadge", () => {
    it("sets badge count and blue color on success", async () => {
      mockFetchJson
        .mockResolvedValueOnce({ data: [{ id: 1 }] })
        .mockResolvedValueOnce({ data: [] });
      await bg.updateBadge();
      expect(mockBrowser.browserAction.setBadgeText).toHaveBeenCalledWith({
        text: "1",
      });
      expect(
        mockBrowser.browserAction.setBadgeBackgroundColor,
      ).toHaveBeenCalledWith({ color: "#2563eb" });
    });

    it("clears badge when count is zero", async () => {
      mockFetchJson
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });
      await bg.updateBadge();
      expect(mockBrowser.browserAction.setBadgeText).toHaveBeenCalledWith({
        text: "",
      });
      expect(
        mockBrowser.browserAction.setBadgeBackgroundColor,
      ).toHaveBeenCalledWith({ color: "#22c55e" });
    });

    it("resets consecutiveFailures on success", async () => {
      bg.consecutiveFailures = 3;
      mockFetchJson
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });
      await bg.updateBadge();
      expect(bg.consecutiveFailures).toBe(0);
    });

    it("shows error badge and increments failures on error", async () => {
      mockFetchJson.mockRejectedValue(new Error("network"));
      await bg.updateBadge();
      expect(bg.consecutiveFailures).toBe(1);
      expect(mockBrowser.browserAction.setBadgeText).toHaveBeenCalledWith({
        text: "!",
      });
      expect(
        mockBrowser.browserAction.setBadgeBackgroundColor,
      ).toHaveBeenCalledWith({ color: "#6b7280" });
    });

    it("always schedules next poll after success", async () => {
      mockFetchJson
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });
      await bg.updateBadge();
      expect(mockBrowser.alarms.create).toHaveBeenCalledWith(
        "badge-update",
        expect.any(Object),
      );
    });

    it("always schedules next poll after error", async () => {
      mockFetchJson.mockRejectedValue(new Error("fail"));
      await bg.updateBadge();
      expect(mockBrowser.alarms.create).toHaveBeenCalledWith(
        "badge-update",
        expect.any(Object),
      );
    });
  });
});
