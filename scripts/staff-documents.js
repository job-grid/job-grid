import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
const loginPanel = document.querySelector("#documents-login-panel");
const loginForm = document.querySelector("#documents-login-form");
const loginStatus = document.querySelector("#documents-login-status");
const workspace = document.querySelector("#documents-workspace");
const list = document.querySelector("#candidate-documents-list");
const summary = document.querySelector("#documents-summary");
const signOut = document.querySelector("#documents-sign-out");
const refresh = document.querySelector("#documents-refresh");
const search = document.querySelector("#documents-search");
const statusFilter = document.querySelector("#documents-status-filter");
let session = null;
let applications = [];
let requestGeneration = 0;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const label = (value) => String(value || "").replaceAll("_", " ");

function showSignedOut(message = "") {
  session = null;
  applications = [];
  workspace.hidden = true;
  loginPanel.hidden = false;
  list.replaceChildren();
  summary.textContent = "";
  if (message) loginStatus.textContent = message;
}

async function staffCall(method = "GET", body = null) {
  if (!session?.access_token) throw new Error("Your session has expired. Please sign in again.");
  const response = await fetch(SUPABASE_URL + "/functions/v1/staff-applications", {
    method,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: "Bearer " + session.access_token,
      ...(body ? {"Content-Type":"application/json"} : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) {
    await supabase.auth.signOut();
    throw new Error("Your session expired. Please sign in again.");
  }
  if (!response.ok) throw new Error(result.error || "Staff request failed.");
  return result;
}

function render() {
  const query = search.value.trim().toLowerCase();
  const wantedStatus = statusFilter.value;
  const rows = applications.filter(app => {
    const haystack = [app.full_name, app.email, app.id, app.country_code, app.city].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!wantedStatus || app.status === wantedStatus);
  });
  summary.textContent = rows.length + " document record(s) shown · " + applications.length + " recent applications loaded. CV access is audited and links expire after 60 seconds.";
  if (!rows.length) {
    list.innerHTML = '<p class="vacancy-empty">No candidate document records match this search. New CVs appear after a candidate submits an application.</p>';
    return;
  }
  list.innerHTML = rows.map(app => `<article class="vacancy-card" data-application="${esc(app.id)}">
    <div class="vacancy-meta"><span class="vacancy-tag">CV / résumé</span><span class="vacancy-tag">${esc(label(app.status))}</span></div>
    <h2>${esc(app.full_name)}</h2>
    <p class="vacancy-employer">${esc(app.email)}</p>
    <p><strong>Country:</strong> ${esc(app.country_code)}${app.city ? " · " + esc(app.city) : ""}</p>
    <p><strong>Submitted:</strong> ${esc(new Date(app.submitted_at).toLocaleString())}</p>
    <p class="vacancy-description">Application ID: ${esc(app.id)}</p>
    <p class="vacancy-description">Stored in private candidate storage. No public URL is exposed.</p>
    <div class="filter-actions"><button class="button button-primary open-document" type="button">Open secure CV</button></div>
    <p class="document-feedback" role="status" aria-live="polite"></p>
  </article>`).join("");
  for (const card of list.querySelectorAll("[data-application]")) {
    const id = card.dataset.application;
    const feedback = card.querySelector(".document-feedback");
    card.querySelector(".open-document").addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      feedback.textContent = "Requesting secure access…";
      try {
        const result = await staffCall("POST", { action: "cv", id });
        const opened = window.open(result.url, "_blank", "noopener,noreferrer");
        feedback.textContent = opened ? "Secure link expires in 60 seconds." : "Your browser blocked the document tab. Allow pop-ups and try again.";
      } catch (error) {
        feedback.textContent = error instanceof Error ? error.message : "Could not open this document.";
      } finally {
        button.disabled = false;
      }
    });
  }
}

async function loadDocuments() {
  const generation = ++requestGeneration;
  list.innerHTML = '<p class="vacancy-empty">Loading private document register…</p>';
  refresh.disabled = true;
  try {
    const data = await staffCall();
    if (generation !== requestGeneration || !session) return;
    applications = (data.applications || []).filter(app => app.cv_storage_path);
    loginPanel.hidden = true;
    workspace.hidden = false;
    render();
  } catch (error) {
    if (generation !== requestGeneration) return;
    list.innerHTML = '<p class="vacancy-empty">' + esc(error instanceof Error ? error.message : "Could not load documents.") + '</p>';
    summary.textContent = "Document register unavailable.";
  } finally {
    refresh.disabled = false;
  }
}

async function activateSession(nextSession) {
  session = nextSession;
  if (!session?.access_token) { showSignedOut(); return; }
  try {
    await staffCall();
    loginPanel.hidden = true;
    workspace.hidden = false;
    loginStatus.textContent = "";
    await loadDocuments();
  } catch (error) {
    showSignedOut(error instanceof Error ? error.message : "Staff access could not be verified.");
  }
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  loginStatus.textContent = "Signing in…";
  const button = loginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: document.querySelector("#documents-email").value.trim().toLowerCase(),
      password: document.querySelector("#documents-password").value,
    });
    if (error || !data.session) throw new Error("Sign-in failed. Check your staff credentials.");
    await activateSession(data.session);
  } catch (error) {
    showSignedOut(error instanceof Error ? error.message : "Sign-in failed. Check your staff credentials.");
  } finally { button.disabled = false; }
});

refresh.addEventListener("click", loadDocuments);
search.addEventListener("input", render);
statusFilter.addEventListener("change", render);
signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    requestGeneration++;
    showSignedOut("Signed out securely.");
    loginForm.reset();
  } catch {
    loginStatus.textContent = "Sign-out could not be confirmed. Check your connection and try again.";
  } finally { signOut.disabled = false; }
});
supabase.auth.onAuthStateChange((_event, nextSession) => {
  session = nextSession;
  if (!nextSession) { requestGeneration++; showSignedOut(); }
});
const { data: sessionData } = await supabase.auth.getSession();
if (sessionData.session) await activateSession(sessionData.session);
