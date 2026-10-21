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
 if(!["reject","accept_as_draft"].includes(action)) return json(422,{error:"Unsupported review action."});
 const {data:result,error:reviewError}=await db.rpc("staff_job_submission_review",{
  p_actor_id:auth.user.id,p_submission_id:id,p_action:action,p_review_note:note
 });
 if(reviewError){
  if(reviewError.code==="42501") return json(403,{error:reviewError.message});
  if(reviewError.code==="23514") return json(409,{error:reviewError.message});
  if(reviewError.code==="22023") return json(422,{error:reviewError.message});
  return json(503,{error:reviewError.message||"Review transaction failed. Refresh before retrying."});
 }
 if(action==="reject") return json(200,{ok:true,message:"Rejected. No public vacancy was created."});
 return json(200,{ok:true,message:"Accepted as an unpublished draft. Verify the official source in Vacancy Management; a publisher must then publish it.",job_id:result?.job_id??null});
});