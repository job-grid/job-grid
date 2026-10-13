import {
  formatEmploymentType,
  formatPublicLocation,
  formatPublicSalary,
  normalizePublicJob
} from "./public-job-data.js";

const status = document.querySelector("#job-detail-status");
const panel = document.querySelector("#job-detail-panel");

function setStatus(message, tone = "neutral") {
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

async function loadJobDetail() {
  const slug = new URLSearchParams(window.location.search).get("slug") || "";
  if (!slug.trim() || slug.length > 200 || /[\u0000-\u001f\u007f]/.test(slug)) {
    setStatus("Choose a job from the search page to view its details.", "empty");
    return;
  }

  setStatus("Loading published job details…", "loading");
  try {
    const response = await fetch("/api/v1/jobs/" + encodeURIComponent(slug), {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store"
    });
    if (response.status === 404) {
      setStatus("This job is not available. It may have expired or is no longer published.", "empty");
      return;
    }
    if (!response.ok) throw new Error("unavailable");

    const payload = await response.json();
    const raw = payload && typeof payload === "object" ? payload.data : null;
    const job = normalizePublicJob(raw, Date.now(), true);
    if (!job) {
      setStatus("This job is not available as a current published vacancy.", "empty");
      return;
    }

    setText("job-detail-title", job.title);
    setText("job-detail-employer", job.organization.displayName + (job.organization.verified ? " · Verified employer" : ""));
    setText("job-detail-location", formatPublicLocation(job.location));
    setText("job-detail-employment", formatEmploymentType(job.employmentType));
    setText("job-detail-salary", formatPublicSalary(job.salary));
    setText("job-detail-reference", job.reference ? "Reference: " + job.reference : "");
    setText("job-detail-description", job.description || "The employer has not provided a public description.");
    setText("job-detail-instructions", job.applicationInstructions || "Application instructions are not available in the public response.");
    panel.hidden = false;
    setStatus("Published vacancy details loaded.", "success");
  } catch {
    setStatus("The Job Grid jobs service is not connected or is temporarily unavailable. No sample job details are shown.", "error");
  }
}

if (status && panel) void loadJobDetail();
