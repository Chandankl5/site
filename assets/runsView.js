// Runs tab: Runs per day grouped by date, step status & model filters,
// run cards with why-stopped and fallback diagnostics, and full master list
// of all jobs scanned in that run.

import {
  formatDate,
  formatDateTime,
  getISTDateString,
  escapeHtml,
  sourceLabel,
  statusMeta,
  skipReasonMeta,
  resultReasonMeta,
  presetRange,
  isWithinRange,
  DATE_PRESETS,
  DATE_PRESET_LABELS,
} from "./util.js";
import { openJobDetail, registerJobs } from "./jobBoard.js";

let allJobsRef = [];
let eventsCache = new Map(); // run_id -> events array

let activeRunPreset = "last7";
let runCustomStart = null;
let runCustomEnd = null;
let activeStatusFilter = "all";
let activeModelFilter = "all";
let runSearchQuery = "";

async function fetchEvents(runId) {
  if (eventsCache.has(runId)) return eventsCache.get(runId);
  try {
    const res = await fetch(`data/events/${encodeURIComponent(runId)}.json`);
    const events = res.ok ? await res.json() : [];
    eventsCache.set(runId, events);
    return events;
  } catch (e) {
    eventsCache.set(runId, []);
    return [];
  }
}

const STEP_LABELS = {
  discover: "Discover",
  filter: "Pre-filter / Dedup",
  score: "Fit Scoring",
  tailor: "Resume Tailoring",
  apply: "Submission / Apply",
  completed: "Pipeline Completed",
};

function stepLabel(step) {
  return STEP_LABELS[step] || step || "—";
}

function runStatusBadgeClass(status) {
  if (status === "completed") return "badge-applied";
  if (status === "in_progress") return "badge-pending";
  if (status === "paused") return "badge-awaiting_human_submit";
  if (status === "error" || status === "failed") return "badge-error";
  return "badge-pending";
}

function renderRunCard(runId, run) {
  const counts = run.counts || {};
  const models = run.models_used || [];
  const fallbacks = run.fallbacks_used || [];
  const hasFallback = fallbacks.length > 0;

  const fallbackAlert = hasFallback
    ? `<div class="run-fallback-alert">
        <span class="fallback-icon">⚠️</span>
        <div class="fallback-text">
          <b>Fallback triggered:</b>
          ${fallbacks
            .map(
              (f) =>
                `In <em>${escapeHtml(f.step || "step")}</em>, primary <strong>${escapeHtml(f.primary_model || "primary")}</strong> failed (${escapeHtml(f.failure_reason || f.primary_failure_reason || "quota/error")}) &rarr; fell back to <strong>${escapeHtml(f.fallback_model || "fallback")}</strong>.`
            )
            .join(" ")}
        </div>
      </div>`
    : "";

  const modelsPills = models.length
    ? `<div class="run-models-list">
        <span class="models-label">Models:</span>
        ${models.map((m) => `<span class="model-pill">${escapeHtml(m)}</span>`).join("")}
      </div>`
    : "";

  const lastStep = run.last_step_executed || run.phase || "discover";
  const stopReason = run.stop_reason;

  return `
    <div class="run-card" data-run-id="${escapeHtml(runId)}">
      <div class="run-card-top">
        <div class="run-id-line">
          <span class="run-id">${escapeHtml(runId)}</span>
          <span class="badge ${runStatusBadgeClass(run.status)}">${escapeHtml(run.status || "unknown")}</span>
          <span class="badge badge-source">${escapeHtml(sourceLabel(run.workflow_type))}</span>
          <span class="badge badge-step">Step: ${escapeHtml(stepLabel(lastStep))}</span>
          ${
            run.github_run_url
              ? `<a href="${escapeHtml(run.github_run_url)}" target="_blank" rel="noopener noreferrer" class="badge badge-gh-run" title="View GitHub Actions logs for this run">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:-1px;margin-right:4px;"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                  GitHub Run ↗
                </a>`
              : `<a href="https://github.com/Chandankl5/ja-automation/actions" target="_blank" rel="noopener noreferrer" class="badge badge-gh-run" title="View GitHub Actions runs">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:-1px;margin-right:4px;"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                  CI Actions ↗
                </a>`
          }
        </div>
        <div class="run-timestamp">
          Started ${formatDateTime(run.started_at)}${run.completed_at ? " · Completed " + formatDateTime(run.completed_at) : ""}
        </div>
      </div>

      ${
        stopReason
          ? `<div class="run-stop-reason">
              <span class="stop-reason-tag">Execution status:</span> ${escapeHtml(stopReason)}
            </div>`
          : ""
      }

      ${fallbackAlert}
      ${modelsPills}

      <div class="run-counts">
        <span>Scanned <b>${counts.discovered ?? 0}</b></span>
        ${counts.filtered_out != null ? `<span>Filtered Out <b>${counts.filtered_out}</b></span>` : ""}
        <span>Scored <b>${counts.scored ?? 0}</b></span>
        <span>Tailored <b>${counts.tailored ?? 0}</b></span>
        <span>Applied <b>${counts.applied ?? 0}</b></span>
        <span>Skipped <b>${counts.skipped ?? 0}</b></span>
        ${counts.manual_required ? `<span>Manual <b>${counts.manual_required}</b></span>` : ""}
      </div>
    </div>`;
}

