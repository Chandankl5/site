// Runs tab: run cards list + run detail (search context, events timeline,
// scoped job list). Reuses the Job Board's row/detail rendering.

import { formatDate, formatDateTime, escapeHtml } from "./util.js";
import { renderJobRow, openJobDetail, registerJobs } from "./jobBoard.js";

let allJobsRef = [];
let eventsCache = new Map(); // run_id -> events array

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

function renderRunCard(runId, run) {
  const counts = run.counts || {};
  return `
    <div class="run-card" data-run-id="${escapeHtml(runId)}">
      <div class="run-id">${escapeHtml(runId)}</div>
      <div class="run-meta">
        <span class="badge badge-pending">${escapeHtml(run.status || "unknown")}</span>
        phase: ${escapeHtml(run.phase || "—")} ·
        started ${formatDateTime(run.started_at)}${run.completed_at ? " · completed " + formatDateTime(run.completed_at) : ""}
      </div>
      <div class="run-counts">
        <span>Discovered <b>${counts.discovered ?? 0}</b></span>
        <span>Scored <b>${counts.scored ?? 0}</b></span>
        <span>Tailored <b>${counts.tailored ?? 0}</b></span>
        <span>Applied <b>${counts.applied ?? 0}</b></span>
        <span>Skipped <b>${counts.skipped ?? 0}</b></span>
      </div>
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

function renderSearchContext(ctx) {
  if (!ctx) return `<div class="empty-state">No search context recorded.</div>`;
  return `<div class="section-block">
    <h3>Search Context</h3>
    ${Object.entries(ctx)
      .map(([k, v]) => `<p><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</p>`)
      .join("")}
  </div>`;
}

async function renderRunDetail(container, runId, run) {
  const jobsInRun = allJobsRef.filter((j) => j.run_id === runId);
  container.innerHTML = `
    <span class="back-link" id="run-back">&larr; Back to all runs</span>
    <div class="detail-header">
      <h2>${escapeHtml(runId)}</h2>
      <div class="sub">status: ${escapeHtml(run.status || "—")} · phase: ${escapeHtml(run.phase || "—")}</div>
    </div>
    ${renderSearchContext(run.search_context)}
    <div class="section-block">
      <h3>Timeline</h3>
      <div id="run-timeline"><div class="empty-state">Loading…</div></div>
    </div>
    <div class="section-block">
      <h3>Jobs in this run (${jobsInRun.length})</h3>
      <div class="job-list" id="run-jobs">${jobsInRun.map(renderJobRow).join("") || `<div class="empty-state">No jobs.</div>`}</div>
    </div>
  `;

  container.querySelector("#run-back").addEventListener("click", () => renderRunList(container));
  container.querySelector("#run-jobs").addEventListener("click", (e) => {
    const row = e.target.closest(".job-row");
    if (!row) return;
    const job = jobsInRun.find((j) => j.job_id === row.dataset.jobId);
    if (job) openJobDetail(job);
  });

  const events = await fetchEvents(runId);
  const timelineEl = container.querySelector("#run-timeline");
  if (timelineEl) timelineEl.innerHTML = renderTimeline(events);
}

function renderRunList(container) {
  const runsById = container._runsData;
  const runIds = Object.keys(runsById).sort((a, b) => (runsById[b].started_at || "").localeCompare(runsById[a].started_at || ""));
  container.innerHTML = `
    <div class="result-count">${runIds.length} run${runIds.length === 1 ? "" : "s"}</div>
    <div id="runs-list">${runIds.map((id) => renderRunCard(id, runsById[id])).join("")}</div>
  `;
  container.querySelector("#runs-list").addEventListener("click", (e) => {
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
