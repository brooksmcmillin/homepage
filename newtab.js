const API_BASE = "https://todo.brooksmcmillin.com/api";
const APP_BASE = "https://todo.brooksmcmillin.com";

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
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
  return el.innerHTML;
}

// Header

function renderHeader() {
  const hour = new Date().getHours();
  let greeting;
  if (hour < 12) greeting = "Good morning";
  else if (hour < 17) greeting = "Good afternoon";
  else greeting = "Good evening";

  document.getElementById("greeting").textContent = greeting;
  document.getElementById("date").textContent = new Date().toLocaleDateString(
    undefined,
    { weekday: "long", year: "numeric", month: "long", day: "numeric" }
  );
}

// Tasks

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
  const status = task.status || "pending";
  const tags = (task.tags || [])
    .map((t) => `<span class="task-tag">${escapeHtml(t)}</span>`)
    .join("");

  const metaParts = [];
  if (task.project_name) {
    metaParts.push(`<span class="task-project">${escapeHtml(task.project_name)}</span>`);
  }
  if (task.due_date) {
    const formatted = formatDueDate(task.due_date);
    metaParts.push(`<span>${escapeHtml(formatted)}</span>`);
  }

  const taskUrl = `${APP_BASE}/task/${task.id}`;

  return `
    <a class="task-item" href="${escapeHtml(taskUrl)}" target="_blank" rel="noopener">
      <span class="priority-dot ${priority}"></span>
      <div class="task-content">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          <span class="task-status ${status}">${escapeHtml(status.replace("_", " "))}</span>
          ${metaParts.join('<span>&middot;</span>')}
          ${tags}
        </div>
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
      html += '<div class="overdue-label">Overdue</div>';
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
    container.innerHTML = `<div class="error-state">Could not load tasks</div>`;
    console.error("Tasks fetch error:", err);
  }
}

// Articles

let feedFilter = localStorage.getItem("feedFilter") || "featured";

async function fetchArticles() {
  const params = new URLSearchParams({ limit: "30", unread_only: "true" });
  if (feedFilter === "featured") {
    params.set("featured", "true");
  }
  const resp = await fetch(`${API_BASE}/news?${params}`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(`${resp.status}`);
  return resp.json();
}

function renderArticleItem(article) {
  const isRead = article.is_read || false;
  const feedType = article.feed_type || "article";
  const source = article.feed_source_name || "";
  const time = timeAgo(article.published_at || article.fetched_at);

  let summary = "";
  if (article.summary) {
    summary = `<div class="article-summary">${escapeHtml(article.summary)}</div>`;
  }

  return `
    <a class="article-item ${isRead ? "read" : ""}" href="${escapeHtml(article.url)}" target="_blank" rel="noopener">
      <div class="article-title">${escapeHtml(article.title)}</div>
      ${summary}
      <div class="article-meta">
        <span class="feed-type ${feedType}">${escapeHtml(feedType)}</span>
        <span class="article-source">${escapeHtml(source)}</span>
        <span>${escapeHtml(time)}</span>
      </div>
    </a>
  `;
}

async function loadArticles() {
  const container = document.getElementById("articles");
  const countBadge = document.getElementById("article-count");

  try {
    const result = await fetchArticles();
    const articles = result.data || [];

    countBadge.textContent = articles.length;

    if (articles.length === 0) {
      container.innerHTML = '<div class="empty-state">No unread articles</div>';
      return;
    }

    container.innerHTML = articles.map(renderArticleItem).join("");
  } catch (err) {
    container.innerHTML = `<div class="error-state">Could not load feed</div>`;
    console.error("Articles fetch error:", err);
  }
}

// Feed toggle

function initFeedToggle() {
  const toggle = document.getElementById("feed-toggle");
  const buttons = toggle.querySelectorAll(".feed-toggle-btn");

  // Set initial active state from stored preference
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.feedFilter === feedFilter);
  });

  toggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".feed-toggle-btn");
    if (!btn || btn.dataset.feedFilter === feedFilter) return;

    feedFilter = btn.dataset.feedFilter;
    localStorage.setItem("feedFilter", feedFilter);

    buttons.forEach((b) => {
      b.classList.toggle("active", b.dataset.feedFilter === feedFilter);
    });

    loadArticles();
  });
}

// Init

renderHeader();
initFeedToggle();
loadTasks();
loadArticles();
