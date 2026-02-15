const API_BASE = "https://todo.brooksmcmillin.com/api";
const POLL_INTERVAL_MINUTES = 5;

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchTaskCount() {
  const today = todayStr();
  const [todayResp, overdueResp] = await Promise.all([
    fetch(`${API_BASE}/todos?${new URLSearchParams({ start_date: today, end_date: today })}`, {
      credentials: "include",
    }),
    fetch(`${API_BASE}/todos?${new URLSearchParams({ status: "overdue" })}`, {
      credentials: "include",
    }),
  ]);

  if (!todayResp.ok || !overdueResp.ok) return null;

  const todayData = await todayResp.json();
  const overdueData = await overdueResp.json();

  const todayTasks = todayData.data || [];
  const overdueTasks = (overdueData.data || []).filter(
    (t) => t.due_date !== today
  );

  return todayTasks.length + overdueTasks.length;
}

async function updateBadge() {
  try {
    const count = await fetchTaskCount();
    if (count === null) {
      browser.browserAction.setBadgeText({ text: "!" });
      browser.browserAction.setBadgeBackgroundColor({ color: "#6b7280" });
      return;
    }

    browser.browserAction.setBadgeText({ text: count > 0 ? String(count) : "" });
    browser.browserAction.setBadgeBackgroundColor({
      color: count > 0 ? "#2563eb" : "#22c55e",
    });
  } catch (err) {
    console.error("Badge update failed:", err);
    browser.browserAction.setBadgeText({ text: "!" });
    browser.browserAction.setBadgeBackgroundColor({ color: "#6b7280" });
  }
}

// Toggle sidebar on toolbar button click
browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

// Poll on alarm
browser.alarms.create("badge-update", { periodInMinutes: POLL_INTERVAL_MINUTES });
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "badge-update") {
    updateBadge();
  }
});

// Initial update
updateBadge();
