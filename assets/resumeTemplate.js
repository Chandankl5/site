// Renders a resume-shaped JSON (same schema as data/resume_base.example.json)
// as a styled, single-column HTML resume — used to show exactly what was
// submitted for a given application (docs/data/resumes/<job_id>.json).

import { escapeHtml } from "./util.js";

function contactLine(basics) {
  const parts = [];
  if (basics.location) parts.push(basics.location);
  if (basics.email) parts.push(basics.email);
  if (basics.phone) parts.push(basics.phone);
  for (const link of basics.links || []) parts.push(link);
  return parts.map((p) => `<span>${escapeHtml(p)}</span>`).join("");
}

function renderSkills(skills) {
  if (!skills || typeof skills !== "object") return "";
  return Object.entries(skills)
    .map(([category, items]) => `<div><b>${escapeHtml(category)}:</b> ${escapeHtml((items || []).join(", "))}</div>`)
    .join("");
}

function renderExperience(experience) {
  if (!Array.isArray(experience) || !experience.length) return "";
  return experience
    .map((exp) => {
      const bullets = (exp.bullets || []).map((b) => `<li>${escapeHtml(b)}</li>`).join("");
      return `
        <div class="r-exp-item">
          <div class="r-exp-head">
            <span>${escapeHtml(exp.title)}${exp.company ? " · " + escapeHtml(exp.company) : ""}</span>
            <span>${escapeHtml(exp.start)} – ${escapeHtml(exp.end)}</span>
          </div>
          <div class="r-exp-sub">${escapeHtml(exp.location)}</div>
          <ul class="r-bullets">${bullets}</ul>
        </div>`;
    })
    .join("");
}

function renderEducation(education) {
  if (!Array.isArray(education) || !education.length) return "";
  return education
    .map((edu) => {
      const dates = edu.start ? `${edu.start} – ${edu.end || "Present"}` : edu.year || "";
      return `<div class="r-edu-item"><b>${escapeHtml(edu.degree)}</b>, ${escapeHtml(edu.institution)}${
        edu.location ? " — " + escapeHtml(edu.location) : ""
      } ${dates ? "(" + escapeHtml(dates) + ")" : ""}</div>`;
    })
    .join("");
}

function renderCertifications(certifications) {
  if (!Array.isArray(certifications) || !certifications.length) return "";
  return `<h4>Certifications</h4><div class="r-edu-item">${certifications.map(escapeHtml).join(", ")}</div>`;
}

function renderProjects(projects) {
  if (!Array.isArray(projects) || !projects.length) return "";
  const items = projects
    .map((p) => {
      const bullets = (p.bullets || []).map((b) => `<li>${escapeHtml(b)}</li>`).join("");
      return `<div class="r-proj-item"><b>${escapeHtml(p.name)}</b>${
        p.tech ? " — " + escapeHtml(p.tech) : ""
      }<ul class="r-bullets">${bullets}</ul></div>`;
    })
    .join("");
  return `<h4>Projects</h4>${items}`;
}

export function renderResumeHTML(resume) {
  if (!resume || !resume.basics) {
    return `<div class="empty-state">No tailored resume available for this job yet.</div>`;
  }
  const { basics, summary, skills, experience, education, certifications, projects } = resume;
  return `
    <div class="resume-preview">
      <p class="r-name">${escapeHtml(basics.name)}</p>
      <p class="r-title">${escapeHtml(basics.title)}</p>
      <p class="r-contact">${contactLine(basics)}</p>

      ${summary ? `<h4>Summary</h4><p class="r-summary">${escapeHtml(summary)}</p>` : ""}
      ${skills ? `<h4>Skills</h4><div class="r-skills-grid">${renderSkills(skills)}</div>` : ""}
      ${experience && experience.length ? `<h4>Experience</h4>${renderExperience(experience)}` : ""}
      ${education && education.length ? `<h4>Education</h4>${renderEducation(education)}` : ""}
      ${renderCertifications(certifications)}
      ${renderProjects(projects)}
    </div>`;
}
