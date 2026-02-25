const APP_BASE = "https://todo.brooksmcmillin.com";

let showFeaturedOnly = true;
const completingTasks = new Set();

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getDateString() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const now = new Date();
  const then = new Date(dateStr);
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  return el.innerHTML.replace(/"/g, "&quot;");
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : "#";
  } catch {
    return "#";
  }
}

function renderTaskItem(task, source) {
  const priority = task.priority || DEFAULT_PRIORITY;
  const taskId = Number(task.id);
  const taskUrl = Number.isFinite(taskId) ? `${APP_BASE}/task/${taskId}` : APP_BASE;
  const status = task.status || "pending";

  const metaParts = [];
  metaParts.push(
    `<span class="task-status ${escapeHtml(status)}">${escapeHtml(status.replaceAll("_", " "))}</span>`
  );
  if (task.project_name) {
    metaParts.push(`<span class="task-project">${escapeHtml(task.project_name)}</span>`);
  }
  if (source === "overdue" && task.due_date) {
    metaParts.push(`<span>${escapeHtml(formatDueDate(task.due_date))}</span>`);
  }
  if (task.tags) {
    for (const tag of task.tags) {
      metaParts.push(`<span class="task-tag">${escapeHtml(tag)}</span>`);
    }
  }

  return `
    <div class="task-row" data-task-id="${taskId}">
      <button class="complete-btn" data-source="${source}" title="Mark complete"></button>
      <a class="task-item" href="${escapeHtml(taskUrl)}" target="_blank" rel="noopener">
        <span class="priority-dot ${escapeHtml(priority)}"></span>
        <div class="task-content">
          <div class="task-title">${escapeHtml(task.title)}</div>
          ${metaParts.length ? `<div class="task-meta">${metaParts.join("")}</div>` : ""}
        </div>
      </a>
    </div>
  `;
}

function renderArticleItem(article) {
  const readClass = article.is_read ? " read" : "";
  return `
    <a class="article-item${readClass}" href="${escapeHtml(safeUrl(article.url))}" target="_blank" rel="noopener">
      <div class="article-title">${escapeHtml(article.title)}</div>
      ${article.summary ? `<div class="article-summary">${escapeHtml(article.summary)}</div>` : ""}
      <div class="article-meta">
        <span class="article-source">${escapeHtml(article.feed_source_name || "")}</span>
        <span>${escapeHtml(timeAgo(article.published_at))}</span>
      </div>
    </a>
  `;
}

function bindCompleteBtns(container) {
  container.querySelectorAll(".complete-btn").forEach((btn) => {
    const row = btn.closest(".task-row");
    const taskId = Number(row.dataset.taskId);
    btn.addEventListener("click", (e) => completeTask(e, taskId));
  });
}

async function completeTask(event, taskId) {
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

    const overdueSection = container.querySelector(".overdue-section");
    if (overdueSection && overdueSection.querySelectorAll(".task-row").length === 0) {
      overdueSection.remove();
    }

    const remaining = container.querySelectorAll(".task-row").length;
    document.getElementById("task-count").textContent = remaining;

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
    const overdueTasks = (overdueResult.data || []).filter((t) => t.due_date !== today);
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
    container.innerHTML = '<div class="error-state">Could not load tasks</div>';
    console.error("Tasks fetch error:", err);
  }
}

async function loadArticles(featured) {
  const container = document.getElementById("articles");
  const countBadge = document.getElementById("article-count");

  countBadge.textContent = "";
  container.innerHTML = `
    <div class="skeleton-loader">
      <div class="skeleton-line"></div>
      <div class="skeleton-line short"></div>
      <div class="skeleton-line"></div>
    </div>
  `;

  try {
    const params = new URLSearchParams({ limit: "30", unread_only: "true" });
    if (featured) params.set("featured", "true");

    const result = await fetchJson(`${API_BASE}/news?${params}`);
    const articles = result.data || [];

    countBadge.textContent = articles.length;

    if (articles.length === 0) {
      container.innerHTML = '<div class="empty-state">No unread articles</div>';
      return;
    }

    container.innerHTML = articles.map(renderArticleItem).join("");
  } catch (err) {
    container.innerHTML = '<div class="error-state">Could not load feed</div>';
    console.error("Articles fetch error:", err);
  }
}

function toggleFeatured(featured) {
  if (showFeaturedOnly === featured) return;
  showFeaturedOnly = featured;

  document.getElementById("btn-featured").classList.toggle("active", featured);
  document.getElementById("btn-all").classList.toggle("active", !featured);

  loadArticles(featured);
}

// Init
document.getElementById("greeting").textContent = getGreeting();
const dateEl = document.getElementById("date-string");
dateEl.textContent = getDateString();
dateEl.setAttribute("datetime", todayStr());

document.getElementById("btn-featured").addEventListener("click", () => toggleFeatured(true));
document.getElementById("btn-all").addEventListener("click", () => toggleFeatured(false));

loadTasks();
loadArticles(showFeaturedOnly);
