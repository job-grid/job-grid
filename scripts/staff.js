import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const loginPanel = document.querySelector("#staff-login-panel");
const loginForm = document.querySelector("#staff-login-form");
const loginStatus = document.querySelector("#staff-login-status");
const workspace = document.querySelector("#staff-workspace");
const list = document.querySelector("#staff-applications");
const summary = document.querySelector("#staff-summary");
const signOut = document.querySelector("#staff-sign-out");
let session = null;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const statuses = ["submitted","under_review","shortlisted","matched","referred","interview","placed","rejected","withdrawn"];

async function staffCall(method = "GET", body = null) {
  const response = await fetch(SUPABASE_URL + "/functions/v1/staff-applications", {
    method,
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + session.access_token, ...(body ? {"Content-Type":"application/json"} : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Staff request failed.");
  return result;
}

async function loadApplications() {
  list.innerHTML = '<p class="vacancy-empty">Loading private applications…</p>';
  try {
    const data = await staffCall();
    const apps = data.applications || [];
    summary.textContent = apps.length + " recent candidate applications. Access is logged; keep these records confidential.";
    list.innerHTML = apps.length ? apps.map(app => `<article class="vacancy-card" data-application="${esc(app.id)}">
      <div class="vacancy-meta"><span class="vacancy-tag">${esc(app.status.replaceAll("_"," "))}</span><span class="vacancy-tag">Country: ${esc(app.country_code)}</span></div>
      <h2>${esc(app.full_name)}</h2><p class="vacancy-employer">${esc(app.email)} · ${esc(app.phone)}</p>
      <p><strong>Location:</strong> ${esc([app.city,app.country_code].filter(Boolean).join(", "))}</p>
      <p><strong>Experience / preferences</strong></p><p class="vacancy-description">${esc(app.experience_summary)}</p>
      <p><strong>Skills and qualifications</strong></p><p class="vacancy-description">${esc(app.skills)}</p>
      <p class="vacancy-description">Submitted: ${esc(new Date(app.submitted_at).toLocaleString())} · Application ID: ${esc(app.id)}</p>
      <div class="filter-field"><label>Status</label><select class="application-status">${statuses.map(s=>`<option value="${s}" ${s===app.status?"selected":""}>${s.replaceAll("_"," ")}</option>`).join("")}</select></div>
      <div class="filter-actions"><button class="button button-secondary cv-button" type="button">Open CV (secure 60-second link)</button><button class="button button-primary save-status" type="button">Save status</button></div>
      <div class="filter-field"><label>Confidential internal note (reviewers only)</label><textarea class="application-note" rows="3" maxlength="5000" placeholder="Record relevant matching or follow-up notes."></textarea></div><button class="button button-secondary save-note" type="button">Add internal note</button><p class="application-feedback" role="status" aria-live="polite"></p>
    </article>`).join("") : '<p class="vacancy-empty">No candidate applications have been received yet.</p>';
    for (const card of list.querySelectorAll("[data-application]")) {
      const id = card.dataset.application;
      const feedback = card.querySelector(".application-feedback");
      card.querySelector(".cv-button").addEventListener("click", async () => {
        try { const result = await staffCall("POST", {action:"cv",id}); window.open(result.url,"_blank","noopener,noreferrer"); feedback.textContent = "Secure CV link expires in 60 seconds."; }
        catch (e) { feedback.textContent = e.message; }
      });
      card.querySelector(".save-status").addEventListener("click", async () => {
        try { await staffCall("POST", {action:"status",id,status:card.querySelector(".application-status").value}); feedback.textContent="Status updated."; }
        catch (e) { feedback.textContent=e.message; }
      });
      card.querySelector(".save-note").addEventListener("click", async () => {
        const note=card.querySelector(".application-note").value.trim();
        if (!note) { feedback.textContent="Enter a note first."; return; }
        try { await staffCall("POST", {action:"note",id,note}); card.querySelector(".application-note").value=""; feedback.textContent="Confidential note saved."; }
        catch (e) { feedback.textContent=e.message; }
      });
    }
  } catch (e) {
    list.innerHTML = '<p class="vacancy-empty">'+esc(e.message)+'</p>';
    summary.textContent = "Recruitment access is unavailable.";
  }
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault(); loginStatus.textContent="Signing in…";
  const email=document.querySelector("#staff-email").value.trim();
  const password=document.querySelector("#staff-password").value;
  try {
    const response=await fetch(SUPABASE_URL+"/auth/v1/token?grant_type=password",{method:"POST",headers:{apikey:SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({email,password})});
    const result=await response.json();
    if(!response.ok || !result.access_token) throw new Error(result.msg || result.message || "Sign-in failed.");
    session=result;
    await staffCall();
    loginPanel.hidden=true; workspace.hidden=false; await loadApplications();
  } catch(e) { session=null; loginStatus.textContent=e.message; }
});
signOut.addEventListener("click",()=>{session=null;workspace.hidden=true;loginPanel.hidden=false;loginForm.reset();loginStatus.textContent="Signed out.";list.replaceChildren();});
