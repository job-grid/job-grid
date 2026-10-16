import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_ORIGIN") ?? "https://jobs-grid.co.ke",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const clean = (value: FormDataEntryValue | null, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });
  const origin = req.headers.get("origin");
  const allowedOrigin = Deno.env.get("SITE_ORIGIN") ?? "https://jobs-grid.co.ke";
  if (origin && origin !== allowedOrigin) return json(403, { error: "Origin not allowed." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(503, { error: "Application service is not configured yet." });

  let form: FormData;
  try { form = await req.formData(); } catch { return json(400, { error: "Please submit the application form again." }); }
  // Honeypot field for basic bot filtering.
  if (clean(form.get("website"), 200)) return json(200, { ok: true, message: "Application received." });

  const fullName = clean(form.get("full_name"), 160);
  const email = clean(form.get("email"), 254).toLowerCase();
  const phone = clean(form.get("phone"), 40);
  const countryCode = clean(form.get("country_code"), 2).toUpperCase();
  const city = clean(form.get("city"), 120);
  const experience = clean(form.get("experience_summary"), 6000);
  const skills = clean(form.get("skills"), 3000);
  const jobId = clean(form.get("job_id"), 80);
  const consent = form.get("consent") === "on";
  const cv = form.get("cv");

  if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      phone.length < 7 || !/^[A-Z]{2}$/.test(countryCode) ||
      experience.length < 20 || skills.length < 2 || !consent) {
    return json(422, { error: "Complete all required fields and consent before submitting." });
  }
  if (!(cv instanceof File) || cv.size < 1 || cv.size > 5 * 1024 * 1024) {
    return json(422, { error: "Upload a PDF, DOC, or DOCX CV up to 5 MB." });
  }
  const allowed = new Map([
    ["application/pdf", "pdf"],
    ["application/msword", "doc"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ]);
  const extension = allowed.get(cv.type);
  if (!extension || !cv.name.toLowerCase().endsWith("." + extension)) {
    return json(422, { error: "CV must be a PDF, DOC, or DOCX file." });
  }
  if (jobId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    return json(422, { error: "The selected job is invalid. Please choose a job again." });
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: country, error: countryError } = await db.from("country_options").select("code").eq("code", countryCode).maybeSingle();
  if (countryError || !country) return json(422, { error: "Select a valid country." });

  if (jobId) {
    const { data: job, error: jobError } = await db.from("jobs").select("id").eq("id", jobId).eq("status", "published").not("published_at", "is", null).lte("published_at", new Date().toISOString()).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (jobError || !job) return json(422, { error: "This vacancy is no longer accepting applications. You can submit a general candidate profile instead." });
  }

  const safeName = crypto.randomUUID() + "." + extension;
  const path = new Date().toISOString().slice(0, 10) + "/" + safeName;
  const { error: uploadError } = await db.storage.from("candidate-cvs").upload(path, cv, {
    contentType: cv.type,
    upsert: false,
  });
  if (uploadError) return json(503, { error: "We could not securely store your CV. Please try again later." });

  const { error: insertError } = await db.from("candidate_applications").insert({
    job_id: jobId || null,
    full_name: fullName,
    email,
    phone,
    country_code: countryCode,
    city: city || null,
    experience_summary: experience,
    skills,
    cv_storage_path: path,
    consent_at: new Date().toISOString(),
  });
  if (insertError) {
    await db.storage.from("candidate-cvs").remove([path]);
    return json(503, { error: "We could not save your application. Please try again later." });
  }
  return json(201, { ok: true, message: "Your application has been received by Job Grid. Our recruitment team will review your profile." });
});