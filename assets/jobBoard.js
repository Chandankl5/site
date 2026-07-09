// Job Board: search/filter/sort/date-range list of every job across every
// run, plus the shared detail-panel + resume-preview rendering reused by
// runsView.js.

import {
  statusMeta,
  formatDate,
  formatDateTime,
  presetRange,
  isWithinRange,
  debounce,
  escapeHtml,
  DATE_PRESET_LABELS,
} from "./util.js";
import { renderResumeHTML } from "./resumeTemplate.js";

const jobIndex = new Map(); // job_id -> job record, populated via registerJobs()
const resumeCache = new Map(); // job_id -> resume json | null (fetched, none found)

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

export function renderJobRow(job) {
  const meta = statusMeta(job.phase);
  const dateLabel = job.decided_at ? formatDate(job.decided_at) : job.posted_at ? `posted ${formatDate(job.posted_at)}` : "—";
  return `
    <div class="job-row" data-job-id="${escapeHtml(job.job_id)}">
      <div>
        <div class="title">${escapeHtml(job.title)}</div>
        <div class="company">${escapeHtml(job.company)}</div>
      </div>
      <div class="meta">${escapeHtml(job.portal)}<br/>${escapeHtml(job.location || "")}</div>
      <div class="meta">${dateLabel}</div>
      <div class="fit-score">${job.fit_score != null ? job.fit_score : "—"}</div>
      <div><span class="badge ${meta.badge}">${escapeHtml(meta.label)}</span></div>
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
    </div>`;
}

async function fetchResume(jobId) {
  if (resumeCache.has(jobId)) return resumeCache.get(jobId);
  try {
    const res = await fetch(`data/resumes/${encodeURIComponent(jobId)}.json`);
    const resume = res.ok ? await res.json() : null;
    resumeCache.set(jobId, resume);
    return resume;
  } catch (e) {
    resumeCache.set(jobId, null);
    return null;
  }
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
      <div class="chip-row">${(job.ats_keywords || []).map((k) => `<span class="chip">${escapeHtml(k)}</span>`).join("")}</div>
    </div>

    <div class="section-block">
      <h3>Fit</h3>
      <p><b>Score:</b> ${job.fit_score != null ? job.fit_score : "not scored"}</p>
      ${renderFitBars(job.fit_breakdown)}
      ${job.fit_rationale ? `<p>${escapeHtml(job.fit_rationale)}</p>` : ""}
    </div>

    <div class="section-block">
      <h3>Result</h3>
      <p><b>Decided:</b> ${job.decided_at ? formatDateTime(job.decided_at) : "in progress"}</p>
      ${job.result_reason ? `<p><b>Reason:</b> ${escapeHtml(job.result_reason)}</p>` : ""}
      ${job.resume_version ? `<p><b>Resume version:</b> ${escapeHtml(job.resume_version)}</p>` : ""}
      <p><b>Job URL:</b> <a href="${escapeHtml(job.job_url)}" target="_blank" rel="noopener">${escapeHtml(job.job_url)}</a></p>
    </div>

    <div class="section-block">
      <h3>Job Description</h3>
      <div class="jd-text">${escapeHtml(job.jd_text || "No JD text captured.")}</div>
    </div>

    <div class="section-block" id="resume-block">
      <h3>Resume Submitted</h3>
      <div class="empty-state">Loading resume preview…</div>
    </div>
  `;
  overlay().classList.remove("hidden");
  document.getElementById("detail-close").addEventListener("click", closeDetail);

  const resume = await fetchResume(job.job_id);
  const block = document.getElementById("resume-block");
  if (block) block.innerHTML = `<h3>Resume Submitted</h3>${renderResumeHTML(resume)}`;
}

function attachRowClicks(container) {
  container.addEventListener("click", (e) => {
    const row = e.target.closest(".job-row");
    if (!row) return;
    const job = jobIndex.get(row.dataset.jobId);
    if (job) openJobDetail(job);
  });
}

function uniquePortals(jobs) {
  return [...new Set(jobs.map((j) => j.portal).filter(Boolean))].sort();
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
    if (state.fitMin > 0 && (job.fit_score == null || job.fit_score < state.fitMin)) return false;
    if (q) {
      const haystack = [job.title, job.company, ...(job.ats_keywords || [])].join(" ").toLowerCase();
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
  const scored = jobs.filter((j) => j.fit_score != null);
  const avgFit = scored.length ? Math.round((scored.reduce((s, j) => s + j.fit_score, 0) / scored.length) * 10) / 10 : null;
  return {
    total: jobs.length,
    applied: countBy("applied"),
    awaiting: countBy("awaiting_human_submit"),
    manual: countBy("manual_required"),
    avgFit,
  };
}

function renderStats(stats) {
  const tiles = [
    { label: "Total jobs", value: stats.total },
    { label: "Applied", value: stats.applied, color: "var(--status-applied-fg)" },
    { label: "Awaiting your submit", value: stats.awaiting, color: "var(--status-human-fg)" },
    { label: "Manual required", value: stats.manual, color: "var(--status-manual-fg)" },
    { label: "Avg fit score", value: stats.avgFit != null ? stats.avgFit : "—" },
  ];
  return tiles
    .map(
      (t) => `
      <div class="stat-tile">
        <div class="stat-value"${t.color ? ` style="color:${t.color}"` : ""}>${t.value}</div>
        <div class="stat-label">${t.label}</div>
      </div>`
    )
    .join("");
}

export function initJobBoard(container, jobs) {
  registerJobs(jobs);
  const portals = uniquePortals(jobs);
  const statusOptions = ["all", "applied", "awaiting_human_submit", "manual_required", "skipped", "email_draft", "error", "pending_score", "pending_tailor", "pending_apply"];

  container.innerHTML = `
    <div class="stats-strip" id="jb-stats"></div>
    <div class="toolbar">
      <input type="text" id="jb-search" placeholder="Search title, company, keywords…" />
      <select id="jb-status">
        ${statusOptions.map((s) => `<option value="${s}">${s === "all" ? "All statuses" : s}</option>`).join("")}
      </select>
      <select id="jb-portal">
        <option value="all">All portals</option>
        ${portals.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
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

  const state = { search: "", status: "all", portal: "all", fitMin: 0, preset: "all", customFrom: null, customTo: null, sortKey: "decided_at", sortDir: "desc" };

  const statsEl = container.querySelector("#jb-stats");
  const list = container.querySelector("#jb-list");
  const count = container.querySelector("#jb-count");
  const searchInput = container.querySelector("#jb-search");
  const statusSelect = container.querySelector("#jb-status");
  const portalSelect = container.querySelector("#jb-portal");
  const fitSelect = container.querySelector("#jb-fit-min");
  const fromInput = container.querySelector("#jb-from");
  const toInput = container.querySelector("#jb-to");
  attachRowClicks(list);

  function resetFilters() {
    Object.assign(state, { search: "", status: "all", portal: "all", fitMin: 0, preset: "all", customFrom: null, customTo: null });
    searchInput.value = "";
    statusSelect.value = "all";
    portalSelect.value = "all";
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
  fitSelect.addEventListener("change", (e) => {
    state.fitMin = Number(e.target.value);
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
