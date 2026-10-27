// Topbar widget: today's per-model LLM usage against free-tier caps
// (data/llm_usage.json, published by scripts/build_site_data.js from
// state/llm_provider_state.json — no PII, just counters). Always renders
// ALL FOUR known models across the whole pipeline (score/tailor +
// apply), not just whichever ones happened to get called today — a model
// with zero calls today still shows a 0% meter, so you can see the full
// pipeline's status at a glance instead of the panel silently shrinking to
// only "whatever ran today" (confirmed live: on a day apply was tested but
// score/tailor weren't, their two meters were completely missing).

import { escapeHtml } from "./util.js";

// One entry per model actually used ANYWHERE in this pipeline — the
// authoritative list, not derived from whatever happens to be in a given
// day's state file. provider/unit/cap-field drive which counters.groq_usage/
// gemini_usage field and cap this model reads from.
const KNOWN_MODELS = [
  { model: "openai/gpt-oss-120b", stage: "score/tailor", provider: "groq", metric: "tokens_today", capField: "groq_tpd_safety_cap", defaultCap: 180000, unit: "tok" },
  { model: "openai/gpt-oss-20b", stage: "apply", provider: "groq", metric: "tokens_today", capField: "groq_tpd_safety_cap", defaultCap: 180000, unit: "tok" },
  { model: "gemini-3.8-flash", stage: "score/tailor", provider: "gemini", metric: "calls", capField: "gemini_daily_cap", defaultCap: 20, unit: "req" },
  { model: "gemini-2.5-flash", stage: "score/tailor (fallback)", provider: "gemini", metric: "calls", capField: "gemini_daily_cap", defaultCap: 20, unit: "req" },
  { model: "gemini-3.8-flash-lite", stage: "apply", provider: "gemini", metric: "calls", capField: "gemini_daily_cap", defaultCap: 20, unit: "req" },
  { model: "gemini-3.5-flash-lite", stage: "apply (fallback)", provider: "gemini", metric: "calls", capField: "gemini_daily_cap", defaultCap: 20, unit: "req" },
  { model: "gemini-2.5-flash-lite", stage: "apply (fallback)", provider: "gemini", metric: "calls", capField: "gemini_daily_cap", defaultCap: 20, unit: "req" },
];

const STAGE_BY_MODEL = Object.fromEntries(KNOWN_MODELS.map((m) => [m.model, m.stage]));

function stageLabel(model) {
  const stage = STAGE_BY_MODEL[model];
  return stage ? `${model} (${stage})` : model;
}

function pct(used, cap) {
  if (!cap) return 0;
  return Math.max(0, Math.min(100, Math.round((used / cap) * 100)));
}

function barClass(p) {
  if (p >= 90) return "usage-bar-fill usage-bar-danger";
  if (p >= 70) return "usage-bar-fill usage-bar-warn";
  return "usage-bar-fill";
}

function renderMeter(label, used, cap, benched, unit) {
  const p = pct(used, cap);
  return `
    <div class="usage-meter">
      <div class="usage-meter-label">
        ${escapeHtml(label)}
        ${benched ? '<span class="badge badge-manual_required">benched</span>' : ""}
      </div>
      <div class="usage-bar-track">
        <div class="${barClass(p)}" style="width:${p}%"></div>
      </div>
      <div class="usage-meter-value">${used.toLocaleString()} / ${cap.toLocaleString()} ${escapeHtml(unit)} (${p}%)</div>
    </div>`;
}

export function renderLlmUsage(container, usage) {
  if (!usage) {
    container.innerHTML = "";
    return;
  }

  const usageField = { groq: "groq_usage", gemini: "gemini_usage" };
  const meters = KNOWN_MODELS.map((m) => {
    const entry = (usage[usageField[m.provider]] || {})[m.model] || {};
    const used = entry[m.metric] || 0;
    const cap = usage[m.capField] || m.defaultCap;
    const unitLabel = m.unit === "tok" ? "tokens" : "requests";
    return renderMeter(`${stageLabel(m.model)} (${unitLabel})`, used, cap, !!entry.benched, m.unit);
  });

  const dateLabel = usage.date || "no calls recorded yet";
  container.innerHTML = `
    <div class="llm-usage-panel">
      <div class="llm-usage-header">LLM usage today (${escapeHtml(dateLabel)})</div>
      ${meters.join("")}
    </div>`;
}
