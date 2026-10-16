import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("SITE_ORIGIN") ?? "https://jobs-grid.co.ke";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["GET", "POST"].includes(req.method)) return json(405, { error: "Method not allowed." });
  const origin = req.headers.get("origin");
  if (origin && origin !== allowedOrigin) return json(403, { error: "Origin not allowed." });
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401, { error: "Sign in with an authorized Job Grid staff account." });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(503, { error: "Staff service is not configured." });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: "Your session is invalid. Please sign in again." });
  const userId = userData.user.id;
  const { data: roleRows, error: roleError } = await admin.from("staff_roles").select("role").eq("user_id", userId);
  if (roleError) return json(503, { error: "Could not verify staff permissions." });
  const roles = (roleRows ?? []).map((row) => row.role);
  if (!roles.some((role) => ["reviewer", "publisher", "system_admin", "auditor"].includes(role))) {
    return json(403, { error: "This account does not have recruitment-review permission." });
  }

  if (req.method === "GET") {
    const { data, error } = await admin.from("candidate_applications")
      .select("id,job_id,full_name,email,phone,country_code,city,experience_summary,skills,cv_storage_path,status,submitted_at,updated_at")
      .order("submitted_at", { ascending: false }).limit(100);
    if (error) return json(503, { error: "Could not load applications." });
    return json(200, { applications: data ?? [], roles });
  }

  if (!roles.some((role) => ["reviewer", "publisher", "system_admin"].includes(role))) {
    return json(403, { error: "Your role is read-only." });
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }
  const id = typeof body.id === "string" ? body.id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(422, { error: "Invalid application ID." });

  if (action === "cv") {
    const { data: application, error } = await admin.from("candidate_applications").select("cv_storage_path").eq("id", id).maybeSingle();
    if (error || !application) return json(404, { error: "Application not found." });
    const { data, error: signError } = await admin.storage.from("candidate-cvs").createSignedUrl(application.cv_storage_path, 60);
    if (signError || !data?.signedUrl) return json(503, { error: "Could not create a secure CV link." });
    await admin.from("audit_logs").insert({ actor_id: userId, action: "candidate_cv_accessed", entity_type: "candidate_application", entity_id: id, details: { expires_in_seconds: 60 } });
    return json(200, { url: data.signedUrl });
  }

  const validStatuses = ["submitted", "under_review", "shortlisted", "matched", "referred", "interview", "placed", "rejected", "withdrawn"];
  if (action === "status") {
    const status = typeof body.status === "string" ? body.status : "";
    if (!validStatuses.includes(status)) return json(422, { error: "Invalid application status." });
    const { error } = await admin.from("candidate_applications").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return json(503, { error: "Could not update application status." });
    await admin.from("audit_logs").insert({ actor_id: userId, action: "candidate_application_status_changed", entity_type: "candidate_application", entity_id: id, details: { status } });
    return json(200, { ok: true });
  }
  if (action === "note") {
    if (!roles.includes("reviewer") && !roles.includes("system_admin")) return json(403, { error: "Reviewer permission is required to add internal notes." });
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length < 1 || note.length > 5000) return json(422, { error: "Internal note must be 1–5000 characters." });
    const { error } = await admin.from("candidate_application_notes").insert({ application_id: id, author_id: userId, note });
    if (error) return json(503, { error: "Could not save internal note." });
    await admin.from("audit_logs").insert({ actor_id: userId, action: "candidate_internal_note_added", entity_type: "candidate_application", entity_id: id, details: {} });
    return json(200, { ok: true });
  }
  return json(422, { error: "Unsupported action." });
});