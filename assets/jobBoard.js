// Job Board: search/filter/sort/date-range list of every job across every
// run, plus the shared detail-panel + resume-preview rendering reused by
// runsView.js.

import {
  statusMeta,
  sourceLabel,
  formatDate,
  formatDateTime,
  presetRange,
  isWithinRange,
  debounce,
  escapeHtml,
  DATE_PRESET_LABELS,
  skipReasonMeta,
  resultReasonMeta,
} from "./util.js";

const jobIndex = new Map(); // job_id -> job record, populated via registerJobs()

export function registerJobs(jobs) {
  for (const job of jobs) jobIndex.set(job.job_id, job);
}

const FIT_MAX = { skills_score: 40, experience_score: 25, location_score: 20, salary_score: 15 };
const FIT_LABELS = { skills_score: "Skills", experience_score: "Experience", location_score: "Location", salary_score: "Salary" };

const SORT_COLUMNS = [
  { key: "title", label: "Title & company" },
  { key: "portal", label: "Portal & location" },
  { key: "decided_at", label: "Date" },
  { key: "fit_score", label: "Fit" },
  { key: "phase", label: "Status" },
];

const RESULT_KIND_LABEL = { tooling: "Tooling", human: "Needs you", design: "By design" };

export function renderJobRow(job) {
  const meta = statusMeta(job.phase);
  const dateLabel = job.decided_at ? formatDate(job.decided_at) : job.posted_at ? `posted ${formatDate(job.posted_at)}` : "—";
  const reason = job.phase === "skipped" ? skipReasonMeta(job.reason) : null;
  const resultReason =
    (job.phase === "manual_required" || job.phase === "awaiting_human_submit") && job.result_reason
      ? resultReasonMeta(job.result_reason)
      : null;
  return `
    <div class="job-row" data-job-id="${escapeHtml(job.job_id)}">
      <div>
        <div class="title">${escapeHtml(job.title)}</div>
        <div class="company">${escapeHtml(job.company)}</div>
      </div>
      <div class="meta">${escapeHtml(job.portal)}<br/>${escapeHtml(job.location || "")}</div>
      <div class="meta">${dateLabel}</div>
      <div class="fit-score">${job.fit_score != null ? job.fit_score : "—"}</div>
      <div>
        <span class="badge ${meta.badge}">${escapeHtml(meta.label)}</span>
        <span class="badge badge-source">${escapeHtml(sourceLabel(job.workflow_type))}</span>
        ${reason ? `<div class="skip-reason-hint">${reason.kind === "filter" ? "Filtered" : "LLM"}: ${escapeHtml(reason.label)}</div>` : ""}
        ${resultReason ? `<div class="skip-reason-hint">${RESULT_KIND_LABEL[resultReason.kind]}: ${escapeHtml(resultReason.label)}</div>` : ""}
      </div>
      ${
        job.job_url
          ? `<a class="apply-link-btn" href="${escapeHtml(job.job_url)}" target="_blank" rel="noopener noreferrer">Apply ↗</a>`
          : "<div></div>"
      }
    </div>`;
}

function renderJobListHeader(sortKey, sortDir) {
  return `
    <div class="job-list-header">
      ${SORT_COLUMNS.map((col) => {
        const active = col.key === sortKey;
        const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
        return `<div class="sort-col${active ? " active" : ""}" data-sort-key="${col.key}">${col.label}${arrow}</div>`;
      }).join("")}
      <div></div>
    </div>`;
}

function renderFitBars(breakdown) {
  if (!breakdown) return "";
  return `<div class="fit-bars">${Object.entries(FIT_MAX)
    .map(([key, max]) => {
      const val = breakdown[key] || 0;
      const pct = Math.min(100, Math.round((val / max) * 100));
      return `
        <div class="fit-bar-row">
          <div class="fit-bar-label">${FIT_LABELS[key]}</div>
          <div class="fit-bar-track"><div class="fit-bar-fill" style="width:${pct}%"></div></div>
          <div class="fit-bar-value">${val}/${max}</div>
        </div>`;
    })
    .join("")}</div>`;
}

