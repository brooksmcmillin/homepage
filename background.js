const POLL_INTERVAL_MINUTES = 5;

let consecutiveFailures = 0;

async function fetchTaskCount() {
  const today = todayStr();
  const [todayData, overdueData] = await Promise.all([
    fetchJson(`${API_BASE}/todos?${new URLSearchParams({ start_date: today, end_date: today })}`),
    fetchJson(`${API_BASE}/todos?${new URLSearchParams({ status: "overdue" })}`),
  ]);

  const todayTasks = todayData.data || [];
  const overdueTasks = (overdueData.data || []).filter(
    (t) => t.due_date !== today
  );

  return todayTasks.length + overdueTasks.length;
}

function scheduleNextPoll() {
  const multiplier = Math.min(2 ** consecutiveFailures, MAX_BACKOFF_MULTIPLIER);
  const interval = POLL_INTERVAL_MINUTES * multiplier;
  browser.alarms.create("badge-update", { delayInMinutes: interval });
}

async function updateBadge() {
  try {
    const count = await fetchTaskCount();
    consecutiveFailures = 0;

    browser.browserAction.setBadgeText({ text: count > 0 ? String(count) : "" });
    browser.browserAction.setBadgeBackgroundColor({
      color: count > 0 ? "#2563eb" : "#22c55e",
    });
  } catch (err) {
    consecutiveFailures++;
    console.error("Badge update failed:", err);
    browser.browserAction.setBadgeText({ text: "!" });
    browser.browserAction.setBadgeBackgroundColor({ color: "#6b7280" });
  }

  scheduleNextPoll();
}

// Toggle sidebar on toolbar button click
browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

// Poll on alarm
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "badge-update") {
    updateBadge();
  }
});

// Initial update
updateBadge();
