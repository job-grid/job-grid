import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } });
const $ = (selector) => document.querySelector(selector);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let session = null; let roles = []; let jobs = [];
const endpoint = SUPABASE_URL + "/functions/v1/staff-jobs";
async function call(method = "GET", body = null) {
  if (!session?.access_token) throw new Error("Your session expired. Please sign in again.");
  const response = await fetch(endpoint, { method, headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + session.access_token, ...(body ? {"Content-Type":"application/json"} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) });
  const data = await response.json().catch(()=>({}));
  if (response.status === 401) { await supabase.auth.signOut(); throw new Error("Your session expired. Please sign in again."); }
  if (!response.ok) throw new Error(data.error || "Staff vacancy request failed.");
  return data;
}
function signedOut(message="") { session=null; $("#jobs-workspace").hidden=true; $("#jobs-login-panel").hidden=false; $("#jobs-login-status").textContent=message; $("#jobs-list").replaceChildren(); }
function slugify(s) { return s.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""); }
function formPayload() {
  return { id:$("#job-id").value || undefined, title:$("#job-title").value.trim(), slug:$("#job-slug").value.trim(), employer_name:$("#job-employer").value.trim(), country_code:$("#job-country").value, city:$("#job-city").value.trim(), region:$("#job-region").value.trim(), category_slug:$("#job-category").value, skill_level:$("#job-skill").value, employment_type:$("#job-employment").value, workplace_type:$("#job-workplace").value, source_reference:$("#job-source").value.trim(), application_url:$("#job-application-url").value.trim(), description:$("#job-description").value.trim(), requirements:$("#job-requirements").value.trim(), application_instructions:$("#job-application-instructions").value.trim(), sponsorship_status:$("#job-sponsorship").value, salary_min:$("#job-salary-min").value, salary_max:$("#job-salary-max").value, salary_currency:$("#job-salary-currency").value.trim().toUpperCase(), salary_period:$("#job-salary-period").value, is_featured:$("#job-featured").checked };
}
function clearForm() { $("#job-form").reset(); $("#job-id").value=""; $("#job-form-heading").textContent="Create vacancy draft"; $("#job-form-status").textContent=""; $("#job-slug").readOnly=false; }
function fillForm(job) {
  $("#job-id").value=job.id; $("#job-title").value=job.title; $("#job-slug").value=job.slug; $("#job-employer").value=job.employer_name; $("#job-country").value=job.country_code; $("#job-city").value=job.city||""; $("#job-region").value=job.region||""; $("#job-category").value=job.category_slug; $("#job-skill").value=job.skill_level; $("#job-employment").value=job.employment_type; $("#job-workplace").value=job.workplace_type; $("#job-source").value=job.source_reference||""; $("#job-application-url").value=job.application_url||""; $("#job-description").value=job.description; $("#job-requirements").value=job.requirements||""; $("#job-application-instructions").value=job.application_instructions||""; $("#job-sponsorship").value=job.sponsorship_status||"not_stated"; $("#job-salary-min").value=job.salary_min??""; $("#job-salary-max").value=job.salary_max??""; $("#job-salary-currency").value=job.salary_currency||""; $("#job-salary-period").value=job.salary_period||""; $("#job-featured").checked=job.is_featured===true; $("#job-form-heading").textContent="Edit draft: "+job.title; $("#job-slug").readOnly=true; $("#job-form-status").textContent="Editing draft. Saving resets its source review, so verify it again before publishing."; window.scrollTo({top:0,behavior:"smooth"});
}
function renderJobs() {
  const list=$("#jobs-list");
  $("#jobs-summary").textContent=jobs.length+" recent vacancies loaded. Drafts are private; only publisher/system administrator roles can publish.";
  if (!jobs.length) { list.innerHTML='<p class="vacancy-empty">No vacancies yet. Create the first genuine vacancy draft above.</p>'; return; }
  list.innerHTML=jobs.map(job => '<article class="vacancy-card" data-job="'+esc(job.id)+'"><div class="vacancy-meta"><span class="vacancy-tag">'+esc(job.status)+'</span><span class="vacancy-tag">'+esc(job.source_verification_status||"unverified")+'</span></div><h3>'+esc(job.title)+'</h3><p class="vacancy-employer">'+esc(job.employer_name)+' · '+esc(job.country_code)+'</p><p class="vacancy-description">'+esc(job.source_reference||"No source recorded")+'</p><p class="vacancy-description">Expiry: '+esc(job.expires_at||"Not published")+'</p><div class="filter-actions">'+(job.status==="draft"?'<button class="button button-secondary edit-job" type="button">Edit draft</button><button class="button button-secondary verify-job" type="button">I checked this official source</button>':"")+(job.status==="draft"&&roles.some(r=>["publisher","system_admin"].includes(r))?'<button class="button button-primary publish-job" type="button">Publish</button>':"")+(job.status==="published"&&roles.some(r=>["publisher","system_admin"].includes(r))?'<button class="button button-secondary close-job" type="button">Close vacancy</button>':"")+'</div><p class="job-feedback" role="status" aria-live="polite"></p></article>').join("");
  for(const card of list.querySelectorAll("[data-job]")) {
    const id=card.dataset.job, job=jobs.find(j=>j.id===id), feedback=card.querySelector(".job-feedback");
    card.querySelector(".edit-job")?.addEventListener("click",()=>fillForm(job));
    card.querySelector(".verify-job")?.addEventListener("click",async()=>{
      if(!job.source_reference?.startsWith("https://")) { feedback.textContent="Save an official HTTPS source URL first."; return; }
      if(!confirm("Confirm you personally checked this official source and the vacancy details match it? This records your staff account and the time of review.")) return;
      try { const result=await call("POST",{action:"verify_source",id,source_reference:job.source_reference}); feedback.textContent=result.message; await loadJobs(); }
      catch(e){feedback.textContent=e.message;}
    });
    card.querySelector(".publish-job")?.addEventListener("click",async()=>{
      if(job.source_verification_status!=="verified") { feedback.textContent="Verify the source first."; return; }
      const suggested=new Date(Date.now()+30*86400000); suggested.setMinutes(suggested.getMinutes()-suggested.getTimezoneOffset());
      const entered=prompt("Enter vacancy expiry date and time in your local time (YYYY-MM-DDTHH:MM). Check the employer deadline. Suggested: "+suggested.toISOString().slice(0,16),suggested.toISOString().slice(0,16));
      if(!entered) return;
      const expiry=new Date(entered);
      if(!Number.isFinite(expiry.getTime())) { feedback.textContent="Enter a valid expiry date and time."; return; }
      try { const result=await call("POST",{action:"publish",id,expires_at:expiry.toISOString()}); feedback.textContent=result.message; await loadJobs(); }
      catch(e){feedback.textContent=e.message;}
    });
    card.querySelector(".close-job")?.addEventListener("click",async()=>{
      if(!confirm("Close this vacancy and remove it from public search?")) return;
      try {const result=await call("POST",{action:"close",id});feedback.textContent=result.message;await loadJobs();}
      catch(e){feedback.textContent=e.message;}
    });
  }
}
async function loadJobs() {
  $("#jobs-list").innerHTML='<p class="vacancy-empty">Loading vacancy records…</p>';
  try {
    const data=await call(); jobs=data.jobs||[]; roles=data.roles||[];
    const cat=$("#job-category"), country=$("#job-country"); const selectedCat=cat.value, selectedCountry=country.value;
    cat.innerHTML='<option value="">Choose category</option>'+(data.categories||[]).map(c=>'<option value="'+esc(c.slug)+'">'+esc(c.name)+'</option>').join("");
    country.innerHTML='<option value="">Choose country</option>'+(data.countries||[]).map(c=>'<option value="'+esc(c.code)+'">'+esc(c.name)+'</option>').join("");
    cat.value=selectedCat; country.value=selectedCountry; renderJobs();
  } catch(e){$("#jobs-list").innerHTML='<p class="vacancy-empty">'+esc(e.message)+'</p>';}
}
$("#job-title").addEventListener("input",()=>{if(!$("#job-id").value) $("#job-slug").value=slugify($("#job-title").value);});
$("#job-form").addEventListener("submit",async event=>{
  event.preventDefault(); const button=$("#job-save");button.disabled=true;$("#job-form-status").textContent="Saving private draft…";
  try {const result=await call("POST",{action:"save_draft",...formPayload()});$("#job-id").value=result.job.id;$("#job-slug").value=result.job.slug;$("#job-slug").readOnly=true;$("#job-form-status").textContent=result.message;await loadJobs();}
  catch(e){$("#job-form-status").textContent=e.message;}
  finally{button.disabled=false;}
});
$("#job-reset").addEventListener("click",clearForm);
$("#jobs-login-form").addEventListener("submit",async event=>{
  event.preventDefault();const button=$("#jobs-login-form button[type=submit]");button.disabled=true;$("#jobs-login-status").textContent="Signing in…";
  try{const {data,error}=await supabase.auth.signInWithPassword({email:$("#jobs-staff-email").value.trim().toLowerCase(),password:$("#jobs-staff-password").value});if(error||!data.session)throw new Error("Sign-in failed. Check your staff credentials.");session=data.session;await call();$("#jobs-login-panel").hidden=true;$("#jobs-workspace").hidden=false;$("#jobs-login-status").textContent="";await loadJobs();}
  catch(e){signedOut(e.message);}
  finally{button.disabled=false;}
});
$("#jobs-sign-out").addEventListener("click",async()=>{await supabase.auth.signOut();signedOut("Signed out securely.");$("#jobs-login-form").reset();});
supabase.auth.onAuthStateChange((_event,nextSession)=>{if(!nextSession){session=null;$("#jobs-workspace").hidden=true;$("#jobs-login-panel").hidden=false;}else{session=nextSession;}});
const {data:sessionData}=await supabase.auth.getSession();
if(sessionData.session){session=sessionData.session;try{await call();$("#jobs-login-panel").hidden=true;$("#jobs-workspace").hidden=false;await loadJobs();}catch(e){signedOut(e.message);}}
