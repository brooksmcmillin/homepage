const APP_BASE = "https://api.nexus.brooksmcmillin.com";

let showFeaturedOnly = true;
const completingTasks = new Set();

// Keep article data in memory for bookmark toggling and read tracking
let articlesData = [];

const DEADLINE_TYPES = {
  flexible: { label: "Flexible", cls: "flexible" },
  preferred: { label: "Preferred", cls: "preferred" },
  firm: { label: "Firm", cls: "firm" },
  hard: { label: "Hard", cls: "hard" },
};

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

// Toast notification system
function showToast(message, duration, action) {
  const container = document.getElementById("toasts");
  const toast = document.createElement("div");
  toast.className = "toast";

  let html = '<span class="toast-icon">&#10003;</span>';
  html += `<span class="toast-message">${escapeHtml(message)}</span>`;
  if (action) {
    html += `<button class="toast-action">${escapeHtml(action.label)}</button>`;
  }
  html += '<button class="toast-dismiss">&times;</button>';
  toast.innerHTML = html;

  const dismiss = () => {
    toast.classList.add("removing");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  };

  toast.querySelector(".toast-dismiss").addEventListener("click", dismiss);
  if (action) {
    toast.querySelector(".toast-action").addEventListener("click", () => {
      action.callback();
      dismiss();
    });
  }

  container.appendChild(toast);
  if (duration) {
    setTimeout(dismiss, duration);
  }
}

const BOOKMARK_FILLED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">' +
  '<path fill-rule="evenodd" d="M10 2c-1.716 0-3.408.106-5.07.31C3.806 2.45 3 3.414 3 4.517V17.25a.75.75 0 001.075.676L10 15.082l5.925 2.844A.75.75 0 0017 17.25V4.517c0-1.103-.806-2.068-1.93-2.207A41.403 41.403 0 0010 2z" clip-rule="evenodd"/>' +
  "</svg>";

const BOOKMARK_OUTLINE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">' +
  '<path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"/>' +
  "</svg>";

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
    metaParts.push(`<span>&middot;</span>`);
    metaParts.push(`<span>${escapeHtml(formatDueDate(task.due_date))}</span>`);
  }
  if (task.deadline_type && task.deadline_type !== "preferred") {
    const dt = DEADLINE_TYPES[task.deadline_type];
    if (dt) {
      metaParts.push(`<span class="deadline-type-pill ${escapeHtml(dt.cls)}">${escapeHtml(dt.label)}</span>`);
    }
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
    <div class="article-row${readClass}" data-article-id="${Number(article.id)}">
      <a class="article-item" href="${escapeHtml(safeUrl(article.url))}" target="_blank" rel="noopener">
        <div class="article-title">${escapeHtml(article.title)}</div>
        ${article.summary ? `<div class="article-summary">${escapeHtml(article.summary)}</div>` : ""}
        <div class="article-meta">
          <span class="article-source">${escapeHtml(article.feed_source_name || "")}</span>
          <span>${escapeHtml(timeAgo(article.published_at))}</span>
        </div>
      </a>
      <button class="bookmark-btn${article.is_bookmarked ? " bookmarked" : ""}" title="${article.is_bookmarked ? "Remove bookmark" : "Save for later"}">
        ${article.is_bookmarked ? BOOKMARK_FILLED_SVG : BOOKMARK_OUTLINE_SVG}
      </button>
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

function bindArticleHandlers(container) {
  container.querySelectorAll(".article-row").forEach((row) => {
    const articleId = Number(row.dataset.articleId);
    const article = articlesData.find((a) => Number(a.id) === articleId);
    if (!article) return;

    // Mark as read on click
    const link = row.querySelector(".article-item");
    link.addEventListener("click", () => {
      if (!article.is_read) {
        article.is_read = true;
        row.classList.add("read");
        postJson(`${API_BASE}/news/${articleId}/read`, { is_read: true }).catch(() => {
          article.is_read = false;
          row.classList.remove("read");
        });
      }
    });

    // Bookmark toggle
    const bookmarkBtn = row.querySelector(".bookmark-btn");
    bookmarkBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (bookmarkBtn.dataset.pending) return;
      bookmarkBtn.dataset.pending = "1";
      const newState = !article.is_bookmarked;
      article.is_bookmarked = newState;
      bookmarkBtn.classList.toggle("bookmarked", newState);
      bookmarkBtn.innerHTML = newState ? BOOKMARK_FILLED_SVG : BOOKMARK_OUTLINE_SVG;
      bookmarkBtn.title = newState ? "Remove bookmark" : "Save for later";

      postJson(`${API_BASE}/news/${articleId}/bookmark`, { is_bookmarked: newState })
        .catch(() => {
          article.is_bookmarked = !newState;
          bookmarkBtn.classList.toggle("bookmarked", !newState);
          bookmarkBtn.innerHTML = !newState ? BOOKMARK_FILLED_SVG : BOOKMARK_OUTLINE_SVG;
          bookmarkBtn.title = !newState ? "Remove bookmark" : "Save for later";
        })
        .finally(() => {
          delete bookmarkBtn.dataset.pending;
        });
    });
  });
}

