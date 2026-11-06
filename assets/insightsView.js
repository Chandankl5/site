// Insights tab: Daily model token consumption, jobs scored/tailored/applied per model,
// date range filter with presets, summary KPI cards, grouped (unstacked) side-by-side SVG charts,
// and interactive model filter pills.

import {
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  presetRange,
  isWithinRange,
  formatDate,
  escapeHtml,
} from "./util.js";

const MODEL_COLORS = {
  "gemini-3.8-flash": "#4285F4",
  "gemini-2.5-flash": "#34A853",
  "openai/gpt-oss-120b": "#FBBC05",
  "gemini-3.8-flash-lite": "#EA4335",
  "gemini-2.5-flash-lite": "#9C27B0",
  "openai/gpt-oss-20b": "#FF9800",
  default: "#00BCD4",
};

function getModelColor(model) {
  return MODEL_COLORS[model] || MODEL_COLORS.default;
}

let activePreset = "last7";
let activeModelFilter = "all";
let customStart = null;
let customEnd = null;
let cachedInsights = null;

function filterDailyEntries(dailyMap, range) {
  const dates = Object.keys(dailyMap || {}).sort();
  return dates
    .filter((d) => isWithinRange(d, range))
    .map((d) => dailyMap[d]);
}

function renderKpiCard(title, value, subtext, icon) {
  return `
    <div class="kpi-card">
      <div class="kpi-header">
        <span class="kpi-title">${escapeHtml(title)}</span>
        ${icon ? `<span class="kpi-icon">${icon}</span>` : ""}
      </div>
      <div class="kpi-value">${typeof value === "number" ? value.toLocaleString() : escapeHtml(value)}</div>
      ${subtext ? `<div class="kpi-subtext">${escapeHtml(subtext)}</div>` : ""}
    </div>`;
}

/**
 * Generates an UNSTACKED grouped (clustered) side-by-side SVG bar chart.
 * Every model has its own individual bar standing directly on the baseline (Y=0).
 *
 * @param {string} title - Chart title
 * @param {Array<{label: string, series: Array<{name: string, value: number, color: string}>}>} data
 * @param {string} valueUnit - "tokens" | "jobs" | "resumes" | "applications"
 * @param {string} filterModel - "all" or specific model name
 */
