import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
const siteOrigin = Deno.env.get("SITE_ORIGIN") ?? "https://jobs-grid.co.ke";
const cors = { "Access-Control-Allow-Origin": siteOrigin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" };
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const text = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
const validHttps = (value: string) => { try { const u = new URL(value); return u.protocol === "https:" && !!u.hostname && !u.username && !u.password; } catch { return false; } };
const adminClient = () => {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Job submission service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST" && req.method !== "GET") return json(405, { error: "Method not allowed." });
  const origin = req.headers.get("origin");
  if (origin && origin !== siteOrigin) return json(403, { error: "Origin not allowed." });
  let admin;
  try { admin = adminClient(); } catch { return json(503, { error: "Job submission service is not configured." }); }

  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json(400, { error: "Please complete the form and submit again." }); }
    // Honeypot field quietly rejects automated spam.
    if (text(body.website, 200)) return json(200, { ok: true, message: "Thank you. Your submission has been received for review." });
    const contactName = text(body.contact_name,160), email = text(body.contact_email,254).toLowerCase(), phone = text(body.contact_phone,40);
    const employer = text(body.employer_name,200), website = text(body.employer_website,500), title = text(body.title,180);
    const description = text(body.description,20000), requirements = text(body.requirements,12000), category = text(body.category_slug,120);
    const country = text(body.country_code,2).toUpperCase(), city = text(body.city,120), region = text(body.region,120);
    const employment = text(body.employment_type,30), workplace = text(body.workplace_type,30) || "on_site", skill = text(body.skill_level,30);
    const source = text(body.source_reference,2000), applicationUrl = text(body.application_url,2000), instructions = text(body.application_instructions,4000);
    const salaryMin = body.salary_min === "" || body.salary_min == null ? null : Number(body.salary_min);
    const salaryMax = body.salary_max === "" || body.salary_max == null ? null : Number(body.salary_max);
    const currency = text(body.salary_currency,3).toUpperCase() || null, period = text(body.salary_period,20) || null;
    if (contactName.length<2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length<7 ||
        employer.length<2 || title.length<3 || description.length<30 || !/^[A-Z]{2}$/.test(country) ||
        !["full_time","part_time","contract","temporary","casual","seasonal","internship","apprenticeship"].includes(employment) ||
        !["on_site","hybrid","remote"].includes(workplace) || !["skilled","semi_skilled","unskilled"].includes(skill) ||
        !validHttps(source) || (website && !validHttps(website)) || (applicationUrl && !validHttps(applicationUrl)) ||
        (salaryMin!==null && (!Number.isFinite(salaryMin)||salaryMin<0)) || (salaryMax!==null && (!Number.isFinite(salaryMax)||salaryMax<0)) ||
        (salaryMin!==null && salaryMax!==null && salaryMax<salaryMin) ||
        ((salaryMin!==null || salaryMax!==null) && (!/^[A-Z]{3}$/.test(currency??"") || !["hour","day","week","month","year"].includes(period??""))) ||
        ((salaryMin===null && salaryMax===null) && (currency || period))) {
      return json(422, { error: "Check the required fields, HTTPS source links, job details and optional salary range." });
    }
    const { data: cat, error: catError } = await admin.from("job_categories").select("slug").eq("slug",category).eq("is_active",true).maybeSingle();
    const { data: ctry, error: countryError } = await admin.from("country_options").select("code").eq("code",country).maybeSingle();
    if (catError || countryError) return json(503,{error:"Could not validate category and country. Please try again."});
    if (!cat || !ctry) return json(422,{error:"Choose an available Job Grid category and country."});
    const { count, error: rateError } = await admin.from("job_submissions").select("id",{count:"exact",head:true}).eq("contact_email",email).gte("created_at",new Date(Date.now()-60*60*1000).toISOString());
    if (rateError) return json(503,{error:"Submission service is temporarily unavailable."});
    if ((count??0)>=3) return json(429,{error:"We have received several submissions from this email recently. Please wait before trying again."});
    const { error } = await admin.from("job_submissions").insert({
      contact_name:contactName,contact_email:email,contact_phone:phone,employer_name:employer,employer_website:website||null,
      title,description,requirements:requirements||null,category_slug:category,country_code:country,city:city||null,region:region||null,
      employment_type:employment,workplace_type:workplace,skill_level:skill,salary_min:salaryMin,salary_max:salaryMax,
      salary_currency:currency,salary_period:period,source_reference:source,application_url:applicationUrl||null,application_instructions:instructions||null
    });
    if (error) return json(503,{error:"Could not save the submission. Please try again later."});
    return json(201,{ok:true,message:"Thank you. Your job submission is pending staff review and is not yet public."});
  }

  const token = (req.headers.get("authorization")??"").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401,{error:"Sign in with an authorized Job Grid staff account."});
  const {data:auth,error:authError}=await admin.auth.getUser(token);
  if(authError||!auth.user) return json(401,{error:"Your session is invalid. Please sign in again."});
  const {data:roleRows,error:roleError}=await admin.from("staff_roles").select("role").eq("user_id",auth.user.id);
  if(roleError) return json(503,{error:"Could not verify staff permissions."});
  const roles=(roleRows??[]).map(r=>r.role);
  if(!roles.some(r=>["reviewer","publisher","system_admin"].includes(r))) return json(403,{error:"This account cannot review job submissions."});
  const {data:submissions,error}=await admin.from("job_submissions").select("*").order("created_at",{ascending:false}).limit(100);
  if(error) return json(503,{error:"Could not load job submissions."});
  return json(200,{submissions:submissions??[],roles});
});