// Keep task data in memory for undo support
let todayTasksData = [];
let overdueTasksData = [];

async function completeTask(event, taskId, source) {
  event.preventDefault();
  event.stopPropagation();
  if (completingTasks.has(taskId)) return;
  completingTasks.add(taskId);

  const item = event.target.closest(".task-row");
  if (item) item.classList.add("completing");

  try {
    const removedTask = source === "today"
      ? todayTasksData.find((t) => Number(t.id) === taskId)
      : overdueTasksData.find((t) => Number(t.id) === taskId);

    await postJson(`${API_BASE}/todos/${taskId}/complete`, {});
    if (item) item.remove();

    if (source === "today") {
      todayTasksData = todayTasksData.filter((t) => Number(t.id) !== taskId);
    } else {
      overdueTasksData = overdueTasksData.filter((t) => Number(t.id) !== taskId);
    }

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

    showToast("Task completed", 5000, {
      label: "Undo",
      callback: async () => {
        try {
          await putJson(`${API_BASE}/todos/${taskId}`, { status: "pending" });
          if (removedTask) {
            const restored = { ...removedTask, status: "pending" };
            if (source === "today") {
              todayTasksData.push(restored);
            } else {
              overdueTasksData.push(restored);
            }
            rerenderTasks();
          }
        } catch {
          showToast("Failed to undo completion", 3000);
        }
      },
    });
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

function rerenderTasks() {
  const container = document.getElementById("tasks");
  const total = todayTasksData.length + overdueTasksData.length;
  document.getElementById("task-count").textContent = total;

  if (total === 0) {
    container.innerHTML = '<div class="empty-state">Nothing due today</div>';
    return;
  }

  let html = "";
  if (overdueTasksData.length > 0) {
    html += '<div class="overdue-section">';
    html += '<div class="section-label overdue">Overdue</div>';
    html += overdueTasksData.map((t) => renderTaskItem(t, "overdue")).join("");
    html += "</div>";
  }
  if (todayTasksData.length > 0) {
    if (overdueTasksData.length > 0) {
      html += '<div class="section-label">Today</div>';
    }
    html += todayTasksData.map((t) => renderTaskItem(t, "today")).join("");
  }
  container.innerHTML = html;
  bindCompleteBtns(container);
}

async function loadTasks() {
  const container = document.getElementById("tasks");
  const countBadge = document.getElementById("task-count");

  try {
    const today = todayStr();
    const [todayResult, overdueResult] = await Promise.all([
      fetchJson(`${API_BASE}/todos?${new URLSearchParams({ start_date: today, end_date: today, exclude_no_calendar: "true", status: "pending" })}`),
      fetchJson(`${API_BASE}/todos?${new URLSearchParams({ status: "overdue", exclude_no_calendar: "true" })}`),
    ]);

    todayTasksData = todayResult.data || [];
    overdueTasksData = (overdueResult.data || []).filter((t) => t.due_date !== today);
    rerenderTasks();
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
    articlesData = result.data || [];

    countBadge.textContent = articlesData.length;

    if (articlesData.length === 0) {
      container.innerHTML = '<div class="empty-state">No unread articles</div>';
      return;
    }

    container.innerHTML = articlesData.map(renderArticleItem).join("");
    bindArticleHandlers(container);
  } catch (err) {
    container.innerHTML = '<div class="error-state">Could not load feed</div>';
    console.error("Articles fetch error:", err);
  }
}

async function loadStats() {
  try {
    const result = await fetchJson(`${API_BASE}/news/stats`);
    const stats = result.data;
    if (!stats) return;

    const bar = document.getElementById("stats-bar");
    document.getElementById("stat-streak").textContent = `${stats.streak_days}d`;
    if (stats.streak_days > 0) {
      document.getElementById("stat-streak").classList.add("streak-active");
    }
    document.getElementById("stat-today").textContent = stats.articles_read_today;
    document.getElementById("stat-week").textContent = stats.articles_read_this_week;
    document.getElementById("stat-saved").textContent = stats.total_bookmarked;
    bar.classList.remove("hidden");
  } catch {
    // Stats are optional — silently ignore errors
  }
}

async function loadHighlight() {
  try {
    const result = await fetchJson(`${API_BASE}/news/highlight`);
    const article = result.data;
    if (!article) return;

    const container = document.getElementById("highlight");
    container.innerHTML = `
      <div class="highlight-card">
        <div class="highlight-label">Start here</div>
        <a class="highlight-link" href="${escapeHtml(safeUrl(article.url))}" target="_blank" rel="noopener">${escapeHtml(article.title)}</a>
        <div class="highlight-meta">
          <span class="article-source">${escapeHtml(article.feed_source_name || "")}</span>
          <span>${escapeHtml(timeAgo(article.published_at))}</span>
        </div>
      </div>
    `;

    // Mark as read on click
    const link = container.querySelector(".highlight-link");
    link.addEventListener("click", () => {
      if (!article.is_read) {
        article.is_read = true;
        postJson(`${API_BASE}/news/${Number(article.id)}/read`, { is_read: true }).catch(() => {
          article.is_read = false;
        });
      }
    });
  } catch {
    // Highlight is optional — silently ignore errors
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
loadStats();
loadHighlight();
