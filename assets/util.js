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

// Every skip `reason` the scorer can write (scripts/score_job_llm.js /
// .claude/agents/scorer.md) falls into one of two kinds:
//  - "filter": a rule-based hard filter or deal-breaker (Steps 0/1) — the
//    reason code itself is the whole explanation, no LLM judgment involved.
//  - "llm": low_fit (Step 3) — a genuine model judgment call, where
//    fit_rationale carries the actual reasoning worth showing.
export const SKIP_REASON_META = {
  hard_filter_location: { label: "Hard filter: location / remote-residency mismatch", kind: "filter" },
  hard_filter_stack_mismatch: { label: "Hard filter: non-frontend stack in title (e.g. Java, Backend, DevOps)", kind: "filter" },
  dealbreaker_bond: { label: "Deal-breaker: bond / service agreement", kind: "filter" },
  dealbreaker_contract: { label: "Deal-breaker: contract / C2H / fixed-term", kind: "filter" },
  dealbreaker_relocation: { label: "Deal-breaker: relocation required", kind: "filter" },
  dealbreaker_office_days: { label: "Deal-breaker: on-site days over limit", kind: "filter" },
  dealbreaker_salary: { label: "Deal-breaker: salary below minimum", kind: "filter" },
  low_fit: { label: "Low fit score", kind: "llm" },
};

export function skipReasonMeta(reason) {
  return SKIP_REASON_META[reason] || { label: reason || "Unspecified", kind: "llm" };
}

// Every `result_reason` written for a manual_required / awaiting_human_submit
// job (interactive applier.md, headless scripts/apply_job.js — one shared
// vocabulary for both paths) falls into one of three kinds:
//  - "tooling": a systemic/technical failure with no human judgment call at
//    all — CAPTCHA, a blocked page, a broken upload widget, an exhausted LLM
//    budget, a call that errored. Usually self-heals (retry, quota reset) or
//    signals a real bug worth looking at, not "the applicant needs to decide
//    something."
//  - "human": something only a person can resolve (an account/login wall, a
//    question the LLM genuinely couldn't answer confidently).
//  - "design": not a failure at all — the job stopped exactly where it was
//    supposed to (a gated portal's intentional hand-off, or a deliberate
//    dry run).
export const RESULT_REASON_META = {
  job_description_missing: { label: "No job description available; not scored", kind: "human" },
  captcha_blocked: { label: "CAPTCHA blocked", kind: "tooling" },
  page_blocked: { label: "Page blocked (bot detection / HTTP error)", kind: "tooling" },
  upload_tool_error: { label: "Resume upload failed", kind: "tooling" },
  submit_button_not_found: { label: "Submit button not found", kind: "tooling" },
  submission_unconfirmed: { label: "Submission could not be confirmed; check the application status", kind: "human" },
  unextracted_required_field: { label: "Possible missed required field (safety check)", kind: "tooling" },
  required_field_not_filled: { label: "Required form field is blank or invalid", kind: "tooling" },
  llm_budget_exhausted: { label: "LLM budget exhausted", kind: "tooling" },
  llm_call_failed: { label: "LLM call failed", kind: "tooling" },
  account_wall: { label: "Account / login wall", kind: "human" },
  unanswerable_required_field: { label: "Unanswerable required field", kind: "human" },
  gated_portal_handoff: { label: "Gated portal — awaiting your review", kind: "design" },
  dry_run_stopped_before_submit: { label: "Dry run — stopped before submit", kind: "design" },
};

export function resultReasonMeta(reason) {
  if (RESULT_REASON_META[reason]) return RESULT_REASON_META[reason];
  // Fallback for older, pre-taxonomy reason strings (the interactive
  // applier used to write a full freeform sentence, not a short code, e.g.
  // "too_many_fields: Greenhouse form has ~16 required fields, exceeds
  // external_form_max_fields=15; also..."). Truncated so one long legacy
  // string can't blow out the toolbar's <select> width, a row's reason
  // hint, or a stat tile — the full, untruncated text still always shows
  // in the job detail panel below.
  const raw = reason || "Unspecified";
  const label = raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
  return { label, kind: "human" };
}

// Human-readable label for a job/run's workflow_type: "claude-browser" (the
// interactive session driving Chrome) or "apify-<actor>" (the headless
// GitHub Actions pipeline calling an Apify actor's API).
export function sourceLabel(workflowType) {
  if (!workflowType) return "—";
  if (workflowType === "claude-browser") return "Claude Browser";
  const m = workflowType.match(/^apify-(.+)$/);
  if (m) return `Apify: ${m[1]}`;
  return workflowType;
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

export const DATE_PRESETS = [
  "last7", "today", "yesterday", "thisWeek", "lastWeek", "thisMonth", "lastMonth", "last30", "all", "custom"
];

export const DATE_PRESET_LABELS = {
  last7: "Last 7 days",
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  lastWeek: "Last week",
  thisMonth: "This month",
  lastMonth: "Last month",
  last30: "Last 30 days",
  all: "All time",
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
    case "thisWeek": {
      const day = now.getDay();
      const diffToMon = (day === 0 ? -6 : 1) - day;
      const mon = new Date(now);
      mon.setDate(now.getDate() + diffToMon);
      return { start: startOfDay(mon), end: endOfDay(now) };
    }
    case "lastWeek": {
      const day = now.getDay();
      const diffToLastMon = (day === 0 ? -6 : 1) - day - 7;
      const lastMon = new Date(now);
      lastMon.setDate(now.getDate() + diffToLastMon);
      const lastSun = new Date(lastMon);
      lastSun.setDate(lastMon.getDate() + 6);
      return { start: startOfDay(lastMon), end: endOfDay(lastSun) };
    }
    case "thisMonth": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: startOfDay(start), end: endOfDay(now) };
    }
    case "lastMonth": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: startOfDay(start), end: endOfDay(end) };
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
