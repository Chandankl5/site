// Shared date-range, formatting, and status helpers used by jobBoard.js and runsView.js.

export const STATUS_META = {
  applied: { label: "Applied", badge: "badge-applied" },
  awaiting_human_submit: { label: "Awaiting your submit", badge: "badge-awaiting_human_submit" },
  manual_required: { label: "Manual required", badge: "badge-manual_required" },
  skipped: { label: "Skipped", badge: "badge-skipped" },
  error: { label: "Error", badge: "badge-error" },
  email_draft: { label: "Email draft", badge: "badge-email_draft" },
  pending_score: { label: "Pending score", badge: "badge-pending" },
  pending_tailor: { label: "Pending tailor", badge: "badge-pending" },
  pending_apply: { label: "Pending apply", badge: "badge-pending" },
};

export function statusMeta(phase) {
  return STATUS_META[phase] || { label: phase || "Unknown", badge: "badge-pending" };
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export const DATE_PRESETS = ["all", "today", "yesterday", "last7", "last30", "custom"];

export const DATE_PRESET_LABELS = {
  all: "All time",
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  last30: "Last 30 days",
  custom: "Custom range",
};

// Returns {start: Date|null, end: Date|null} for a preset key. null/null means "all time".
export function presetRange(preset, now = new Date()) {
  switch (preset) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    case "last7": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return { start: startOfDay(start), end: endOfDay(now) };
    }
    case "last30": {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return { start: startOfDay(start), end: endOfDay(now) };
    }
    default:
      return { start: null, end: null };
  }
}

export function isWithinRange(iso, range) {
  if (!range || (!range.start && !range.end)) return true;
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d)) return false;
  if (range.start && d < range.start) return false;
  if (range.end && d > range.end) return false;
  return true;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
