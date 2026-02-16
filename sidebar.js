const APP_BASE = "https://todo.brooksmcmillin.com";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let consecutiveFailures = 0;
let refreshTimer = null;
const completingTasks = new Set();

function formatDueDate(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((d - today) / 86400000);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function escapeHtml(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

async function completeTask(event, taskId, source) {
  event.preventDefault();
  event.stopPropagation();
  if (completingTasks.has(taskId)) return;
  completingTasks.add(taskId);

  const item = event.target.closest(".task-row");
  if (item) item.classList.add("completing");

  try {
    await postJson(`${API_BASE}/todos/${taskId}/complete`, {});
    if (item) item.remove();

    const container = document.getElementById("tasks");

    // If overdue section is now empty, remove it
    const overdueSection = container.querySelector(".overdue-section");
    if (overdueSection && overdueSection.querySelectorAll(".task-row").length === 0) {
      overdueSection.remove();
    }

    // Update badge to match remaining tasks in DOM
    const remaining = container.querySelectorAll(".task-row").length;
    document.getElementById("task-count").textContent = remaining;

    // If no tasks left at all, show empty state
    if (remaining === 0) {
      container.innerHTML = '<div class="empty-state">Nothing due today</div>';
    }
  } catch (err) {
    console.error("Failed to complete task:", err);
    if (item) {
      item.classList.remove("completing");
      item.classList.add("complete-error");
      item.addEventListener("animationend", () => item.classList.remove("complete-error"), { once: true });
    }
  } finally {
    completingTasks.delete(taskId);
  }
}

function renderTaskItem(task, source) {
  const priority = task.priority || DEFAULT_PRIORITY;
  const taskId = Number(task.id);
  const taskUrl = Number.isFinite(taskId) ? `${APP_BASE}/task/${taskId}` : APP_BASE;

  const metaParts = [];
  if (task.project_name) {
    metaParts.push(`<span class="task-project">${escapeHtml(task.project_name)}</span>`);
  }
  if (task.due_date) {
    metaParts.push(`<span>${escapeHtml(formatDueDate(task.due_date))}</span>`);
  }

  return `
    <div class="task-row" data-task-id="${taskId}">
      <button class="complete-btn" data-source="${source}" title="Mark complete"></button>
      <a class="task-item" href="${escapeHtml(taskUrl)}" target="_blank" rel="noopener">
        <span class="priority-dot ${priority}"></span>
        <div class="task-content">
          <div class="task-title">${escapeHtml(task.title)}</div>
          ${metaParts.length ? `<div class="task-meta">${metaParts.join('<span>&middot;</span>')}</div>` : ""}
        </div>
      </a>
    </div>
  `;
}

function bindCompleteBtns(container) {
  container.querySelectorAll(".complete-btn").forEach((btn) => {
    const row = btn.closest(".task-row");
    const taskId = Number(row.dataset.taskId);
    const source = btn.dataset.source;
    btn.addEventListener("click", (e) => completeTask(e, taskId, source));
  });
}

function scheduleNextRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  const multiplier = Math.min(2 ** consecutiveFailures, MAX_BACKOFF_MULTIPLIER);
  refreshTimer = setTimeout(loadTasks, REFRESH_INTERVAL_MS * multiplier);
}

async function loadTasks() {
  const container = document.getElementById("tasks");
  const countBadge = document.getElementById("task-count");

  try {
    const today = todayStr();
    const [todayResult, overdueResult] = await Promise.all([
      fetchJson(`${API_BASE}/todos?${new URLSearchParams({ start_date: today, end_date: today })}`),
      fetchJson(`${API_BASE}/todos?${new URLSearchParams({ status: "overdue" })}`),
    ]);

    const todayTasks = todayResult.data || [];
    const overdueTasks = (overdueResult.data || []).filter(
      (t) => t.due_date !== today
    );
    const total = todayTasks.length + overdueTasks.length;

    consecutiveFailures = 0;
    countBadge.textContent = total;

    if (total === 0) {
      container.innerHTML = '<div class="empty-state">Nothing due today</div>';
      return;
    }

    let html = "";

    if (overdueTasks.length > 0) {
      html += '<div class="overdue-section">';
      html += '<div class="section-label overdue">Overdue</div>';
      html += overdueTasks.map((t) => renderTaskItem(t, "overdue")).join("");
      html += "</div>";
    }

    if (todayTasks.length > 0) {
      if (overdueTasks.length > 0) {
        html += '<div class="section-label">Today</div>';
      }
      html += todayTasks.map((t) => renderTaskItem(t, "today")).join("");
    }

    container.innerHTML = html;
    bindCompleteBtns(container);
  } catch (err) {
    consecutiveFailures++;
    container.innerHTML = '<div class="error-state">Could not load tasks</div>';
    console.error("Sidebar tasks fetch error:", err);
  }

  scheduleNextRefresh();
}

loadTasks();
