import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
const origin = Deno.env.get("SITE_ORIGIN") ?? "https://jobs-grid.co.ke";
const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" };
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const text = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
Deno.serve(async req => {
 if (req.method === "OPTIONS") return new Response("ok", { headers });
 if (!["GET","POST"].includes(req.method)) return json(405,{error:"Method not allowed."});
 if (req.headers.get("origin") && req.headers.get("origin") !== origin) return json(403,{error:"Origin not allowed."});
 const token=(req.headers.get("authorization")??"").match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token) return json(401,{error:"Staff sign-in required."});
 const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key) return json(503,{error:"Staff review service is not configured."});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await db.auth.getUser(token);
 if(authError||!auth.user) return json(401,{error:"Session invalid. Sign in again."});
 const {data:roleRows,error:roleError}=await db.from("staff_roles").select("role").eq("user_id",auth.user.id);
 if(roleError) return json(503,{error:"Could not verify staff permissions."});
 const roles=(roleRows??[]).map(r=>r.role);
 if(!roles.some(r=>["reviewer","publisher","system_admin"].includes(r))) return json(403,{error:"This account cannot review job submissions."});
 if(req.method==="GET"){
  const {data,error}=await db.from("job_submissions").select("*").order("created_at",{ascending:false}).limit(100);
  if(error) return json(503,{error:"Could not load submissions."});
  return json(200,{submissions:data??[],roles});
 }
 let body:Record<string,unknown>;
 try{body=await req.json();}catch{return json(400,{error:"Invalid request."});}
 const id=text(body.id,36), action=text(body.action,30), note=text(body.review_note,3000)||null;
 if(!/^[0-9a-f-]{36}$/i.test(id)) return json(422,{error:"Choose a valid submission."});
 const {data:s,error:readError}=await db.from("job_submissions").select("*").eq("id",id).maybeSingle();
 if(readError) return json(503,{error:"Could not load submission."});
 if(!s||s.status!=="pending") return json(409,{error:"Submission has already been reviewed."});
 if(action==="reject"){
  const {data:updated,error}=await db.from("job_submissions").update({status:"rejected",review_note:note,reviewed_by:auth.user.id,reviewed_at:new Date().toISOString()}).eq("id",id).eq("status","pending").select("id").maybeSingle();
  if(error||!updated) return json(409,{error:"Could not reject this submission; refresh and check its status."});
  await db.from("audit_logs").insert({actor_id:auth.user.id,action:"job_submission_rejected",entity_type:"job_submission",entity_id:id,details:{review_note:note}});
  return json(200,{ok:true,message:"Rejected. No public vacancy was created."});
 }
 if(action==="accept_as_draft"){
  const slug=s.title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const payload={title:s.title,slug,employer_name:s.employer_name,description:s.description,requirements:s.requirements,category_slug:s.category_slug,skill_level:s.skill_level,employment_type:s.employment_type,workplace_type:s.workplace_type,country_code:s.country_code,region:s.region,city:s.city,salary_min:s.salary_min,salary_max:s.salary_max,salary_currency:s.salary_currency,salary_period:s.salary_period,sponsorship_status:"not_stated",application_url:s.application_url,application_instructions:s.application_instructions,is_featured:false,status:"draft",published_at:null,expires_at:null};
  const {data:saved,error:saveError}=await db.rpc("staff_vacancy_save_draft",{p_actor_id:auth.user.id,p_job_id:null,p_payload:payload,p_source_reference:s.source_reference});
  if(saveError) return json(saveError.code==="23514"?409:422,{error:saveError.message||"Could not create a private draft."});
  const jobId=typeof saved?.id==="string"?saved.id:null;
  const {data:updated,error:updateError}=await db.from("job_submissions").update({status:"accepted_as_draft",review_note:note,reviewed_by:auth.user.id,reviewed_at:new Date().toISOString(),created_job_id:jobId}).eq("id",id).eq("status","pending").select("id").maybeSingle();
  if(updateError||!updated) return json(503,{error:"Private draft created but queue status did not update. Do not retry; contact an administrator."});
  await db.from("audit_logs").insert({actor_id:auth.user.id,action:"job_submission_accepted_as_draft",entity_type:"job_submission",entity_id:id,details:{job_id:jobId,review_note:note}});
  return json(200,{ok:true,message:"Accepted as an unpublished draft. Verify the official source in Vacancy Management; a publisher must then publish it."});
 }
 return json(422,{error:"Unsupported review action."});
});