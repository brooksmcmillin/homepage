const API_BASE = "https://todo.brooksmcmillin.com/api";
const DEFAULT_PRIORITY = "medium";
const MAX_BACKOFF_MULTIPLIER = 8;

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchJson(url) {
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
