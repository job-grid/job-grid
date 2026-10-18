import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const allowedOrigin = Deno.env.get("SITE_ORIGIN") ?? "https://jobs-grid.co.ke";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const allowedRoles = ["reviewer", "publisher", "system_admin"];
const publishRoles = ["publisher", "system_admin"];
const jobFields = "id,title,slug,employer_name,description,requirements,category_slug,skill_level,employment_type,workplace_type,country_code,region,city,salary_min,salary_max,salary_currency,salary_period,sponsorship_status,application_url,application_instructions,is_featured,status,published_at,expires_at,source_reference,source_verification_status,source_checked_at,source_checked_by,created_at";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["GET", "POST"].includes(req.method)) return json(405, { error: "Method not allowed." });
  const origin = req.headers.get("origin");
  if (origin && origin !== allowedOrigin) return json(403, { error: "Origin not allowed." });
  const token = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401, { error: "Sign in with an authorized Job Grid staff account." });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(503, { error: "Staff vacancy service is not configured." });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json(401, { error: "Your session is invalid. Please sign in again." });
  const userId = authData.user.id;
  const { data: roleRows, error: roleError } = await admin.from("staff_roles").select("role").eq("user_id", userId);
  if (roleError) return json(503, { error: "Could not verify staff permissions." });
  const roles = (roleRows ?? []).map((row) => row.role);
  if (!roles.some((role) => allowedRoles.includes(role))) return json(403, { error: "This account does not have vacancy-review permission." });

  if (req.method === "GET") {
    const [{ data: jobs, error: jobsError }, { data: categories, error: categoriesError }, { data: countries, error: countriesError }] = await Promise.all([
      admin.from("jobs").select(jobFields).order("created_at", { ascending: false }).limit(100),
      admin.from("job_categories").select("slug,name").eq("is_active", true).order("sort_order", { ascending: true }),
      admin.from("country_options").select("code,name").order("name", { ascending: true }),
    ]);
    if (jobsError || categoriesError || countriesError) return json(503, { error: "Could not load vacancy workspace data." });
    return json(200, { jobs: jobs ?? [], categories: categories ?? [], countries: countries ?? [], roles });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request body." }); }
  const action = text(body.action, 30);
  const id = text(body.id, 36);
  if (action === "save_draft") {
    const title = text(body.title, 180);
    const employer = text(body.employer_name, 200);
    const description = text(body.description, 20000);
    const category = text(body.category_slug, 120);
    const country = text(body.country_code, 2).toUpperCase();
    const skill = text(body.skill_level, 30);
    const employment = text(body.employment_type, 30);
    const workplace = text(body.workplace_type, 30) || "on_site";
    const source = text(body.source_reference, 2000);
    const slug = text(body.slug, 220) || title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (title.length < 3 || !employer || !description || !category || !country || !source.startsWith("https://") ||
        !["skilled", "semi_skilled", "unskilled"].includes(skill) ||
        !["full_time", "part_time", "contract", "temporary", "casual", "seasonal", "internship", "apprenticeship"].includes(employment) ||
        !["on_site", "hybrid", "remote"].includes(workplace) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      return json(422, { error: "Complete the required fields, use an HTTPS source, and choose valid category, country, skill and employment options." });
    }
    const salaryMin = body.salary_min === "" || body.salary_min == null ? null : Number(body.salary_min);
    const salaryMax = body.salary_max === "" || body.salary_max == null ? null : Number(body.salary_max);
    const salaryCurrency = text(body.salary_currency, 3).toUpperCase() || null;
    const salaryPeriod = text(body.salary_period, 20) || null;
    if ((salaryMin != null && (!Number.isFinite(salaryMin) || salaryMin < 0)) ||
        (salaryMax != null && (!Number.isFinite(salaryMax) || salaryMax < 0)) ||
        (salaryMin != null && salaryMax != null && salaryMax < salaryMin) ||
        ((salaryMin != null || salaryMax != null) && (!/^[A-Z]{3}$/.test(salaryCurrency ?? "") || !["hour", "day", "week", "month", "year"].includes(salaryPeriod ?? ""))) ||
        ((salaryMin == null && salaryMax == null) && (salaryCurrency || salaryPeriod))) {
      return json(422, { error: "Check salary values, currency and pay period, or leave all salary fields blank." });
    }
    const payload = {
      title, slug, employer_name: employer, description, requirements: text(body.requirements, 12000) || null,
      category_slug: category, skill_level: skill, employment_type: employment, workplace_type: workplace,
      country_code: country, region: text(body.region, 120) || null, city: text(body.city, 120) || null,
      salary_min: salaryMin, salary_max: salaryMax, salary_currency: salaryCurrency, salary_period: salaryPeriod,
      sponsorship_status: ["available", "not_available", "not_stated", "requires_verification"].includes(text(body.sponsorship_status, 30)) ? text(body.sponsorship_status, 30) : "not_stated",
      application_url: text(body.application_url, 2000) || null, application_instructions: text(body.application_instructions, 4000) || null,
      is_featured: body.is_featured === true, status: "draft", published_at: null, expires_at: null,
      source_reference: source, source_verification_status: "unverified", source_checked_at: null, source_checked_by: null,
    };
    if (payload.application_url && !payload.application_url.startsWith("https://")) return json(422, { error: "Application URL must use HTTPS." });
    let saved;
    if (id && /^[0-9a-f-]{36}$/i.test(id)) {
      const { data, error } = await admin.from("jobs").update(payload).eq("id", id).eq("status", "draft").select("id,slug,status").maybeSingle();
      if (error) return json(422, { error: "Could not save draft. Check the slug is unique and the selected category and country are valid." });
      if (!data) return json(404, { error: "Draft not found. Only drafts can be edited." });
      saved = data;
    } else {
      const { data, error } = await admin.from("jobs").insert(payload).select("id,slug,status").single();
      if (error || !data) return json(422, { error: "Could not create draft. Check the slug is unique and the selected category and country are valid." });
      saved = data;
    }
    await admin.from("audit_logs").insert({ actor_id: userId, action: "vacancy_draft_saved", entity_type: "job", entity_id: saved.id, details: { slug: saved.slug } });
    return json(200, { job: saved, message: "Draft saved. It is not visible to candidates." });
  }

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json(422, { error: "Choose a valid vacancy first." });
  if (action === "verify_source") {
    const source = text(body.source_reference, 2000);
    if (!source.startsWith("https://")) return json(422, { error: "Record the official HTTPS source you checked." });
    const { data: job, error } = await admin.from("jobs").update({ source_reference: source, source_verification_status: "verified", source_checked_at: new Date().toISOString(), source_checked_by: userId }).eq("id", id).eq("status", "draft").select("id,slug,status").maybeSingle();
    if (error) return json(422, { error: "Could not record source verification." });
    if (!job) return json(409, { error: "Only draft vacancies can be verified. Save the draft first." });
    await admin.from("audit_logs").insert({ actor_id: userId, action: "vacancy_source_verified", entity_type: "job", entity_id: id, details: { source_reference: source } });
    return json(200, { job, message: "Source review recorded. A publisher must still publish the vacancy." });
  }

  if (action === "publish") {
    if (!roles.some((role) => publishRoles.includes(role))) return json(403, { error: "Only an authorized publisher or system administrator can publish vacancies." });
    const { data: job, error: readError } = await admin.from("jobs").select(jobFields).eq("id", id).maybeSingle();
    if (readError || !job) return json(404, { error: "Vacancy not found." });
    if (job.status !== "draft" || job.source_verification_status !== "verified" || !job.source_reference?.startsWith("https://") || !job.source_checked_at || !job.source_checked_by) {
      return json(409, { error: "Only a draft with recorded official-source verification can be published." });
    }
    if (job.source_checked_by === userId) return json(409, { error: "A different authorized staff member must publish after the source review." });
    const expiresAt = text(body.expires_at, 40);
    const parsedExpiry = Date.parse(expiresAt);
    if (!Number.isFinite(parsedExpiry) || parsedExpiry <= Date.now()) return json(422, { error: "Choose a future expiry date." });
    const publishedAt = new Date().toISOString();
    const { data: published, error } = await admin.from("jobs").update({ status: "published", published_at: publishedAt, expires_at: new Date(parsedExpiry).toISOString() }).eq("id", id).eq("status", "draft").select("id,slug,status,published_at,expires_at").maybeSingle();
    if (error) return json(422, { error: "Publication failed. Confirm the source verification and all required vacancy details." });
    if (!published) return json(409, { error: "This vacancy is no longer a draft. Reload the workspace." });
    await admin.from("audit_logs").insert({ actor_id: userId, action: "vacancy_published", entity_type: "job", entity_id: id, details: { expires_at: published.expires_at } });
    return json(200, { job: published, message: "Vacancy published after recorded source review." });
  }

  if (action === "close") {
    if (!roles.some((role) => publishRoles.includes(role))) return json(403, { error: "Only an authorized publisher or system administrator can close vacancies." });
    const { data: closed, error } = await admin.from("jobs").update({ status: "closed" }).eq("id", id).eq("status", "published").select("id,slug,status").maybeSingle();
    if (error) return json(422, { error: "Could not close this vacancy." });
    if (!closed) return json(409, { error: "Only currently published vacancies can be closed." });
    await admin.from("audit_logs").insert({ actor_id: userId, action: "vacancy_closed", entity_type: "job", entity_id: id, details: {} });
    return json(200, { job: closed, message: "Vacancy closed and removed from public search." });
  }
  return json(422, { error: "Unsupported action." });
});