function renderSvgChart(title, data, valueUnit = "", filterModel = "all") {
  if (!data || data.length === 0) {
    return `
      <div class="chart-box">
        <h4>${escapeHtml(title)}</h4>
        <div class="chart-empty">No activity recorded for this period.</div>
      </div>`;
  }

  // Filter series per model if requested
  const filteredData = data.map((d) => ({
    label: d.label,
    series: (d.series || []).filter((s) => (filterModel === "all" ? true : s.name === filterModel)),
  }));

  // Collect all unique model names present in this chart
  const modelNames = new Set();
  let maxVal = 0;
  for (const item of filteredData) {
    for (const s of item.series) {
      modelNames.add(s.name);
      if (s.value > maxVal) maxVal = s.value;
    }
  }
  if (maxVal === 0) maxVal = 5;

  const modelsList = Array.from(modelNames).sort();
  const numModels = Math.max(1, modelsList.length);

  // Chart dimensions
  const width = 560;
  const height = 230;
  const paddingLeft = 58;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 42;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;
  const baselineY = paddingTop + plotHeight;

  const numDays = Math.max(1, filteredData.length);
  const dayGroupWidth = plotWidth / numDays;
  const groupPadding = Math.max(6, dayGroupWidth * 0.15);
  const usableGroupWidth = dayGroupWidth - groupPadding;
  const singleBarWidth = Math.max(3, Math.min(22, (usableGroupWidth - (numModels - 1) * 2) / numModels));

  // Y-axis gridlines
  const gridSteps = 4;
  let gridLines = "";
  for (let i = 0; i <= gridSteps; i++) {
    const val = Math.round((maxVal / gridSteps) * i);
    const y = baselineY - (plotHeight / gridSteps) * i;
    gridLines += `
      <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="var(--border-color, #333)" stroke-dasharray="2,3" opacity="0.4" />
      <text x="${paddingLeft - 8}" y="${y + 3}" text-anchor="end" font-size="10" fill="var(--text-muted, #888)">${val >= 1000 ? (val / 1000).toFixed(1) + "k" : val}</text>
    `;
  }

  // Side-by-side grouped bars
  let barsSvg = "";
  filteredData.forEach((dayItem, dayIdx) => {
    const groupLeft = paddingLeft + dayIdx * dayGroupWidth + groupPadding / 2;
    const groupCenterX = paddingLeft + dayIdx * dayGroupWidth + dayGroupWidth / 2;

    modelsList.forEach((modelName, mIdx) => {
      const match = dayItem.series.find((s) => s.name === modelName);
      const val = match ? match.value : 0;
      const barX = groupLeft + mIdx * (singleBarWidth + 2);
      const barH = val > 0 ? Math.max(2, (val / maxVal) * plotHeight) : 1;
      const barY = baselineY - barH;
      const color = getModelColor(modelName);
      const opacity = val > 0 ? "0.9" : "0.2";

      barsSvg += `
        <rect x="${barX}" y="${barY}" width="${singleBarWidth}" height="${barH}" rx="2" fill="${color}" opacity="${opacity}">
          <title>${escapeHtml(dayItem.label)} · ${escapeHtml(modelName)}: ${val.toLocaleString()} ${escapeHtml(valueUnit)}</title>
        </rect>
      `;
    });

    // Date label on X-axis (shortened MM-DD)
    const shortLabel = dayItem.label.length > 5 ? dayItem.label.slice(5) : dayItem.label;
    barsSvg += `
      <text x="${groupCenterX}" y="${height - 14}" text-anchor="middle" font-size="10" fill="var(--text-muted, #888)">${escapeHtml(shortLabel)}</text>
    `;
  });

  // Legend
  const legendHtml = modelsList
    .map(
      (name) => `
      <span class="chart-legend-item">
        <span class="chart-legend-dot" style="background:${getModelColor(name)}"></span>
        <span class="chart-legend-label">${escapeHtml(name)}</span>
      </span>`
    )
    .join("");

  return `
    <div class="chart-box">
      <div class="chart-header">
        <h4>${escapeHtml(title)}</h4>
        <div class="chart-legend">${legendHtml || "<span>No model data</span>"}</div>
      </div>
      <div class="svg-container">
        <svg viewBox="0 0 ${width} ${height}" class="metric-chart-svg" preserveAspectRatio="xMidYMid meet">
          ${gridLines}
          ${barsSvg}
        </svg>
      </div>
    </div>`;
}

function renderInsightsTable(dailyList) {
  if (!dailyList.length) {
    return `<div class="empty-state">No daily insights data found for selected period.</div>`;
  }

  // Sort dates descending (newest first)
  const sortedDays = [...dailyList].reverse();
  const rows = [];

  sortedDays.forEach((day) => {
    let dayModels = new Set([
      ...Object.keys(day.tokens_by_model || {}),
      ...Object.keys(day.jobs_scored_by_model || {}),
      ...Object.keys(day.jobs_tailored_by_model || {}),
      ...Object.keys(day.jobs_applied_by_model || {}),
    ]);

    if (activeModelFilter !== "all") {
      dayModels = new Set(Array.from(dayModels).filter((m) => m === activeModelFilter));
    }

    if (!dayModels.size) {
      if (activeModelFilter === "all") {
        rows.push(`
          <tr class="day-row-empty">
            <td><b>${formatDate(day.date)}</b></td>
            <td colspan="5" style="color:var(--text-muted);">No LLM activity recorded on this date</td>
          </tr>
        `);
      }
      return;
    }

    const modelsArr = Array.from(dayModels);
    modelsArr.forEach((model, idx) => {
      const tokens = (day.tokens_by_model && day.tokens_by_model[model]) || 0;
      const scored = (day.jobs_scored_by_model && day.jobs_scored_by_model[model]) || 0;
      const tailored = (day.jobs_tailored_by_model && day.jobs_tailored_by_model[model]) || 0;
      const applied = (day.jobs_applied_by_model && day.jobs_applied_by_model[model]) || 0;

      rows.push(`
        <tr>
          ${idx === 0 ? `<td rowspan="${modelsArr.length}"><b>${formatDate(day.date)}</b></td>` : ""}
          <td>
            <span class="chart-legend-dot" style="background:${getModelColor(model)};display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;"></span>
            ${escapeHtml(model)}
          </td>
          <td><b>${tokens.toLocaleString()}</b> tok</td>
          <td>${scored}</td>
          <td>${tailored}</td>
          <td>${applied}</td>
        </tr>
      `);
    });
  });

  return `
    <div class="table-container">
      <table class="insights-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Model</th>
            <th>Tokens Spent</th>
            <th>Jobs Scored</th>
            <th>Resumes Tailored</th>
            <th>Jobs Applied</th>
          </tr>
        </thead>
        <tbody>
          ${rows.join("")}
        </tbody>
      </table>
    </div>`;
}

