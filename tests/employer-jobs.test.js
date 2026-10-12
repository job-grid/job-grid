import test from "node:test";
import assert from "node:assert/strict";
import {
  canCloseVacancy,
  closeVacancy,
  friendlyEmployerError,
  loadEmployerVacancies,
  normalizeEmployerConfig,
} from "../scripts/employer-jobs.js";

const CONFIG = {
  supabaseUrl: "https://job-grid-test.supabase.co",
  publishableKey: "sb_publishable_test_only",
};
const SESSION = {
  accessToken: "test-access-token",
  user: { id: "00000000-0000-4000-8000-000000000001" },
};
const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const VACANCY = {
  id: "20000000-0000-4000-8000-000000000001",
  organization_id: "10000000-0000-4000-8000-000000000001",
  reference_code: "JG-OPS-001",
  title: "Operations Coordinator",
  status: "published",
  version: 4,
  published_at: "2026-10-01T00:00:00.000Z",
  expires_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-10-12T10:00:00.000Z",
  membershipRole: "recruiter",
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("runtime config stays disabled until public project settings are supplied", () => {
  assert.deepEqual(normalizeEmployerConfig({}), {
    configured: false,
    error: "BACKEND_NOT_CONFIGURED",
  });
  assert.deepEqual(normalizeEmployerConfig({
    supabaseUrl: "http://job-grid-test.supabase.co",
    publishableKey: "public-test",
  }), {
    configured: false,
    error: "INVALID_BACKEND_URL",
  });
  assert.equal(normalizeEmployerConfig({
    ...CONFIG,
    closeFunctionUrl: "https://attacker.example/collect",
  }).error, "INVALID_CLOSE_ENDPOINT");
});

test("configured Close Job endpoint must remain on the approved project origin", () => {
  const config = normalizeEmployerConfig({
    ...CONFIG,
    closeFunctionUrl: "https://job-grid-test.supabase.co/functions/v1/close-vacancy",
  });
  assert.equal(config.configured, true);
  assert.equal(
    config.closeFunctionUrl,
    "https://job-grid-test.supabase.co/functions/v1/close-vacancy",
  );
});

test("vacancy closure eligibility requires a published, in-window version and an eligible tenant role", () => {
  assert.equal(canCloseVacancy(VACANCY, NOW), true);
  assert.equal(canCloseVacancy({ ...VACANCY, status: "draft" }, NOW), false);
  assert.equal(canCloseVacancy({ ...VACANCY, status: "closed" }, NOW), false);
  assert.equal(canCloseVacancy({ ...VACANCY, membershipRole: "viewer" }, NOW), false);
  assert.equal(canCloseVacancy({ ...VACANCY, membershipRole: "agency_guest" }, NOW), false);
  assert.equal(canCloseVacancy({ ...VACANCY, published_at: "2026-10-13T00:00:00.000Z" }, NOW), false);
  assert.equal(canCloseVacancy({ ...VACANCY, expires_at: "2026-10-12T11:59:00.000Z" }, NOW), false);
  assert.equal(canCloseVacancy({ ...VACANCY, version: 0 }, NOW), false);
});

test("vacancy list is loaded with the verified session and rendered only inside active tenant memberships", async () => {
  const calls = [];
  const fetchMock = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.pathname.endsWith("/organization_memberships")) {
      return response([
        { organization_id: VACANCY.organization_id, role: "recruiter", status: "active" },
        { organization_id: "10000000-0000-4000-8000-000000000002", role: "viewer", status: "active" },
        { organization_id: "10000000-0000-4000-8000-000000000003", role: "owner", status: "revoked" },
      ]);
    }
    if (url.pathname.endsWith("/vacancies")) {
      return response([
        VACANCY,
        {
          ...VACANCY,
          id: "20000000-0000-4000-8000-000000000002",
          organization_id: "10000000-0000-4000-8000-000000000002",
          membershipRole: undefined,
          title: "Finance Officer",
        },
        {
          ...VACANCY,
          id: "20000000-0000-4000-8000-000000000003",
          organization_id: "10000000-0000-4000-8000-000000000004",
          title: "Other tenant vacancy",
        },
      ]);
    }
    if (url.pathname.endsWith("/organizations")) {
      return response([
        { id: VACANCY.organization_id, display_name: "Employer One" },
        { id: "10000000-0000-4000-8000-000000000002", display_name: "Employer Two" },
      ]);
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };

  const vacancies = await loadEmployerVacancies(CONFIG, SESSION, fetchMock);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.init.headers.Authorization === `Bearer ${SESSION.accessToken}`));
  assert.ok(calls.every((call) => call.init.headers.apikey === CONFIG.publishableKey));
  const membershipRequest = calls.find((call) => call.url.pathname.endsWith("/organization_memberships"));
  assert.equal(membershipRequest.url.searchParams.get("user_id"), `eq.${SESSION.user.id}`);
  assert.equal(membershipRequest.url.searchParams.get("status"), "eq.active");
  const vacancyRequest = calls.find((call) => call.url.pathname.endsWith("/vacancies"));
  assert.equal(vacancyRequest.url.searchParams.has("organization_id"), false, "client filter is not the tenant security boundary");

  assert.deepEqual(vacancies.map((vacancy) => vacancy.title), ["Operations Coordinator", "Finance Officer"]);
  assert.equal(vacancies[0].organization.display_name, "Employer One");
  assert.equal(vacancies[0].membershipRole, "recruiter");
  assert.equal(vacancies[1].membershipRole, "viewer");
});