function renderScannedJobRow(job) {
  const meta = statusMeta(job.phase);
  const skipReason = job.phase === "skipped" && job.reason ? skipReasonMeta(job.reason) : null;
  const resultReason =
    (job.phase === "manual_required" || job.phase === "awaiting_human_submit" || job.phase === "error") && job.result_reason
      ? resultReasonMeta(job.result_reason)
      : null;

  const downloads = job.resume_downloads || {};
  const resumeLinks = [
    ["pdf", "PDF"],
    ["docx", "DOCX"],
  ].filter(([format]) => typeof downloads[format] === "string");

  // Models used for scoring / tailoring / applying
  const modelNotes = [];
  if (job.model_used) {
    let text = `Scored with ${job.model_used}`;
    if (job.fallback_info?.is_fallback) {
      text += ` (Fallback from ${job.fallback_info.primary_model}: ${job.fallback_info.primary_failure_reason || "exhausted"})`;
    }
    modelNotes.push(text);
  }
  if (job.tailor_model_used) {
    let text = `Tailored with ${job.tailor_model_used}`;
    if (job.tailor_fallback_info?.is_fallback) {
      text += ` (Fallback from ${job.tailor_fallback_info.primary_model})`;
    }
    modelNotes.push(text);
  }
  if (job.apply_model_used) {
    let text = `Applied with ${job.apply_model_used}`;
    if (job.apply_fallback_info?.is_fallback) {
      text += ` (Fallback from ${job.apply_fallback_info.primary_model})`;
    }
    modelNotes.push(text);
  }

  // Breakdown pills
  const b = job.fit_breakdown || {};
  const hasBreakdown = Number.isFinite(b.skills_score);
  const breakdownPills = hasBreakdown
    ? `<div class="fit-pills fit-pills-compact">
        <span class="fit-pill" title="Skills">Skills ${b.skills_score}/40</span>
        <span class="fit-pill" title="Experience">Exp ${b.experience_score}/25</span>
        <span class="fit-pill" title="Location">Loc ${b.location_score}/20</span>
        <span class="fit-pill" title="Salary">Sal ${b.salary_score}/15</span>
      </div>`
    : "";

  return `
    <div class="scanned-job-card" data-job-id="${escapeHtml(job.job_id)}">
      <div class="scanned-job-header">
        <div>
          <div class="scanned-job-title">
            ${escapeHtml(job.title)}
            ${
              job.job_url
                ? `<a href="${escapeHtml(job.job_url)}" target="_blank" rel="noopener noreferrer" class="job-direct-link" title="Open job posting">↗</a>`
                : ""
            }
          </div>
          <div class="scanned-job-company">${escapeHtml(job.company)} · ${escapeHtml(job.portal || "career_site")} · ${escapeHtml(job.location || "")}</div>
        </div>
        <div class="scanned-job-badges">
          <span class="badge ${meta.badge}">${escapeHtml(meta.label)}</span>
          ${job.fit_score != null ? `<span class="score-pill">Fit: <b>${job.fit_score}</b>/100</span>` : ""}
        </div>
      </div>

      ${breakdownPills}

      ${
        job.fit_rationale
          ? `<div class="job-rationale-text"><span class="label">Rationale:</span> ${escapeHtml(job.fit_rationale)}</div>`
          : ""
      }

      ${
        skipReason
          ? `<div class="job-stop-detail"><span class="stop-tag">Filter Rule:</span> ${escapeHtml(skipReason.label)}</div>`
          : ""
      }
      ${
        resultReason
          ? `<div class="job-stop-detail"><span class="stop-tag">Why stopped/failed:</span> ${escapeHtml(resultReason.label)}</div>`
          : ""
      }

      ${
        modelNotes.length
          ? `<div class="job-model-audit">${modelNotes.map((n) => `<span class="model-audit-tag">${escapeHtml(n)}</span>`).join(" ")}</div>`
          : ""
      }

      ${
        resumeLinks.length
          ? `<div class="job-resume-downloads">
              <span class="label">Tailored Resume:</span>
              ${resumeLinks
                .map(([format, label]) => `<a href="${escapeHtml(downloads[format])}" target="_blank" rel="noopener" class="download-chip">${label} ↗</a>`)
                .join(" ")}
            </div>`
          : ""
      }
    </div>`;
}

