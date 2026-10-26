import { initJobBoard, closeDetail } from "./jobBoard.js";
import { initRunsView } from "./runsView.js";

function setupTabs() {
  const tabs = document.getElementById("tabs");
  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    tabs.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    document.getElementById(`view-${btn.dataset.tab}`).classList.remove("hidden");
  });
}

function setupOverlayClose() {
  const overlay = document.getElementById("detail-overlay");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDetail();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
  });
}

// Returns null on a missing/failed fetch so callers can tell "not built yet"
// apart from "built, but genuinely empty."
async function fetchJson(path) {
  try {
    const res = await fetch(path);
    return res.ok ? await res.json() : null;
  } catch (e) {
    console.error(`Failed to load ${path}`, e);
    return null;
  }
}

function renderNoDataState() {
  document.querySelector("main").innerHTML = `
    <div class="empty-state">
      <p><b>No published data found.</b></p>
      <p>Run <code>npm run build-site</code> in the project root to generate
      <code>docs/data/</code> from your job-application state, then reload this page.</p>
    </div>`;
}

async function main() {
  setupTabs();
  setupOverlayClose();

  // manifest.json always exists once build_site_data.js has run at least
  // once (even with zero jobs) — its absence means the site was never built.
  const manifest = await fetchJson("data/manifest.json");
  if (!manifest) {
    renderNoDataState();
    return;
  }

  const [runsData, jobs] = await Promise.all([fetchJson("data/runs.json"), fetchJson("data/jobs.json")]);

  const generatedAtEl = document.getElementById("generated-at");
  if (generatedAtEl && manifest.generated_at) {
    generatedAtEl.textContent = `data as of ${new Date(manifest.generated_at).toLocaleString()}`;
  }

  initJobBoard(document.getElementById("view-jobs"), jobs || []);
  initJobBoard(document.getElementById("view-manual"), jobs || [], { manualOnly: true, idPrefix: "manual" });
  initRunsView(document.getElementById("view-runs"), (runsData && runsData.runs) || {}, jobs || []);
}

main();
