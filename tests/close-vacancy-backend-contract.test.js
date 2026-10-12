import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20261012214500_vacancy_close_foundation.sql", import.meta.url),
  "utf8",
);
const coreSchema = await readFile(
  new URL("../supabase/tests/phase2a_schema_contract.sql", import.meta.url),
  "utf8",
);
const handler = await readFile(
  new URL("../supabase/functions/close-vacancy/index.ts", import.meta.url),
  "utf8",
);
const config = await readFile(
  new URL("../supabase/config.toml", import.meta.url),
  "utf8",
);
const docs = await readFile(
  new URL("../docs/close-vacancy-supabase-integration.md", import.meta.url),
  "utf8",
);

test("all introduced application tables explicitly enable RLS", () => {
  const tables = [
    "organizations",
    "organization_memberships",
    "platform_roles",
    "vacancy_closure_reason_codes",
    "vacancies",
    "vacancy_audit_events",
    "vacancy_closure_requests",
  ];
  for (const table of tables) {
    assert.ok(
      migration.includes("ALTER TABLE public." + table + " ENABLE ROW LEVEL SECURITY"),
      "RLS must be explicitly enabled for " + table,
    );
  }
});

test("public vacancy visibility requires published status and a valid publication window", () => {
  assert.ok(migration.includes("CREATE POLICY vacancies_public_or_member_read"));
  assert.ok(migration.includes("status = 'published'"));
  assert.ok(migration.includes("published_at <= now()"));
  assert.ok(migration.includes("expires_at > now()"));
  assert.ok(migration.includes("public.is_active_org_member(organization_id)"));
});

test("database close operation checks authorization and expected version before mutation", () => {
  assert.ok(migration.includes("membership.role IN ('owner', 'admin', 'recruiter')"));
  assert.ok(migration.includes("platform_role.role IN ('moderator', 'admin')"));
  assert.ok(migration.includes("FOR UPDATE;"));
  assert.ok(migration.includes("v_vacancy.version <> p_expected_version"));
  assert.ok(migration.includes("SET status = 'closed'"));
  assert.ok(migration.includes("version = version + 1"));
});

test("closure and durable audit/idempotency writes share one transaction", () => {
  assert.ok(migration.includes("BEGIN;"));
  assert.ok(migration.includes("INSERT INTO public.vacancy_audit_events"));
  assert.ok(migration.includes("INSERT INTO public.vacancy_closure_requests"));
  assert.ok(migration.includes("COMMIT;"));
  assert.ok(migration.includes("UNIQUE (vacancy_id, actor_user_id, idempotency_key)"));
  assert.ok(migration.includes("vacancy_audit_events is append-only"));
  assert.equal(/DELETE\s+FROM\s+public\.vacanc(?:y|ies)/i.test(migration), false);
  assert.equal(/DELETE\s+FROM\s+public\.vacancy_applications/i.test(migration), false);
});

test("database function execution is limited to the trusted service role", () => {
  assert.ok(migration.includes("FROM PUBLIC, anon, authenticated"));
  assert.ok(migration.includes("TO service_role;"));
  assert.ok(migration.includes("REVOKE UPDATE, DELETE ON public.vacancy_audit_events FROM service_role"));
});

test("Edge Function derives actor from verified Auth session and rejects client identity fields", () => {
  assert.ok(handler.includes("admin.auth.getUser(bearer[1])"));
  assert.ok(handler.includes("p_actor_user_id: authData.user.id"));
  assert.ok(handler.includes('new Set(["vacancy_id", "reason_code", "expected_version"])'));
  assert.equal(handler.includes("payload.actor_user_id"), false);
  assert.equal(handler.includes("payload.role"), false);
  assert.ok(handler.includes('request.headers.get("idempotency-key")'));
});

test("Edge Function uses bounded payloads and exact allowlisted origins", () => {
  assert.ok(handler.includes("MAX_BODY_BYTES = 4096"));
  assert.ok(handler.includes('const getEnv = dependencies.getEnv ?? ((name: string) => Deno.env.get(name))'));
  assert.ok(handler.includes("if (origin && !origins.has(origin))"));
  assert.ok(handler.includes('"Cache-Control", "no-store"'));
});

test("gateway JWT verification is enabled and live-release gates remain explicit", () => {
  assert.ok(config.includes("[functions.close-vacancy]"));
  assert.ok(config.includes("verify_jwt = true"));
  assert.ok(docs.includes("Not owner-approved, deployed, or applied"));
  assert.ok(docs.includes("separately approved isolated database target"));
  assert.ok(docs.includes("No migration was executed"));
});

test("Close Job migration is additive and does not create a competing core schema", () => {
  for (const table of ["organizations", "organization_memberships", "platform_roles", "vacancies"]) {
    assert.equal(
      new RegExp("CREATE\\s+TABLE\\s+(?:public\\.)?" + table + "\\b", "i").test(migration),
      false,
      "Close Job migration must not create canonical core table " + table,
    );
  }
  assert.ok(migration.includes("ADD COLUMN IF NOT EXISTS closed_at"));
  assert.ok(migration.includes("ADD COLUMN IF NOT EXISTS closure_reason_code"));
  assert.ok(coreSchema.includes("CREATE TABLE public.organizations"));
  assert.ok(coreSchema.includes("CREATE TABLE public.organization_memberships"));
  assert.ok(coreSchema.includes("CREATE TABLE public.vacancies"));
});

test("anonymous and authenticated table grants do not expose internal creator identity", () => {
  assert.ok(migration.includes("GRANT SELECT ("));
  assert.equal(/GRANT SELECT ON public\\.vacancies TO authenticated/i.test(migration), false);
  assert.ok(coreSchema.includes("created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL"));
  assert.equal(/created_by[\\s,)]/.test(migration.split("GRANT SELECT (")[1] ?? ""), true);
  assert.equal(/REVOKE ALL ON public\\.organizations|REVOKE ALL ON public\\.organization_memberships/i.test(migration), false);
});
