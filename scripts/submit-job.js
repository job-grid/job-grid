import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";
const $=s=>document.querySelector(s);
const endpoint=SUPABASE_URL+"/functions/v1/job-submissions";
const escapeHtml=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function loadOptions(){
 const headers={apikey:SUPABASE_PUBLISHABLE_KEY,Accept:"application/json"};
 const [categories,countries]=await Promise.all([
  fetch(SUPABASE_URL+"/rest/v1/job_categories?select=slug,name&is_active=eq.true&order=sort_order.asc",{headers}),
  fetch(SUPABASE_URL+"/rest/v1/country_options?select=code,name&order=name.asc",{headers})
 ]);
 if(!categories.ok||!countries.ok) throw new Error("Could not load job categories and countries. Refresh and try again.");
 const cats=await categories.json(), ctys=await countries.json();
 if(!Array.isArray(cats)||!cats.length||!Array.isArray(ctys)||!ctys.length) throw new Error("Job options are temporarily unavailable.");
 $("#job-category").innerHTML='<option value="">Choose category</option>'+cats.map(x=>'<option value="'+escapeHtml(x.slug)+'">'+escapeHtml(x.name)+'</option>').join("");
 $("#job-country").innerHTML='<option value="">Choose country</option>'+ctys.map(x=>'<option value="'+escapeHtml(x.code)+'">'+escapeHtml(x.name)+'</option>').join("");
}
$("#submit-job-form").addEventListener("submit",async e=>{
 e.preventDefault();const button=$("#submit-job-button"),status=$("#submit-job-status");
 if(!$("#submission-consent").checked){status.textContent="Please confirm the submission details.";return;}
 const f=new FormData(e.currentTarget),body={};
 for(const key of ["contact_name","contact_email","contact_phone","employer_name","employer_website","title","description","requirements","category_slug","country_code","city","region","employment_type","workplace_type","skill_level","salary_min","salary_max","salary_currency","salary_period","source_reference","application_url","application_instructions","website"]) body[key]=String(f.get(key)??"").trim();
 button.disabled=true;status.textContent="Submitting securely for staff review…";
 try{const response=await fetch(endpoint,{method:"POST",headers:{apikey:SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(body)});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Submission failed. Please try again.");e.currentTarget.reset();status.textContent=result.message||"Submitted for review.";}
 catch(err){status.textContent=err.message||"Could not submit. Please try again.";}
 finally{button.disabled=false;}
});
loadOptions().catch(err=>{ $("#submit-job-status").textContent=err.message; $("#submit-job-button").disabled=true; });