function renderTimeline(events) {
  if (!events.length) return `<div class="empty-state">No events recorded for this run.</div>`;
  return `<div class="timeline">${events
    .map((ev) => {
      const { event, agent, ts, ...rest } = ev;
      const detailStr = Object.entries(rest)
        .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
        .join(" · ");
      return `
        <div class="timeline-item">
          <div class="timeline-ts">${formatDateTime(ts)}</div>
          <div class="timeline-event">${escapeHtml(event)}${agent ? " · " + escapeHtml(agent) : ""}</div>
          ${detailStr ? `<div class="timeline-detail">${escapeHtml(detailStr)}</div>` : ""}
        </div>`;
    })
    .join("")}</div>`;
}

async function renderRunDetail(container, runId, run) {
  const jobsInRun = allJobsRef.filter((j) => j.run_id === runId);

  // Group or filter jobs within run
  const fallbacks = run.fallbacks_used || [];

  container.innerHTML = `
    <span class="back-link" id="run-back">&larr; Back to all runs</span>
    <div class="detail-header">
      <h2>Run: ${escapeHtml(runId)}</h2>
      <div class="sub">
        Status: <span class="badge ${runStatusBadgeClass(run.status)}">${escapeHtml(run.status || "—")}</span> ·
        Step: <b>${escapeHtml(stepLabel(run.last_step_executed || run.phase))}</b> ·
        Source: ${escapeHtml(sourceLabel(run.workflow_type))} ·
        Started: ${formatDateTime(run.started_at)}
      </div>
    </div>

    ${
      run.stop_reason
        ? `<div class="run-stop-reason-box">
            <b>Why this run stopped / completed:</b> ${escapeHtml(run.stop_reason)}
          </div>`
        : ""
    }

    ${
      fallbacks.length
        ? `<div class="run-fallback-box">
            <h4>Fallback Model Audit</h4>
            <div class="fallback-box-content">
              ${fallbacks
                .map(
                  (f) => `
                <div class="fallback-row">
                  <span class="step-tag">${escapeHtml(f.step || "Step")}</span>
                  <span>Primary model <strong>${escapeHtml(f.primary_model || "—")}</strong> failed: <em>${escapeHtml(f.failure_reason || f.primary_failure_reason || "quota limit")}</em></span>
                  <span>&rarr; Retried with <strong>${escapeHtml(f.fallback_model || "fallback")}</strong> (${escapeHtml(f.fallback_reason || "fallback")})</span>
                </div>`
                )
                .join("")}
            </div>
          </div>`
        : ""
    }

    <div class="section-block">
      <div class="section-header-row">
        <h3>Master list of all jobs scanned in this run (${jobsInRun.length})</h3>
        <div class="job-filter-pills" id="run-job-filter">
          <button class="pill active" data-filter="all">All (${jobsInRun.length})</button>
          <button class="pill" data-filter="applied">Applied (${jobsInRun.filter((j) => j.phase === "applied").length})</button>
          <button class="pill" data-filter="tailored">Tailored (${jobsInRun.filter((j) => j.phase === "pending_apply" || j.phase === "awaiting_human_submit").length})</button>
          <button class="pill" data-filter="low_fit">Low Fit (${jobsInRun.filter((j) => j.phase === "skipped" && j.reason === "low_fit").length})</button>
          <button class="pill" data-filter="filtered">Filtered Out (${jobsInRun.filter((j) => j.phase === "skipped" && j.reason !== "low_fit").length})</button>
          <button class="pill" data-filter="failed">Failed / Manual (${jobsInRun.filter((j) => j.phase === "manual_required" || j.phase === "error").length})</button>
        </div>
      </div>
      <div id="run-jobs-container" class="scanned-jobs-list">
        ${jobsInRun.map(renderScannedJobRow).join("") || `<div class="empty-state">No jobs recorded for this run.</div>`}
      </div>
    </div>

    <div class="section-block">
      <h3>Run Event Timeline</h3>
      <div id="run-timeline"><div class="empty-state">Loading timeline…</div></div>
    </div>
  `;

  container.querySelector("#run-back").addEventListener("click", () => renderRunList(container));

  // Within-run job filtering
  const filterPills = container.querySelector("#run-job-filter");
  const jobsContainer = container.querySelector("#run-jobs-container");
  filterPills.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    filterPills.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");

    const filter = btn.dataset.filter;
    let filtered = jobsInRun;
    if (filter === "applied") filtered = jobsInRun.filter((j) => j.phase === "applied");
    else if (filter === "tailored") filtered = jobsInRun.filter((j) => j.phase === "pending_apply" || j.phase === "awaiting_human_submit");
    else if (filter === "low_fit") filtered = jobsInRun.filter((j) => j.phase === "skipped" && j.reason === "low_fit");
    else if (filter === "filtered") filtered = jobsInRun.filter((j) => j.phase === "skipped" && j.reason !== "low_fit");
    else if (filter === "failed") filtered = jobsInRun.filter((j) => j.phase === "manual_required" || j.phase === "error");

    jobsContainer.innerHTML = filtered.map(renderScannedJobRow).join("") || `<div class="empty-state">No matching jobs.</div>`;
  });

  const events = await fetchEvents(runId);
  const timelineEl = container.querySelector("#run-timeline");
  if (timelineEl) timelineEl.innerHTML = renderTimeline(events);
}