// "Filtered" (rule-based hard filter / deal-breaker) vs "LLM judgment"
// (low_fit, where fit_rationale carries the actual reasoning) — see
// SKIP_REASON_META in util.js for the full reason -> kind mapping.
function renderSkipReason(job) {
  const meta = skipReasonMeta(job.reason);
  const kindBadge = meta.kind === "filter" ? "badge-skipped" : "badge-manual_required";
  const kindLabel = meta.kind === "filter" ? "Filtered" : "LLM judgment";
  return `
    <div class="section-block">
      <h3>Why skipped</h3>
      <p>
        <span class="badge ${kindBadge}">${escapeHtml(kindLabel)}</span>
        <span>${escapeHtml(meta.label)}</span>
      </p>
    </div>`;
}

// Same three-kind split as RESULT_REASON_META in util.js: "tooling" (a
// systemic/technical failure, no human judgment involved — worth watching
// for patterns, e.g. repeated captcha_blocked on one portal), "human"
// (genuinely needs a person to decide), "design" (not a failure — the job
// stopped exactly where it was meant to).
const RESULT_KIND_BADGE = { tooling: "badge-error", human: "badge-manual_required", design: "badge-awaiting_human_submit" };

function renderResultReason(reason) {
  const meta = resultReasonMeta(reason);
  // The detail panel has room — show the full, untruncated reason (matters
  // for older freeform strings the interactive applier used to write,
  // where meta.label is deliberately truncated for compact contexts like
  // the toolbar dropdown).
  const detail = reason === "job_description_missing" ? meta.label : reason;
  return `<p><b>Reason:</b> <span class="badge ${RESULT_KIND_BADGE[meta.kind]}">${escapeHtml(RESULT_KIND_LABEL[meta.kind])}</span> ${escapeHtml(detail)}</p>`;
}

const overlay = () => document.getElementById("detail-overlay");
const panel = () => document.getElementById("detail-panel");

export function closeDetail() {
  overlay().classList.add("hidden");
  panel().innerHTML = "";
}

export async function openJobDetail(job) {
  const meta = statusMeta(job.phase);
  panel().innerHTML = `
    <button class="close-btn" id="detail-close">&times;</button>
    <div class="detail-header">
      <h2>${escapeHtml(job.title)}</h2>
      <div class="sub">${escapeHtml(job.company)} · ${escapeHtml(job.location || "")} · ${escapeHtml(job.portal)}</div>
      <span class="badge ${meta.badge}">${escapeHtml(meta.label)}</span>
      <span class="badge badge-source">${escapeHtml(sourceLabel(job.workflow_type))}</span>
    </div>

    <div class="section-block">
      <h3>Fit</h3>
      <p><b>Score:</b> ${job.fit_score != null ? job.fit_score : "not scored"}</p>
      ${renderFitBars(job.fit_breakdown)}
    </div>

    ${job.phase === "skipped" ? renderSkipReason(job) : ""}

    <div class="section-block">
      <h3>Result</h3>
      <p><b>Decided:</b> ${job.decided_at ? formatDateTime(job.decided_at) : "in progress"}</p>
      ${job.model_used ? `<p><b>Scoring Model:</b> <code>${escapeHtml(job.model_used)}</code>${job.fallback_info?.is_fallback ? ` <span class="badge badge-manual_required">Fallback from ${escapeHtml(job.fallback_info.primary_model)}</span>` : ""}</p>` : ""}
      ${job.tailor_model_used ? `<p><b>Tailoring Model:</b> <code>${escapeHtml(job.tailor_model_used)}</code></p>` : ""}
      ${job.apply_model_used ? `<p><b>Apply Model:</b> <code>${escapeHtml(job.apply_model_used)}</code></p>` : ""}
      ${job.result_reason ? renderResultReason(job.result_reason) : ""}
      ${
        job.resume_downloads
          ? `<p><b>Tailored Resume:</b> ${
              job.resume_downloads.pdf
                ? `<a href="${escapeHtml(job.resume_downloads.pdf)}" target="_blank" rel="noopener" class="download-chip">PDF ↗</a> `
                : ""
            }${
              job.resume_downloads.docx
                ? `<a href="${escapeHtml(job.resume_downloads.docx)}" target="_blank" rel="noopener" class="download-chip">DOCX ↗</a>`
                : ""
            }</p>`
          : ""
      }
      ${job.job_url ? `<p><b>Job posting:</b> <a href="${escapeHtml(job.job_url)}" target="_blank" rel="noopener noreferrer">Open posting ↗</a></p>` : ""}
    </div>
  `;
  overlay().classList.remove("hidden");
  document.getElementById("detail-close").addEventListener("click", closeDetail);

}

