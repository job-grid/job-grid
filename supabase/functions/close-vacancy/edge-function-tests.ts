import { createCloseVacancyHandler } from "./index.ts";

const ORIGIN = "https://jobs.example";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ACTOR_ID = "00000000-0000-4000-8000-000000000099";
const VACANCY_ID = "20000000-0000-4000-8000-000000000001";
const VALID_BODY = {
  vacancy_id: VACANCY_ID,
  reason_code: "filled",
  expected_version: 7,
};
const VALID_HEADERS = {
  origin: ORIGIN,
  authorization: "Bearer valid-test-token",
  "content-type": "application/json",
  "idempotency-key": "close-request-0001",
};
const DEFAULT_ENV: Record<string, string> = {
  ALLOWED_ORIGINS: ORIGIN + ",https://admin.example",
  SUPABASE_URL: "https://supabase.example",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-server-key",
};

type HarnessOptions = {
  env?: Record<string, string | undefined>;
  authResponse?: {
    data: { user: { id: string } | null };
    error: { code?: string } | null;
  };
  rpcResponse?: {
    data: unknown;
    error: { code?: string } | null;
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

function makeHarness(options: HarnessOptions = {}) {
  const env = { ...DEFAULT_ENV, ...options.env };
  const calls: {
    clientCount: number;
    clientUrl?: string;
    clientKey?: string;
    authToken?: string;
    rpcName?: string;
    rpcArgs?: Record<string, unknown>;
  } = { clientCount: 0 };

  const handler = createCloseVacancyHandler({
    getEnv: (name) => env[name],
    createAdminClient: (url, key) => {
      calls.clientCount++;
      calls.clientUrl = url;
      calls.clientKey = key;
      return {
        auth: {
          getUser: async (token: string) => {
            calls.authToken = token;
            return options.authResponse ?? {
              data: { user: { id: ACTOR_ID } },
              error: null,
            };
          },
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
          calls.rpcName = name;
          calls.rpcArgs = args;
          return options.rpcResponse ?? {
            data: {
              ok: true,
              replayed: false,
              vacancy_id: VACANCY_ID,
              status: "closed",
              version: 8,
            },
            error: null,
          };
        },
      } as never;
    },
  });

  return { handler, calls };
}

function postRequest(body: unknown = VALID_BODY, headers: Record<string, string> = VALID_HEADERS): Request {
  return new Request("https://function.example/close-vacancy", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("rejects an untrusted origin before constructing a privileged client", async () => {
  const { handler, calls } = makeHarness();
  const response = await handler.fetch(postRequest(VALID_BODY, {
    ...VALID_HEADERS,
    origin: "https://attacker.example",
  }));
  assertEquals(response.status, 403, "status");
  assertEquals((await responseJson(response)).error, "ORIGIN_NOT_ALLOWED", "error code");
  assertEquals(calls.clientCount, 0, "admin clients created");
});

Deno.test("preflights only configured origins", async () => {
  const { handler, calls } = makeHarness();
  const response = await handler.fetch(new Request("https://function.example/close-vacancy", {
    method: "OPTIONS",
    headers: { origin: ORIGIN },
  }));
  assertEquals(response.status, 204, "preflight status");
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), ORIGIN, "allow-origin header");
  assertEquals(calls.clientCount, 0, "admin clients created");
});

Deno.test("requires a POST request and a configured backend", async () => {
  const h1 = makeHarness();
  const getResponse = await h1.handler.fetch(new Request("https://function.example/close-vacancy", {
    method: "GET",
    headers: { origin: ORIGIN },
  }));
  assertEquals(getResponse.status, 405, "GET status");

  const h2 = makeHarness({ env: { SUPABASE_SERVICE_ROLE_KEY: "" } });
  const response = await h2.handler.fetch(postRequest());
  assertEquals(response.status, 500, "missing config status");
  assertEquals((await responseJson(response)).error, "BACKEND_NOT_CONFIGURED", "missing config error");
  assertEquals(h2.calls.clientCount, 0, "admin clients created");
});

Deno.test("rejects missing bearer token, extra actor fields, and invalid idempotency keys", async () => {
  const h1 = makeHarness();
  const missingBearer = { ...VALID_HEADERS };
  delete (missingBearer as Record<string, string>).authorization;
  const unauthenticated = await h1.handler.fetch(postRequest(VALID_BODY, missingBearer));
  assertEquals(unauthenticated.status, 401, "missing bearer status");

  const h2 = makeHarness();
  const actorSpoof = await h2.handler.fetch(postRequest({
    ...VALID_BODY,
    actor_user_id: OTHER_ACTOR_ID,
  }));
  assertEquals(actorSpoof.status, 422, "spoofed actor status");
  assertEquals((await responseJson(actorSpoof)).error, "INVALID_ARGUMENT", "spoofed actor error");
  assertEquals(h2.calls.clientCount, 0, "client should not be created for invalid payload");

  const h3 = makeHarness();
  const invalidKey = await h3.handler.fetch(postRequest(VALID_BODY, {
    ...VALID_HEADERS,
    "idempotency-key": "short",
  }));
  assertEquals(invalidKey.status, 422, "invalid idempotency key status");
});

Deno.test("derives RPC actor only from the verified Auth user and forwards the idempotency key", async () => {
  const { handler, calls } = makeHarness({
    authResponse: { data: { user: { id: OTHER_ACTOR_ID } }, error: null },
  });
  const response = await handler.fetch(postRequest());
  assertEquals(response.status, 200, "success status");
  assertEquals(calls.clientUrl, DEFAULT_ENV.SUPABASE_URL, "server-side Supabase URL");
  assertEquals(calls.clientKey, DEFAULT_ENV.SUPABASE_SERVICE_ROLE_KEY, "server-side key injection");
  assertEquals(calls.authToken, "valid-test-token", "verified session token");
  assertEquals(calls.rpcName, "close_published_vacancy", "RPC name");
  assertEquals(calls.rpcArgs?.p_actor_user_id, OTHER_ACTOR_ID, "actor derived from Auth response");
  assertEquals(calls.rpcArgs?.p_actor_user_id === ACTOR_ID, false, "unverified body identity must not be used");
  assertEquals(calls.rpcArgs?.p_vacancy_id, VACANCY_ID, "vacancy id");
  assertEquals(calls.rpcArgs?.p_expected_version, 7, "expected version");
  assertEquals(calls.rpcArgs?.p_idempotency_key, "close-request-0001", "idempotency key");
  assertEquals(response.headers.get("Cache-Control"), "no-store", "cache control");
});

Deno.test("rejects invalid Auth tokens without calling the database function", async () => {
  const { handler, calls } = makeHarness({
    authResponse: { data: { user: null }, error: { code: "invalid_token" } },
  });
  const response = await handler.fetch(postRequest());
  assertEquals(response.status, 401, "status");
  assertEquals((await responseJson(response)).error, "UNAUTHENTICATED", "error");
  assertEquals(calls.rpcName, undefined, "RPC must not run");
});

Deno.test("maps a database authorization denial to 403 without exposing internals", async () => {
  const { handler } = makeHarness({
    rpcResponse: { data: { ok: false, error: "FORBIDDEN" }, error: null },
  });
  const response = await handler.fetch(postRequest());
  assertEquals(response.status, 403, "status");
  assertEquals((await responseJson(response)).error, "FORBIDDEN", "error");
});

Deno.test("returns a safe internal error when the database client fails", async () => {
  const { handler } = makeHarness({
    rpcResponse: { data: null, error: { code: "SECRET_DB_DETAIL" } },
  });
  const response = await handler.fetch(postRequest());
  assertEquals(response.status, 500, "status");
  const payload = await responseJson(response);
  assertEquals(payload.error, "INTERNAL_ERROR", "safe error");
  assert(!JSON.stringify(payload).includes("SECRET_DB_DETAIL"), "database internal details leaked");
});

Deno.test("rejects invalid payload shapes and oversized bodies", async () => {
  const { handler } = makeHarness();
  const invalidBody = await handler.fetch(new Request("https://function.example/close-vacancy", {
    method: "POST",
    headers: VALID_HEADERS,
    body: "[]",
  }));
  assertEquals(invalidBody.status, 422, "array body status");

  const large = "x".repeat(5000);
  const oversized = await handler.fetch(new Request("https://function.example/close-vacancy", {
    method: "POST",
    headers: { ...VALID_HEADERS, "content-type": "text/plain" },
    body: large,
  }));
  assertEquals(oversized.status, 422, "oversized body status");
});