function renderContent(container, insightsData) {
  const range = presetRange(activePreset);
  if (activePreset === "custom" && customStart && customEnd) {
    range.start = new Date(`${customStart}T00:00:00Z`);
    range.end = new Date(`${customEnd}T23:59:59Z`);
  }

  const dailyEntries = filterDailyEntries(insightsData.daily, range);

  // Collect all known models across the filtered period
  const allModelsSet = new Set();
  dailyEntries.forEach((day) => {
    Object.keys(day.tokens_by_model || {}).forEach((m) => allModelsSet.add(m));
    Object.keys(day.jobs_scored_by_model || {}).forEach((m) => allModelsSet.add(m));
    Object.keys(day.jobs_tailored_by_model || {}).forEach((m) => allModelsSet.add(m));
    Object.keys(day.jobs_applied_by_model || {}).forEach((m) => allModelsSet.add(m));
  });
  const modelPillOptions = ["all", ...Array.from(allModelsSet).sort()];

  // Aggregated KPI calculations for range (respects activeModelFilter)
  let rangeTokens = 0;
  let rangeScored = 0;
  let rangeTailored = 0;
  let rangeApplied = 0;
  let rangeFallbacks = 0;

  dailyEntries.forEach((day) => {
    if (activeModelFilter === "all") {
      rangeTokens += day.total_tokens || 0;
      rangeScored += day.total_scored || 0;
      rangeTailored += day.total_tailored || 0;
      rangeApplied += day.total_applied || 0;
      rangeFallbacks += day.fallbacks_count || 0;
    } else {
      rangeTokens += (day.tokens_by_model && day.tokens_by_model[activeModelFilter]) || 0;
      rangeScored += (day.jobs_scored_by_model && day.jobs_scored_by_model[activeModelFilter]) || 0;
      rangeTailored += (day.jobs_tailored_by_model && day.jobs_tailored_by_model[activeModelFilter]) || 0;
      rangeApplied += (day.jobs_applied_by_model && day.jobs_applied_by_model[activeModelFilter]) || 0;
    }
  });

  const totalActions = rangeScored + rangeTailored + rangeApplied;
  const fallbackRate = totalActions > 0 ? ((rangeFallbacks / totalActions) * 100).toFixed(1) + "%" : "0%";

  // Prepare chart datasets
  const tokenChartData = dailyEntries.map((day) => ({
    label: day.date,
    series: Object.entries(day.tokens_by_model || {}).map(([m, tok]) => ({
      name: m,
      value: tok,
      color: getModelColor(m),
    })),
  }));

  const scoredChartData = dailyEntries.map((day) => ({
    label: day.date,
    series: Object.entries(day.jobs_scored_by_model || {}).map(([m, cnt]) => ({
      name: m,
      value: cnt,
      color: getModelColor(m),
    })),
  }));

  const tailoredChartData = dailyEntries.map((day) => ({
    label: day.date,
    series: Object.entries(day.jobs_tailored_by_model || {}).map(([m, cnt]) => ({
      name: m,
      value: cnt,
      color: getModelColor(m),
    })),
  }));

  const appliedChartData = dailyEntries.map((day) => ({
    label: day.date,
    series: Object.entries(day.jobs_applied_by_model || {}).map(([m, cnt]) => ({
      name: m,
      value: cnt,
      color: getModelColor(m),
    })),
  }));

  const presetOptions = DATE_PRESETS.map(
    (key) => `<option value="${key}" ${key === activePreset ? "selected" : ""}>${escapeHtml(DATE_PRESET_LABELS[key])}</option>`
  ).join("");

  const modelPillsHtml = modelPillOptions
    .map(
      (m) => `
      <button class="pill ${m === activeModelFilter ? "active" : ""}" data-model="${escapeHtml(m)}">
        ${m === "all" ? "All Models" : `<span class="chart-legend-dot" style="background:${getModelColor(m)};display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;"></span>` + escapeHtml(m)}
      </button>`
    )
    .join("");

  container.innerHTML = `
    <div class="insights-view">
      <div class="toolbar insights-toolbar">
        <div class="toolbar-group">
          <label for="insights-preset">Date range:</label>
          <select id="insights-preset" class="select-input">${presetOptions}</select>
        </div>
        <div id="insights-custom-dates" class="toolbar-group ${activePreset === "custom" ? "" : "hidden"}">
          <input type="date" id="insights-start" value="${escapeHtml(customStart || "")}" />
          <span>to</span>
          <input type="date" id="insights-end" value="${escapeHtml(customEnd || "")}" />
        </div>
        <div class="toolbar-group model-pills-group">
          <label>Filter Model:</label>
          <div class="pills-row" id="insights-model-pills">
            ${modelPillsHtml}
          </div>
        </div>
      </div>

      <div class="kpi-grid">
        ${renderKpiCard("Tokens Consumed", rangeTokens, activeModelFilter === "all" ? "All models in period" : activeModelFilter, "⚡")}
        ${renderKpiCard("Jobs Scored", rangeScored, "Evaluated by LLM", "🎯")}
        ${renderKpiCard("Resumes Tailored", rangeTailored, "ATS-optimized", "📄")}
        ${renderKpiCard("Applications Submitted", rangeApplied, "Direct submissions", "🚀")}
        ${renderKpiCard("Fallbacks Triggered", rangeFallbacks, `Rate: ${fallbackRate}`, "🔄")}
      </div>

      <div class="charts-grid">
        ${renderSvgChart("Daily Tokens Spent per Model (Side-by-Side)", tokenChartData, "tokens", activeModelFilter)}
        ${renderSvgChart("Jobs Scored per Model per Day (Side-by-Side)", scoredChartData, "jobs", activeModelFilter)}
        ${renderSvgChart("Resumes Tailored per Model per Day (Side-by-Side)", tailoredChartData, "resumes", activeModelFilter)}
        ${renderSvgChart("Applications Submitted per Day (Side-by-Side)", appliedChartData, "applications", activeModelFilter)}
      </div>

      <div class="section-block">
        <h3>Daily Model Breakdown</h3>
        ${renderInsightsTable(dailyEntries)}
      </div>
    </div>
  `;

  // Event handlers
  const presetEl = container.querySelector("#insights-preset");
  presetEl.addEventListener("change", (e) => {
    activePreset = e.target.value;
    const customGroup = container.querySelector("#insights-custom-dates");
    if (activePreset === "custom") {
      customGroup.classList.remove("hidden");
    } else {
      customGroup.classList.add("hidden");
      renderContent(container, cachedInsights);
    }
  });

  const startEl = container.querySelector("#insights-start");
  const endEl = container.querySelector("#insights-end");
  if (startEl && endEl) {
    const onDateChange = () => {
      customStart = startEl.value;
      customEnd = endEl.value;
      if (customStart && customEnd) renderContent(container, cachedInsights);
    };
    startEl.addEventListener("change", onDateChange);
    endEl.addEventListener("change", onDateChange);
  }

  const pillsContainer = container.querySelector("#insights-model-pills");
  if (pillsContainer) {
    pillsContainer.addEventListener("click", (e) => {
      const btn = e.target.closest(".pill");
      if (!btn) return;
      activeModelFilter = btn.dataset.model || "all";
      renderContent(container, cachedInsights);
    });
  }
}

export function initInsightsView(container, insightsData) {
  cachedInsights = insightsData || { daily: {}, totals: {} };
  renderContent(container, cachedInsights);
}
