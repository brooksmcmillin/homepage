import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadScript } from "./load.js";

const createSidebar = loadScript("sidebar.js", {
  globals: [
    "API_BASE",
    "DEFAULT_PRIORITY",
    "MAX_BACKOFF_MULTIPLIER",
    "todayStr",
    "fetchJson",
    "postJson",
  ],
  returnExpr: `{
    APP_BASE,
    REFRESH_INTERVAL_MS,
    formatDueDate,
    escapeHtml,
    completeTask,
    renderTaskItem,
    bindCompleteBtns,
    scheduleNextRefresh,
    loadTasks,
    completingTasks,
    get consecutiveFailures() { return consecutiveFailures; },
    set consecutiveFailures(v) { consecutiveFailures = v; },
  }`,
  stripAfterLast: "loadTasks();",
});

function setupDOM() {
  document.body.innerHTML = `
    <header class="sidebar-header">
      <h1 class="sidebar-title">Tasks</h1>
      <span class="badge" id="task-count"></span>
    </header>
    <div id="tasks" class="task-list"></div>
  `;
}

describe("sidebar.js", () => {
  let sidebar;
  let mockFetchJson;
  let mockPostJson;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 1, 24));
    setupDOM();

    mockFetchJson = vi.fn();
    mockPostJson = vi.fn();
    sidebar = createSidebar(
      "https://api.nexus.brooksmcmillin.com/api",
      "medium",
      8,
      () => "2026-02-24",
      mockFetchJson,
      mockPostJson,
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  describe("escapeHtml", () => {
    it("escapes angle brackets", () => {
      expect(sidebar.escapeHtml("<script>alert(1)</script>")).toBe(
        "&lt;script&gt;alert(1)&lt;/script&gt;",
      );
    });

    it("passes through quotes (safe in text content, not attributes)", () => {
      // textContent/innerHTML only escapes <, >, & — quotes don't need
      // escaping in text content. Attribute injection is a separate concern.
      const result = sidebar.escapeHtml('"quoted"');
      expect(result).toContain("quoted");
      expect(result).not.toContain("<");
    });

    it("escapes ampersands", () => {
      expect(sidebar.escapeHtml("a & b")).toBe("a &amp; b");
    });

    it("preserves normal text", () => {
      expect(sidebar.escapeHtml("hello world")).toBe("hello world");
    });

    it("handles empty string", () => {
      expect(sidebar.escapeHtml("")).toBe("");
    });
  });

  describe("formatDueDate", () => {
    it("returns empty string for null", () => {
      expect(sidebar.formatDueDate(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(sidebar.formatDueDate(undefined)).toBe("");
    });

    it("returns empty string for empty string", () => {
      expect(sidebar.formatDueDate("")).toBe("");
    });

    it("labels overdue dates with days count", () => {
      expect(sidebar.formatDueDate("2026-02-22")).toBe("2d overdue");
    });

    it("labels single day overdue", () => {
      expect(sidebar.formatDueDate("2026-02-23")).toBe("1d overdue");
    });

    it("labels today", () => {
      expect(sidebar.formatDueDate("2026-02-24")).toBe("today");
    });

    it("labels tomorrow", () => {
      expect(sidebar.formatDueDate("2026-02-25")).toBe("tomorrow");
    });

    it("formats future dates with month and day", () => {
      const result = sidebar.formatDueDate("2026-02-28");
      expect(result).toContain("28");
    });
  });

  describe("renderTaskItem", () => {
    it("escapes task title", () => {
      const html = sidebar.renderTaskItem(
        { id: 1, title: "<img onerror=alert(1)>", priority: "high" },
        "today",
      );
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img onerror=alert(1)&gt;");
    });

    it("escapes project name", () => {
      const html = sidebar.renderTaskItem(
        {
          id: 1,
          title: "Task",
          priority: "low",
          project_name: "<b>evil</b>",
        },
        "today",
      );
      expect(html).not.toContain("<b>evil</b>");
      expect(html).toContain("&lt;b&gt;evil&lt;/b&gt;");
    });

    it("generates correct task URL for numeric id", () => {
      const html = sidebar.renderTaskItem(
        { id: 42, title: "Task", priority: "medium" },
        "today",
      );
      expect(html).toContain(
        'href="https://nexus.brooksmcmillin.com/task/42"',
      );
    });

    it("falls back to APP_BASE for non-numeric id", () => {
      const html = sidebar.renderTaskItem(
        { id: "abc", title: "Task", priority: "medium" },
        "today",
      );
      expect(html).toContain('href="https://nexus.brooksmcmillin.com"');
    });

    it("uses DEFAULT_PRIORITY when task has no priority", () => {
      const html = sidebar.renderTaskItem(
        { id: 1, title: "Task" },
        "today",
      );
      expect(html).toContain("priority-dot medium");
    });

    it("includes due date when present", () => {
      const html = sidebar.renderTaskItem(
        { id: 1, title: "Task", priority: "high", due_date: "2026-02-24" },
        "today",
      );
      expect(html).toContain("today");
    });

    it("omits meta section when no project or date", () => {
      const html = sidebar.renderTaskItem(
        { id: 1, title: "Task", priority: "low" },
        "today",
      );
      expect(html).not.toContain("task-meta");
    });

    it("includes data-task-id attribute", () => {
      const html = sidebar.renderTaskItem(
        { id: 99, title: "Task", priority: "medium" },
        "today",
      );
      expect(html).toContain('data-task-id="99"');
    });

    it("escapes malicious priority value in class attribute", () => {
      const html = sidebar.renderTaskItem(
        { id: 1, title: "Task", priority: '"><img src=x onerror=alert(1)>' },
        "today",
      );
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img");
    });

    it("includes complete button with source", () => {
      const html = sidebar.renderTaskItem(
        { id: 1, title: "Task", priority: "medium" },
        "overdue",
      );
      expect(html).toContain('data-source="overdue"');
    });
  });

  describe("completeTask", () => {
    function makeTaskDOM(taskId) {
      const container = document.getElementById("tasks");
      container.innerHTML = sidebar.renderTaskItem(
        { id: taskId, title: "Test Task", priority: "medium" },
        "today",
      );
      sidebar.bindCompleteBtns(container);
      return container.querySelector(".task-row");
    }

    function makeEvent(target) {
      return {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target,
      };
    }

    it("prevents duplicate submissions", async () => {
      const row = makeTaskDOM(42);
      const btn = row.querySelector(".complete-btn");
      mockPostJson.mockReturnValue(new Promise(() => {}));

      sidebar.completeTask(makeEvent(btn), 42, "today");
      sidebar.completeTask(makeEvent(btn), 42, "today");

      expect(mockPostJson).toHaveBeenCalledTimes(1);
    });

    it("adds completing class during request", () => {
      const row = makeTaskDOM(42);
      const btn = row.querySelector(".complete-btn");
      mockPostJson.mockReturnValue(new Promise(() => {}));

      sidebar.completeTask(makeEvent(btn), 42, "today");

      expect(row.classList.contains("completing")).toBe(true);
    });

    it("removes task row on success", async () => {
      const row = makeTaskDOM(42);
      const btn = row.querySelector(".complete-btn");
      mockPostJson.mockResolvedValue({ success: true });

      await sidebar.completeTask(makeEvent(btn), 42, "today");

      expect(document.querySelector(".task-row")).toBeNull();
    });

    it("shows empty state when last task is completed", async () => {
      const row = makeTaskDOM(42);
      const btn = row.querySelector(".complete-btn");
      document.getElementById("task-count").textContent = "1";
      mockPostJson.mockResolvedValue({ success: true });

      await sidebar.completeTask(makeEvent(btn), 42, "today");

      expect(document.getElementById("tasks").innerHTML).toContain(
        "Nothing due today",
      );
      expect(document.getElementById("task-count").textContent).toBe("0");
    });

    it("rolls back on error", async () => {
      const row = makeTaskDOM(42);
      const btn = row.querySelector(".complete-btn");
      mockPostJson.mockRejectedValue(new Error("fail"));

      await sidebar.completeTask(makeEvent(btn), 42, "today");

      expect(document.querySelector(".task-row")).not.toBeNull();
      expect(row.classList.contains("completing")).toBe(false);
      expect(row.classList.contains("complete-error")).toBe(true);
    });

    it("clears completingTasks set after success", async () => {
      const row = makeTaskDOM(42);
      const btn = row.querySelector(".complete-btn");
      mockPostJson.mockResolvedValue({ success: true });

      await sidebar.completeTask(makeEvent(btn), 42, "today");

      expect(sidebar.completingTasks.has(42)).toBe(false);
    });

    it("clears completingTasks set after error", async () => {
      const row = makeTaskDOM(42);
      const btn = row.querySelector(".complete-btn");
      mockPostJson.mockRejectedValue(new Error("fail"));

      await sidebar.completeTask(makeEvent(btn), 42, "today");

      expect(sidebar.completingTasks.has(42)).toBe(false);
    });

    it("calls postJson with correct URL", async () => {
      const row = makeTaskDOM(42);
      const btn = row.querySelector(".complete-btn");
      mockPostJson.mockResolvedValue({ success: true });

      await sidebar.completeTask(makeEvent(btn), 42, "today");

      expect(mockPostJson).toHaveBeenCalledWith(
        "https://api.nexus.brooksmcmillin.com/api/todos/42/complete",
        {},
      );
    });
  });

  describe("loadTasks", () => {
    it("renders today tasks", async () => {
      mockFetchJson
        .mockResolvedValueOnce({
          data: [{ id: 1, title: "Buy milk", priority: "high" }],
        })
        .mockResolvedValueOnce({ data: [] });

      await sidebar.loadTasks();

      const container = document.getElementById("tasks");
      expect(container.querySelectorAll(".task-row").length).toBe(1);
      expect(container.textContent).toContain("Buy milk");
    });

    it("renders overdue section with label", async () => {
      mockFetchJson
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({
          data: [
            {
              id: 2,
              title: "Overdue task",
              priority: "urgent",
              due_date: "2026-02-20",
            },
          ],
        });

      await sidebar.loadTasks();

      const container = document.getElementById("tasks");
      expect(container.querySelector(".overdue-section")).not.toBeNull();
      expect(
        container.querySelector(".section-label.overdue").textContent,
      ).toBe("Overdue");
    });

    it("shows Today label when both sections present", async () => {
      mockFetchJson
        .mockResolvedValueOnce({
          data: [{ id: 1, title: "Today task", priority: "medium" }],
        })
        .mockResolvedValueOnce({
          data: [
            {
              id: 2,
              title: "Overdue task",
              priority: "high",
              due_date: "2026-02-20",
            },
          ],
        });

      await sidebar.loadTasks();

      const labels = document.querySelectorAll(".section-label");
      expect(labels.length).toBe(2);
      expect(labels[0].textContent).toBe("Overdue");
      expect(labels[1].textContent).toBe("Today");
    });

    it("shows empty state when no tasks", async () => {
      mockFetchJson
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      await sidebar.loadTasks();

      expect(document.getElementById("tasks").innerHTML).toContain(
        "Nothing due today",
      );
      expect(document.getElementById("task-count").textContent).toBe("0");
    });

    it("shows error state on fetch failure", async () => {
      mockFetchJson.mockRejectedValue(new Error("network"));

      await sidebar.loadTasks();

      expect(document.getElementById("tasks").innerHTML).toContain(
        "Could not load tasks",
      );
    });

    it("increments consecutiveFailures on error", async () => {
      sidebar.consecutiveFailures = 0;
      mockFetchJson.mockRejectedValue(new Error("fail"));

      await sidebar.loadTasks();

      expect(sidebar.consecutiveFailures).toBe(1);
    });

    it("resets consecutiveFailures on success", async () => {
      sidebar.consecutiveFailures = 3;
      mockFetchJson
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      await sidebar.loadTasks();

      expect(sidebar.consecutiveFailures).toBe(0);
    });

    it("updates task count badge", async () => {
      mockFetchJson
        .mockResolvedValueOnce({
          data: [
            { id: 1, title: "A", priority: "low" },
            { id: 2, title: "B", priority: "low" },
          ],
        })
        .mockResolvedValueOnce({
          data: [
            { id: 3, title: "C", priority: "high", due_date: "2026-02-20" },
          ],
        });

      await sidebar.loadTasks();

      expect(document.getElementById("task-count").textContent).toBe("3");
    });

    it("deduplicates overdue tasks due today", async () => {
      mockFetchJson
        .mockResolvedValueOnce({
          data: [{ id: 1, title: "Today", priority: "medium" }],
        })
        .mockResolvedValueOnce({
          data: [
            { id: 2, title: "Excluded", priority: "low", due_date: "2026-02-24" },
            { id: 3, title: "Real overdue", priority: "high", due_date: "2026-02-01" },
          ],
        });

      await sidebar.loadTasks();

      const rows = document.querySelectorAll(".task-row");
      expect(rows.length).toBe(2);
      expect(document.getElementById("task-count").textContent).toBe("2");
    });

    it("binds complete buttons after rendering", async () => {
      mockFetchJson
        .mockResolvedValueOnce({
          data: [{ id: 1, title: "Task", priority: "medium" }],
        })
        .mockResolvedValueOnce({ data: [] });
      mockPostJson.mockResolvedValue({ success: true });

      await sidebar.loadTasks();

      document.querySelector(".complete-btn").click();

      expect(mockPostJson).toHaveBeenCalledWith(
        "https://api.nexus.brooksmcmillin.com/api/todos/1/complete",
        {},
      );
    });
  });

  describe("bindCompleteBtns", () => {
    it("attaches click handlers to complete buttons", () => {
      const container = document.getElementById("tasks");
      container.innerHTML = sidebar.renderTaskItem(
        { id: 7, title: "Task", priority: "medium" },
        "today",
      );
      sidebar.bindCompleteBtns(container);
      mockPostJson.mockResolvedValue({ success: true });

      container.querySelector(".complete-btn").click();

      expect(mockPostJson).toHaveBeenCalledWith(
        "https://api.nexus.brooksmcmillin.com/api/todos/7/complete",
        {},
      );
    });
  });
});