test("vacancy list refuses a session without verified user and access token", async () => {
  let calls = 0;
  await assert.rejects(
    loadEmployerVacancies(CONFIG, { accessToken: "token-only" }, async () => {
      calls += 1;
      return response([]);
    }),
    /AUTH_REQUIRED/,
  );
  assert.equal(calls, 0);
});

test("Close Job POST uses the verified bearer session, exact payload, and idempotency key", async () => {
  let captured;
  const idempotencyKey = "close-retry-0001";
  const result = await closeVacancy(
    CONFIG,
    SESSION,
    VACANCY,
    "filled",
    idempotencyKey,
    async (input, init) => {
      captured = { url: new URL(input), init };
      return response({ ok: true, status: "closed", version: 5, replayed: false });
    },
  );

  assert.equal(result.status, "closed");
  assert.equal(captured.url.href, "https://job-grid-test.supabase.co/functions/v1/close-vacancy");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.Authorization, `Bearer ${SESSION.accessToken}`);
  assert.equal(captured.init.headers.apikey, CONFIG.publishableKey);
  assert.equal(captured.init.headers["Idempotency-Key"], idempotencyKey);
  assert.equal(captured.init.cache, "no-store");
  assert.deepEqual(JSON.parse(captured.init.body), {
    vacancy_id: VACANCY.id,
    reason_code: "filled",
    expected_version: VACANCY.version,
  });
  assert.equal("actor_user_id" in JSON.parse(captured.init.body), false);
  assert.equal("status" in JSON.parse(captured.init.body), false);
});

test("Close Job fails closed for a viewer, an invalid reason, or an invalid vacancy", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    return response({ ok: true, status: "closed" });
  };

  await assert.rejects(
    closeVacancy(CONFIG, SESSION, { ...VACANCY, membershipRole: "viewer" }, "filled", "close-retry-0001", fetchMock),
    /VACANCY_NOT_CLOSABLE/,
  );
  await assert.rejects(
    closeVacancy(CONFIG, SESSION, VACANCY, "arbitrary_reason", "close-retry-0001", fetchMock),
    /INVALID_REASON/,
  );
  await assert.rejects(
    closeVacancy(CONFIG, SESSION, { ...VACANCY, id: "not-a-uuid" }, "filled", "close-retry-0001", fetchMock),
    /INVALID_VACANCY/,
  );
  assert.equal(calls, 0);
});

test("backend authorization and stale-version failures are not shown as successful closure", async () => {
  await assert.rejects(
    closeVacancy(CONFIG, SESSION, VACANCY, "filled", "close-retry-0001", async () => response({ error: "FORBIDDEN" }, 403)),
    /FORBIDDEN/,
  );
  await assert.rejects(
    closeVacancy(CONFIG, SESSION, VACANCY, "filled", "close-retry-0001", async () => response({ error: "VERSION_CONFLICT" }, 409)),
    /VERSION_CONFLICT/,
  );
  assert.equal(friendlyEmployerError(new Error("FORBIDDEN")), "Your current organization role is not permitted to close this vacancy.");
  assert.equal(friendlyEmployerError(new Error("VERSION_CONFLICT")), "This vacancy changed after you opened the page. Refresh before trying again.");
});

test("network errors show safe guidance and never reveal raw service details", () => {
  assert.equal(
    friendlyEmployerError(new Error("BACKEND_UNREACHABLE")),
    "Job Grid could not reach the backend. Check the connection and try again.",
  );
  assert.equal(
    friendlyEmployerError(new Error("SECRET_DB_DETAIL")),
    "Something went wrong. Please refresh and try again.",
  );
});
