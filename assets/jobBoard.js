// Job Board: client-side search, filtering, sorting and pagination across
// the public job snapshot.

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

const jobIndex = new Map(); // job_id -> job record, populated via registerJobs()

export function registerJobs(jobs) {
  for (const job of jobs) jobIndex.set(job.job_id, job);
}

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
  const downloads = job.resume_downloads || {};
  const resumeLinks = [
    ["pdf", "PDF"],
    ["docx", "DOCX"],
  ].filter(([format]) => typeof downloads[format] === "string");
  return `
    <div class="job-row" data-job-id="${escapeHtml(job.job_id)}">
      <div>
        <div class="title">${escapeHtml(job.title)}</div>
        <div class="company">${escapeHtml(job.company)}</div>
        ${resumeLinks.length
          ? `<div class="job-resume-links">Resume: ${resumeLinks.map(([format, label]) => `<a href="${escapeHtml(downloads[format])}" target="_blank" rel="noopener">${label}</a>`).join(" · ")}</div>`
          : ""}
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

const overlay = () => document.getElementById("detail-overlay");
const panel = () => document.getElementById("detail-panel");

export function closeDetail() {
  overlay().classList.add("hidden");
  panel().innerHTML = "";
}

export function openJobDetail(job) {
  const meta = statusMeta(job.phase);
  let jobUrl = "";
  try {
    const parsedUrl = new URL(job.job_url);
    if (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") jobUrl = parsedUrl.href;
  } catch (e) {
    // Do not render an invalid or unsafe public URL as a link.
  }
  const resumeDownloads = job.resume_downloads || {};
  const resumeLinks = [
    ["pdf", "Download PDF"],
    ["docx", "Download DOCX"],
  ].filter(([format]) => typeof resumeDownloads[format] === "string");
  const resultReason = {
    job_description_missing: "No job description was available, so this job was not scored. Open the posting and review it manually.",
    unsupported_resume_format: "The application form does not accept the available PDF or DOCX resume. Review the form manually.",
  }[job.result_reason] || job.result_reason;
  panel().innerHTML = `
    <button class="close-btn" id="detail-close">&times;</button>
    <div class="detail-header">
      <h2>${escapeHtml(job.title)}</h2>
      <div class="sub">${escapeHtml(job.company)} · ${escapeHtml(job.location || "")} · ${escapeHtml(job.portal)}</div>
      <span class="badge ${meta.badge}">${escapeHtml(meta.label)}</span>
    </div>

    <div class="section-block">
      <p><b>Score:</b> ${job.fit_score != null ? job.fit_score : "not scored"}</p>
    </div>

    <div class="section-block">
      <h3>Result</h3>
      <p><b>Decided:</b> ${job.decided_at ? formatDateTime(job.decided_at) : "in progress"}</p>
      ${resultReason ? `<p><b>Reason:</b> ${escapeHtml(resultReason)}</p>` : ""}
      ${jobUrl ? `<p><b>Job URL:</b> <a href="${escapeHtml(jobUrl)}" target="_blank" rel="noopener">${escapeHtml(jobUrl)}</a></p>` : ""}
    </div>

    <div class="section-block">
      <h3>Tailored resume</h3>
      ${resumeLinks.length
        ? `<p>${resumeLinks.map(([format, label]) => `<a class="resume-download" href="${escapeHtml(resumeDownloads[format])}" target="_blank" rel="noopener">${label}</a>`).join(" · ")}</p>
           <p class="resume-download-note">The files are in the private automation repo. GitHub sign-in with repo access is required.</p>`
        : `<p>No tailored resume file is available for this job.</p>`}
    </div>
  `;
  overlay().classList.remove("hidden");
  document.getElementById("detail-close").addEventListener("click", closeDetail);
}

function attachRowClicks(container) {
  container.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
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

export function initJobBoard(container, jobs, { manualOnly = false, idPrefix = "jb" } = {}) {
  registerJobs(jobs);
  const boardJobs = manualOnly ? jobs.filter((job) => job.phase === "manual_required") : jobs;
  const id = (name) => `${idPrefix}-${name}`;
  const portals = uniquePortals(boardJobs);
  const statusOptions = ["all", "applied", "awaiting_human_submit", "manual_required", "skipped", "email_draft", "error", "pending_score", "pending_tailor", "pending_apply"];

  container.innerHTML = `
    <div class="stats-strip" id="${id("stats")}"></div>
    <div class="toolbar">
      <input type="text" id="${id("search")}" placeholder="Search title, company, keywords…" />
      <select id="${id("status")}">
        ${statusOptions.map((s) => `<option value="${s}">${s === "all" ? "All statuses" : s}</option>`).join("")}
      </select>
      <select id="${id("portal")}">
        <option value="all">All portals</option>
        ${portals.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
      </select>
      <select id="${id("fit-min")}">
        <option value="0">Any fit score</option>
        <option value="50">Fit ≥ 50</option>
        <option value="70">Fit ≥ 70</option>
        <option value="90">Fit ≥ 90</option>
      </select>
      <div class="preset-group" id="${id("presets")}">
        ${["all", "today", "yesterday", "last7", "last30"]
          .map((p) => `<button class="preset-btn${p === "all" ? " active" : ""}" data-preset="${p}">${DATE_PRESET_LABELS[p]}</button>`)
          .join("")}
        <button class="preset-btn" data-preset="custom">${DATE_PRESET_LABELS.custom}</button>
      </div>
      <input type="date" id="${id("from")}" class="hidden" />
      <input type="date" id="${id("to")}" class="hidden" />
    </div>
    <div class="result-count" id="${id("count")}"></div>
    <div class="job-list" id="${id("list")}"></div>
    <div class="pagination" id="${id("pagination")}" aria-label="Job list pages"></div>
  `;

  const state = { search: "", status: "all", portal: "all", fitMin: 0, preset: "all", customFrom: null, customTo: null, sortKey: "decided_at", sortDir: "desc", page: 1, pageSize: 25 };

  const statsEl = container.querySelector(`#${id("stats")}`);
  const list = container.querySelector(`#${id("list")}`);
  const count = container.querySelector(`#${id("count")}`);
  const pagination = container.querySelector(`#${id("pagination")}`);
  const searchInput = container.querySelector(`#${id("search")}`);
  const statusSelect = container.querySelector(`#${id("status")}`);
  const portalSelect = container.querySelector(`#${id("portal")}`);
  const fitSelect = container.querySelector(`#${id("fit-min")}`);
  const fromInput = container.querySelector(`#${id("from")}`);
  const toInput = container.querySelector(`#${id("to")}`);
  attachRowClicks(list);

  function resetFilters() {
    Object.assign(state, { search: "", status: "all", portal: "all", fitMin: 0, preset: "all", customFrom: null, customTo: null });
    searchInput.value = "";
    statusSelect.value = "all";
    portalSelect.value = "all";
    fitSelect.value = "0";
    state.page = 1;
    container.querySelectorAll(`#${id("presets")} .preset-btn`).forEach((b) => b.classList.toggle("active", b.dataset.preset === "all"));
    fromInput.classList.add("hidden");
    toInput.classList.add("hidden");
    render();
  }

  function render() {
    const { dated, undated } = applyFilters(boardJobs, state);
    const total = dated.length + undated.length;
    statsEl.innerHTML = renderStats(computeStats([...dated, ...undated]));

    if (boardJobs.length === 0) {
      list.innerHTML = manualOnly
        ? `<div class="empty-state">No jobs currently need manual action.</div>`
        : `<div class="empty-state">No jobs recorded yet. Run <code>/apply</code> to start applying, then <code>npm run build-site</code> to publish.</div>`;
      count.textContent = "0 jobs";
      pagination.innerHTML = "";
      return;
    }
    if (total === 0) {
      list.innerHTML = `<div class="empty-state">No jobs match these filters. <button class="back-link" id="${id("clear")}">Clear filters</button></div>`;
      list.querySelector(`#${id("clear")}`).addEventListener("click", resetFilters);
      count.textContent = "0 jobs";
      pagination.innerHTML = "";
      return;
    }

    const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
    state.page = Math.min(state.page, pageCount);
    const startIndex = (state.page - 1) * state.pageSize;
    const pageJobs = [...dated, ...undated].slice(startIndex, startIndex + state.pageSize);
    const datedOnPage = pageJobs.filter((job) => job.decided_at);
    const undatedOnPage = pageJobs.filter((job) => !job.decided_at);
    count.textContent = `Showing ${startIndex + 1}–${Math.min(startIndex + pageJobs.length, total)} of ${total} job${total === 1 ? "" : "s"}`;
    let html = renderJobListHeader(state.sortKey, state.sortDir);
    html += datedOnPage.map(renderJobRow).join("");
    if (undatedOnPage.length) {
      html += `<div class="result-count" style="margin-top:14px;">Undated / in progress (${undated.length})</div>`;
      html += undatedOnPage.map(renderJobRow).join("");
    }
    list.innerHTML = html;
    pagination.innerHTML = `
      <label>Jobs per page
        <select id="${id("page-size")}">
          ${[25, 50, 100].map((size) => `<option value="${size}"${size === state.pageSize ? " selected" : ""}>${size}</option>`).join("")}
        </select>
      </label>
      <span>Page ${state.page} of ${pageCount}</span>
      <button type="button" data-page="prev"${state.page === 1 ? " disabled" : ""}>Previous</button>
      <button type="button" data-page="next"${state.page === pageCount ? " disabled" : ""}>Next</button>
    `;
    pagination.querySelector(`#${id("page-size")}`).addEventListener("change", (event) => {
      state.pageSize = Number(event.target.value);
      state.page = 1;
      render();
    });
    pagination.querySelectorAll("button[data-page]").forEach((button) => button.addEventListener("click", () => {
      state.page += button.dataset.page === "next" ? 1 : -1;
      render();
    }));
  }

  searchInput.addEventListener(
    "input",
    debounce((e) => {
      state.search = e.target.value;
      state.page = 1;
      render();
    }, 150)
  );
  statusSelect.addEventListener("change", (e) => {
    state.status = e.target.value;
    state.page = 1;
    render();
  });
  portalSelect.addEventListener("change", (e) => {
    state.portal = e.target.value;
    state.page = 1;
    render();
  });
  fitSelect.addEventListener("change", (e) => {
    state.fitMin = Number(e.target.value);
    state.page = 1;
    render();
  });
  container.querySelector(`#${id("presets")}`).addEventListener("click", (e) => {
    const btn = e.target.closest(".preset-btn");
    if (!btn) return;
    container.querySelectorAll(`#${id("presets")} .preset-btn`).forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.preset = btn.dataset.preset;
    state.page = 1;
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
    state.page = 1;
    render();
  });
  toInput.addEventListener("change", () => {
    updateCustomRange();
    state.page = 1;
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
    state.page = 1;
    render();
  });

  render();
}