function renderRunList(container) {
  const runsById = container._runsData || {};
  let runIds = Object.keys(runsById);

  // Collect all unique models across all runs
  const allModelsSet = new Set();
  runIds.forEach((id) => {
    (runsById[id].models_used || []).forEach((m) => allModelsSet.add(m));
  });
  allJobsRef.forEach((j) => {
    if (j.model_used) allModelsSet.add(j.model_used);
    if (j.tailor_model_used) allModelsSet.add(j.tailor_model_used);
    if (j.apply_model_used) allModelsSet.add(j.apply_model_used);
  });
  const modelOptions = Array.from(allModelsSet).sort();

  // Date range filter
  const range = presetRange(activeRunPreset);
  if (activeRunPreset === "custom" && runCustomStart && runCustomEnd) {
    range.start = new Date(`${runCustomStart}T00:00:00Z`);
    range.end = new Date(`${runCustomEnd}T23:59:59Z`);
  }

  // Filter runs
  const filteredRunIds = runIds.filter((id) => {
    const run = runsById[id];
    const started = run.started_at;

    // Date filter
    if (!isWithinRange(started, range)) return false;

    // Status filter
    if (activeStatusFilter !== "all") {
      if (activeStatusFilter === "completed" && run.status !== "completed") return false;
      if (activeStatusFilter === "in_progress" && run.status !== "in_progress") return false;
      if (activeStatusFilter === "paused" && run.status !== "paused") return false;
      if (activeStatusFilter === "error" && run.status !== "error" && run.status !== "failed") return false;
      if (activeStatusFilter === "has_fallbacks" && (!run.fallbacks_used || run.fallbacks_used.length === 0)) return false;
      if (activeStatusFilter === "step_filter" && run.last_step_executed !== "filter") return false;
      if (activeStatusFilter === "step_score" && run.last_step_executed !== "score") return false;
      if (activeStatusFilter === "step_tailor" && run.last_step_executed !== "tailor") return false;
      if (activeStatusFilter === "step_apply" && run.last_step_executed !== "apply") return false;
    }

    // Model filter
    if (activeModelFilter !== "all") {
      const models = run.models_used || [];
      const jobsInRun = allJobsRef.filter((j) => j.run_id === id);
      const jobModels = jobsInRun.map((j) => j.model_used || j.tailor_model_used || j.apply_model_used);
      if (!models.includes(activeModelFilter) && !jobModels.includes(activeModelFilter)) return false;
    }

    // Search filter
    if (runSearchQuery) {
      const q = runSearchQuery.toLowerCase();
      const matchId = id.toLowerCase().includes(q);
      const matchReason = (run.stop_reason || "").toLowerCase().includes(q);
      const matchStatus = (run.status || "").toLowerCase().includes(q);
      if (!matchId && !matchReason && !matchStatus) return false;
    }

    return true;
  });

  // Sort descending by started_at
  filteredRunIds.sort((a, b) => (runsById[b].started_at || "").localeCompare(runsById[a].started_at || ""));

  // Group by date (runs per day) using IST calendar date
  const groupedByDate = new Map(); // "YYYY-MM-DD" in IST -> array of runIds
  filteredRunIds.forEach((id) => {
    const started = runsById[id].started_at;
    const dateKey = started ? getISTDateString(started) : "Unknown Date";
    if (!groupedByDate.has(dateKey)) groupedByDate.set(dateKey, []);
    groupedByDate.get(dateKey).push(id);
  });

  const presetOpts = DATE_PRESETS.map(
    (k) => `<option value="${k}" ${k === activeRunPreset ? "selected" : ""}>${escapeHtml(DATE_PRESET_LABELS[k])}</option>`
  ).join("");

  const modelOptsHtml = `<option value="all">All Models</option>` +
    modelOptions.map((m) => `<option value="${escapeHtml(m)}" ${m === activeModelFilter ? "selected" : ""}>${escapeHtml(m)}</option>`).join("");

  let groupsHtml = "";
  if (groupedByDate.size === 0) {
    groupsHtml = `<div class="empty-state">No runs match the selected date or filters.</div>`;
  } else {
    for (const [dateKey, ids] of groupedByDate.entries()) {
      const prettyDate = formatDate(dateKey);
      groupsHtml += `
        <div class="run-day-group">
          <div class="run-day-header">
            <h3>${escapeHtml(prettyDate)}</h3>
            <span class="day-count-badge">${ids.length} run${ids.length === 1 ? "" : "s"}</span>
          </div>
          <div class="run-day-cards">
            ${ids.map((id) => renderRunCard(id, runsById[id])).join("")}
          </div>
        </div>
      `;
    }
  }

  container.innerHTML = `
    <div class="runs-view-wrapper">
      <div class="toolbar runs-toolbar">
        <div class="toolbar-group">
          <label for="runs-date-preset">Date range:</label>
          <select id="runs-date-preset" class="select-input">${presetOpts}</select>
        </div>
        <div id="runs-custom-dates" class="toolbar-group ${activeRunPreset === "custom" ? "" : "hidden"}">
          <input type="date" id="runs-start" value="${escapeHtml(runCustomStart || "")}" />
          <span>to</span>
          <input type="date" id="runs-end" value="${escapeHtml(runCustomEnd || "")}" />
        </div>
        <div class="toolbar-group">
          <label for="runs-status-select">Status / Step:</label>
          <select id="runs-status-select" class="select-input">
            <option value="all" ${activeStatusFilter === "all" ? "selected" : ""}>All Statuses</option>
            <option value="completed" ${activeStatusFilter === "completed" ? "selected" : ""}>Completed</option>
            <option value="in_progress" ${activeStatusFilter === "in_progress" ? "selected" : ""}>In Progress</option>
            <option value="paused" ${activeStatusFilter === "paused" ? "selected" : ""}>Paused</option>
            <option value="step_filter" ${activeStatusFilter === "step_filter" ? "selected" : ""}>Stopped at Pre-filter</option>
            <option value="step_score" ${activeStatusFilter === "step_score" ? "selected" : ""}>Stopped at Scoring</option>
            <option value="step_tailor" ${activeStatusFilter === "step_tailor" ? "selected" : ""}>Tailored</option>
            <option value="step_apply" ${activeStatusFilter === "step_apply" ? "selected" : ""}>Applied</option>
            <option value="has_fallbacks" ${activeStatusFilter === "has_fallbacks" ? "selected" : ""}>Has Fallbacks ⚠️</option>
            <option value="error" ${activeStatusFilter === "error" ? "selected" : ""}>Failed / Error</option>
          </select>
        </div>
        <div class="toolbar-group">
          <label for="runs-model-select">Model:</label>
          <select id="runs-model-select" class="select-input">${modelOptsHtml}</select>
        </div>
        <div class="toolbar-group toolbar-search">
          <input type="text" id="runs-search-input" placeholder="Search runs by ID or reason…" value="${escapeHtml(runSearchQuery)}" />
        </div>
      </div>

      <div class="result-count">${filteredRunIds.length} run${filteredRunIds.length === 1 ? "" : "s"} across ${groupedByDate.size} day${groupedByDate.size === 1 ? "" : "s"}</div>
      <div id="runs-grouped-list">${groupsHtml}</div>
    </div>
  `;

  // Attach toolbar listeners
  container.querySelector("#runs-date-preset").addEventListener("change", (e) => {
    activeRunPreset = e.target.value;
    const customEl = container.querySelector("#runs-custom-dates");
    if (activeRunPreset === "custom") {
      customEl.classList.remove("hidden");
    } else {
      customEl.classList.add("hidden");
      renderRunList(container);
    }
  });

  const startEl = container.querySelector("#runs-start");
  const endEl = container.querySelector("#runs-end");
  if (startEl && endEl) {
    const onDate = () => {
      runCustomStart = startEl.value;
      runCustomEnd = endEl.value;
      if (runCustomStart && runCustomEnd) renderRunList(container);
    };
    startEl.addEventListener("change", onDate);
    endEl.addEventListener("change", onDate);
  }

  container.querySelector("#runs-status-select").addEventListener("change", (e) => {
    activeStatusFilter = e.target.value;
    renderRunList(container);
  });

  container.querySelector("#runs-model-select").addEventListener("change", (e) => {
    activeModelFilter = e.target.value;
    renderRunList(container);
  });

  const searchEl = container.querySelector("#runs-search-input");
  searchEl.addEventListener("input", (e) => {
    runSearchQuery = e.target.value.trim();
    renderRunList(container);
  });

  // Card click -> detail
  container.querySelector("#runs-grouped-list").addEventListener("click", (e) => {
    const card = e.target.closest(".run-card");
    if (!card) return;
    renderRunDetail(container, card.dataset.runId, runsById[card.dataset.runId]);
  });
}

export function initRunsView(container, runsData, allJobs) {
  allJobsRef = allJobs;
  registerJobs(allJobs);
  container._runsData = runsData;
  renderRunList(container);
}