function attachRowClicks(container) {
  container.addEventListener("click", (e) => {
    if (e.target.closest(".apply-link-btn")) return; // let the link open in its own tab, don't also open the detail panel
    const row = e.target.closest(".job-row");
    if (!row) return;
    const job = jobIndex.get(row.dataset.jobId);
    if (job) openJobDetail(job);
  });
}

function uniquePortals(jobs) {
  return [...new Set(jobs.map((j) => j.portal).filter(Boolean))].sort();
}

// Only offer reasons that actually appear in the data — an empty run
// shouldn't show all 7 possible codes with nothing behind them.
function uniqueSkipReasons(jobs) {
  return [...new Set(jobs.filter((j) => j.phase === "skipped").map((j) => j.reason).filter(Boolean))].sort();
}

function uniqueResultReasons(jobs) {
  return [
    ...new Set(
      jobs
        .filter((j) => j.phase === "manual_required" || j.phase === "awaiting_human_submit")
        .map((j) => j.result_reason)
        .filter(Boolean)
    ),
  ].sort();
}

function compareJobs(a, b, key, dir) {
  let cmp;
  if (key === "fit_score") {
    const av = a.fit_score == null ? -1 : a.fit_score;
    const bv = b.fit_score == null ? -1 : b.fit_score;
    cmp = av - bv;
  } else {
    const av = (a[key] || "").toString().toLowerCase();
    const bv = (b[key] || "").toString().toLowerCase();
    cmp = av < bv ? -1 : av > bv ? 1 : 0;
  }
  return dir === "asc" ? cmp : -cmp;
}

