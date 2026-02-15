const API_BASE = "https://todo.brooksmcmillin.com/api";
const APP_BASE = "https://todo.brooksmcmillin.com";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

async function fetchTodayTasks() {
  const today = todayStr();
  const params = new URLSearchParams({ start_date: today, end_date: today });
  const resp = await fetch(`${API_BASE}/todos?${params}`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(`${resp.status}`);
  return resp.json();
}

async function fetchOverdueTasks() {
  const params = new URLSearchParams({ status: "overdue" });
  const resp = await fetch(`${API_BASE}/todos?${params}`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(`${resp.status}`);
  return resp.json();
}

function renderTaskItem(task) {
  const priority = task.priority || "medium";
  const taskUrl = `${APP_BASE}/task/${task.id}`;

  const metaParts = [];
  if (task.project_name) {
    metaParts.push(`<span class="task-project">${escapeHtml(task.project_name)}</span>`);
  }
  if (task.due_date) {
    metaParts.push(`<span>${escapeHtml(formatDueDate(task.due_date))}</span>`);
  }

  return `
    <a class="task-item" href="${escapeHtml(taskUrl)}" target="_blank" rel="noopener">
      <span class="priority-dot ${priority}"></span>
      <div class="task-content">
        <div class="task-title">${escapeHtml(task.title)}</div>
        ${metaParts.length ? `<div class="task-meta">${metaParts.join('<span>&middot;</span>')}</div>` : ""}
      </div>
    </a>
  `;
}

async function loadTasks() {
  const container = document.getElementById("tasks");
  const countBadge = document.getElementById("task-count");

  try {
    const [todayResult, overdueResult] = await Promise.all([
      fetchTodayTasks(),
      fetchOverdueTasks(),
    ]);

    const todayTasks = todayResult.data || [];
    const overdueTasks = (overdueResult.data || []).filter(
      (t) => t.due_date !== todayStr()
    );
    const total = todayTasks.length + overdueTasks.length;

    countBadge.textContent = total;

    if (total === 0) {
      container.innerHTML = '<div class="empty-state">Nothing due today</div>';
      return;
    }

    let html = "";

    if (overdueTasks.length > 0) {
      html += '<div class="overdue-section">';
      html += '<div class="section-label overdue">Overdue</div>';
      html += overdueTasks.map(renderTaskItem).join("");
      html += "</div>";
    }

    if (todayTasks.length > 0) {
      if (overdueTasks.length > 0) {
        html += '<div class="section-label">Today</div>';
      }
      html += todayTasks.map(renderTaskItem).join("");
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="error-state">Could not load tasks</div>';
    console.error("Sidebar tasks fetch error:", err);
  }
}

loadTasks();
setInterval(loadTasks, REFRESH_INTERVAL_MS);
