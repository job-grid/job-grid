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
const jobFields = "id,title,slug,employer_name,description,requirements,category_slug,skill_level,employment_type,workplace_type,country_code,region,city,salary_min,salary_max,salary_currency,salary_period,sponsorship_status,application_url,application_instructions,is_featured,status,published_at,expires_at,created_at";

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
    let sourceUrl: URL | null = null;
    try { sourceUrl = new URL(source); } catch { /* validated below */ }
    const slug = text(body.slug, 220) || title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (title.length < 3 || !employer || !description || !category || !country || !sourceUrl || sourceUrl.protocol !== "https:" || !sourceUrl.hostname || sourceUrl.username !== "" || sourceUrl.password !== "" ||
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
    };
    if (payload.application_url && !payload.application_url.startsWith("https://")) return json(422, { error: "Application URL must use HTTPS." });
    const { data: saved, error: saveError } = await admin.rpc("staff_vacancy_save_draft", {
      p_actor_id: userId,
      p_job_id: id && /^[0-9a-f-]{36}$/i.test(id) ? id : null,
      p_payload: payload,
      p_source_reference: source,
    });
    if (saveError) {
      const status = saveError.code === "23514" ? 409 : saveError.code === "22023" ? 422 : 503;
      return json(status, { error: saveError.message || "Draft, source evidence and audit record could not be saved atomically." });
    }
    return json(200, { job: saved, message: "Draft and private source evidence saved atomically; vacancy remains unpublished." });
  }

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json(422, { error: "Choose a valid vacancy first." });
  if (action === "verify_source") {
    const source = text(body.source_reference, 2000);
    let sourceUrl: URL | null = null;
    try { sourceUrl = new URL(source); } catch { /* validated below */ }
    if (!sourceUrl || sourceUrl.protocol !== "https:" || !sourceUrl.hostname || sourceUrl.username !== "" || sourceUrl.password !== "") return json(422, { error: "Record the official HTTPS source you checked." });
    const { data: job, error } = await admin.rpc("staff_vacancy_transition", { p_action: "verify_source", p_actor_id: userId, p_job_id: id, p_source_reference: source, p_expires_at: null });
    if (error) return json(error.code === "23514" ? 409 : 503, { error: error.message || "Could not atomically record source verification and its audit entry." });
    return json(200, { job, message: "Source review and audit entry recorded atomically. A different publisher must still publish the vacancy." });
  }

  if (action === "publish") {
    if (!roles.some((role) => publishRoles.includes(role))) return json(403, { error: "Only an authorized publisher or system administrator can publish vacancies." });
    const expiresAt = text(body.expires_at, 40);
    const parsedExpiry = Date.parse(expiresAt);
    if (!Number.isFinite(parsedExpiry) || parsedExpiry <= Date.now()) return json(422, { error: "Choose a future expiry date." });
    const { data: published, error } = await admin.rpc("staff_vacancy_transition", { p_action: "publish", p_actor_id: userId, p_job_id: id, p_source_reference: null, p_expires_at: new Date(parsedExpiry).toISOString() });
    if (error) return json(error.code === "23514" ? 409 : error.code === "22023" ? 422 : 503, { error: error.message || "Publication and audit transaction failed." });
    return json(200, { job: published, message: "Vacancy published and audit entry committed atomically." });
  }

  if (action === "close") {
    if (!roles.some((role) => publishRoles.includes(role))) return json(403, { error: "Only an authorized publisher or system administrator can close vacancies." });
    const { data: closed, error } = await admin.rpc("staff_vacancy_transition", { p_action: "close", p_actor_id: userId, p_job_id: id, p_source_reference: null, p_expires_at: null });
    if (error) return json(error.code === "23514" ? 409 : 503, { error: error.message || "Closure and audit transaction failed." });
    return json(200, { job: closed, message: "Vacancy closed and audit entry committed atomically." });
  }
  return json(422, { error: "Unsupported action." });
});