function applyFilters(jobs, state) {
  const q = state.search.trim().toLowerCase();
  let filtered = jobs.filter((job) => {
    if (state.status !== "all" && job.phase !== state.status) return false;
    if (state.portal !== "all" && job.portal !== state.portal) return false;
    if (state.skipReason !== "all" && job.reason !== state.skipReason) return false;
    if (state.resultReason !== "all" && job.result_reason !== state.resultReason) return false;
    if (state.fitMin > 0 && (job.fit_score == null || job.fit_score < state.fitMin)) return false;
    if (q) {
      const haystack = [job.title, job.company].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const sorter = (a, b) => compareJobs(a, b, state.sortKey, state.sortDir);

  if (state.preset === "all") {
    return { dated: filtered.sort(sorter), undated: [] };
  }
  const range = state.preset === "custom" ? { start: state.customFrom, end: state.customTo } : presetRange(state.preset);
  const dated = filtered.filter((j) => j.decided_at && isWithinRange(j.decided_at, range)).sort(sorter);
  const undated = filtered.filter((j) => !j.decided_at).sort(sorter);
  return { dated, undated };
}

function computeStats(jobs) {
  const countBy = (phase) => jobs.filter((j) => j.phase === phase).length;
  const countByResultReason = (reason) => jobs.filter((j) => j.result_reason === reason).length;
  const scored = jobs.filter((j) => j.fit_score != null);
  const avgFit = scored.length ? Math.round((scored.reduce((s, j) => s + j.fit_score, 0) / scored.length) * 10) / 10 : null;
  return {
    total: jobs.length,
    applied: countBy("applied"),
    awaiting: countBy("awaiting_human_submit"),
    manual: countBy("manual_required"),
    // Called out explicitly because a repeated pattern here (many jobs
    // stuck on the same tooling reason, e.g. captcha_blocked on one portal)
    // is a signal worth acting on differently than a one-off "needs you"
    // case — surfaced as its own tile rather than buried inside "Manual
    // required", and clicking it jumps straight to the filtered list.
    captchaBlocked: countByResultReason("captcha_blocked"),
    avgFit,
  };
}

function renderStats(stats) {
  const tiles = [
    { label: "Total jobs", value: stats.total },
    { label: "Applied", value: stats.applied, color: "var(--status-applied-fg)" },
    { label: "Awaiting your submit", value: stats.awaiting, color: "var(--status-human-fg)" },
    { label: "Manual required", value: stats.manual, color: "var(--status-manual-fg)" },
    { label: "CAPTCHA blocked", value: stats.captchaBlocked, color: "var(--status-error-fg)", filterResultReason: "captcha_blocked" },
    { label: "Avg fit score", value: stats.avgFit != null ? stats.avgFit : "—" },
  ];
  return tiles
    .map(
      (t) => `
      <div class="stat-tile${t.filterResultReason ? " stat-tile-clickable" : ""}"${
        t.filterResultReason ? ` data-filter-result-reason="${escapeHtml(t.filterResultReason)}"` : ""
      }>
        <div class="stat-value"${t.color ? ` style="color:${t.color}"` : ""}>${t.value}</div>
        <div class="stat-label">${t.label}</div>
      </div>`
    )
    .join("");
}

export function initJobBoard(container, jobs) {
  registerJobs(jobs);
  const portals = uniquePortals(jobs);
  const skipReasons = uniqueSkipReasons(jobs);
  const resultReasons = uniqueResultReasons(jobs);
  const statusOptions = ["all", "applied", "awaiting_human_submit", "manual_required", "skipped", "email_draft", "error", "pending_score", "pending_tailor", "pending_apply"];

  container.innerHTML = `
    <div class="stats-strip" id="jb-stats"></div>
    <div class="toolbar">
      <input type="text" id="jb-search" placeholder="Search title or company…" />
      <select id="jb-status">
        ${statusOptions.map((s) => `<option value="${s}">${s === "all" ? "All statuses" : s}</option>`).join("")}
      </select>
      <select id="jb-portal">
        <option value="all">All portals</option>
        ${portals.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
      </select>
      <select id="jb-skip-reason">
        <option value="all">All skip reasons</option>
        ${skipReasons
          .map((r) => {
            const m = skipReasonMeta(r);
            return `<option value="${escapeHtml(r)}">${m.kind === "filter" ? "Filtered" : "LLM"}: ${escapeHtml(m.label)}</option>`;
          })
          .join("")}
      </select>
      <select id="jb-result-reason">
        <option value="all">All manual/awaiting reasons</option>
        ${resultReasons
          .map((r) => {
            const m = resultReasonMeta(r);
            return `<option value="${escapeHtml(r)}">${escapeHtml(RESULT_KIND_LABEL[m.kind])}: ${escapeHtml(m.label)}</option>`;
          })
          .join("")}
      </select>
      <select id="jb-fit-min">
        <option value="0">Any fit score</option>
        <option value="50">Fit ≥ 50</option>
        <option value="70">Fit ≥ 70</option>
        <option value="90">Fit ≥ 90</option>
      </select>
      <div class="preset-group" id="jb-presets">
        ${["all", "today", "yesterday", "last7", "last30"]
          .map((p) => `<button class="preset-btn${p === "all" ? " active" : ""}" data-preset="${p}">${DATE_PRESET_LABELS[p]}</button>`)
          .join("")}
        <button class="preset-btn" data-preset="custom">${DATE_PRESET_LABELS.custom}</button>
      </div>
      <input type="date" id="jb-from" class="hidden" />
      <input type="date" id="jb-to" class="hidden" />
    </div>
    <div class="result-count" id="jb-count"></div>
    <div class="job-list" id="jb-list"></div>
  `;

  const state = { search: "", status: "all", portal: "all", skipReason: "all", resultReason: "all", fitMin: 0, preset: "all", customFrom: null, customTo: null, sortKey: "decided_at", sortDir: "desc" };

  const statsEl = container.querySelector("#jb-stats");
  const list = container.querySelector("#jb-list");
  const count = container.querySelector("#jb-count");
  const searchInput = container.querySelector("#jb-search");
  const statusSelect = container.querySelector("#jb-status");
  const portalSelect = container.querySelector("#jb-portal");
  const skipReasonSelect = container.querySelector("#jb-skip-reason");
  const resultReasonSelect = container.querySelector("#jb-result-reason");
  const fitSelect = container.querySelector("#jb-fit-min");
  const fromInput = container.querySelector("#jb-from");
  const toInput = container.querySelector("#jb-to");
  attachRowClicks(list);

  function resetFilters() {
    Object.assign(state, { search: "", status: "all", portal: "all", skipReason: "all", resultReason: "all", fitMin: 0, preset: "all", customFrom: null, customTo: null });
    searchInput.value = "";
    statusSelect.value = "all";
    portalSelect.value = "all";
    skipReasonSelect.value = "all";
    resultReasonSelect.value = "all";
    fitSelect.value = "0";
    container.querySelectorAll("#jb-presets .preset-btn").forEach((b) => b.classList.toggle("active", b.dataset.preset === "all"));
    fromInput.classList.add("hidden");
    toInput.classList.add("hidden");
    render();
  }

  function render() {
    const { dated, undated } = applyFilters(jobs, state);
    const total = dated.length + undated.length;
    count.textContent = `${total} job${total === 1 ? "" : "s"}`;
    statsEl.innerHTML = renderStats(computeStats([...dated, ...undated]));

    if (jobs.length === 0) {
      list.innerHTML = `<div class="empty-state">No jobs recorded yet. Run <code>/apply</code> to start applying, then <code>npm run build-site</code> to publish.</div>`;
      return;
    }
    if (total === 0) {
      list.innerHTML = `<div class="empty-state">No jobs match these filters. <span class="back-link" id="jb-clear">Clear filters</span></div>`;
      list.querySelector("#jb-clear").addEventListener("click", resetFilters);
      return;
    }

    let html = renderJobListHeader(state.sortKey, state.sortDir);
    html += dated.map(renderJobRow).join("");
    if (undated.length) {
      html += `<div class="result-count" style="margin-top:14px;">Undated / in progress (${undated.length})</div>`;
      html += undated.map(renderJobRow).join("");
    }
    list.innerHTML = html;
  }

  searchInput.addEventListener(
    "input",
    debounce((e) => {
      state.search = e.target.value;
      render();
    }, 150)
  );
  statusSelect.addEventListener("change", (e) => {
    state.status = e.target.value;
    render();
  });
  portalSelect.addEventListener("change", (e) => {
    state.portal = e.target.value;
    render();
  });
  skipReasonSelect.addEventListener("change", (e) => {
    state.skipReason = e.target.value;
    // Picking a specific reason only makes sense against skipped jobs — force
    // the status filter to match so choosing one doesn't silently zero out
    // the list for someone who hadn't also set status to "skipped".
    if (state.skipReason !== "all" && state.status !== "skipped") {
      state.status = "skipped";
      statusSelect.value = "skipped";
    }
    render();
  });
  resultReasonSelect.addEventListener("change", (e) => {
    state.resultReason = e.target.value;
    // A result_reason can belong to EITHER manual_required or
    // awaiting_human_submit (e.g. captcha_blocked only ever appears on the
    // former, dry_run_stopped_before_submit only on the latter) — so unlike
    // skip reasons there's no single status to force. Just clear an
    // unrelated status filter (e.g. "applied") so the reason filter isn't
    // silently zeroed out; leave it alone if it's already one of the two
    // relevant statuses or "all".
    if (state.resultReason !== "all" && state.status !== "manual_required" && state.status !== "awaiting_human_submit") {
      state.status = "all";
      statusSelect.value = "all";
    }
    render();
  });
  fitSelect.addEventListener("change", (e) => {
    state.fitMin = Number(e.target.value);
    render();
  });
  // Event delegation, not per-tile listeners — statsEl's innerHTML is fully
  // replaced on every render(), so tiles created by an earlier render are
  // gone by the time a click could reach a directly-attached listener.
  statsEl.addEventListener("click", (e) => {
    const tile = e.target.closest("[data-filter-result-reason]");
    if (!tile) return;
    state.resultReason = tile.dataset.filterResultReason;
    resultReasonSelect.value = state.resultReason;
    if (state.status !== "manual_required" && state.status !== "awaiting_human_submit") {
      state.status = "all";
      statusSelect.value = "all";
    }
    render();
  });
  container.querySelector("#jb-presets").addEventListener("click", (e) => {
    const btn = e.target.closest(".preset-btn");
    if (!btn) return;
    container.querySelectorAll("#jb-presets .preset-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.preset = btn.dataset.preset;
    const isCustom = state.preset === "custom";
    fromInput.classList.toggle("hidden", !isCustom);
    toInput.classList.toggle("hidden", !isCustom);
    if (isCustom) updateCustomRange();
    render();
  });
  function updateCustomRange() {
    state.customFrom = fromInput.value ? new Date(fromInput.value + "T00:00:00") : null;
    state.customTo = toInput.value ? new Date(toInput.value + "T23:59:59") : null;
  }
  fromInput.addEventListener("change", () => {
    updateCustomRange();
    render();
  });
  toInput.addEventListener("change", () => {
    updateCustomRange();
    render();
  });
  list.addEventListener("click", (e) => {
    const col = e.target.closest(".sort-col");
    if (!col) return;
    const key = col.dataset.sortKey;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      state.sortDir = key === "fit_score" || key === "decided_at" ? "desc" : "asc";
    }
    render();
  });

  render();
}
