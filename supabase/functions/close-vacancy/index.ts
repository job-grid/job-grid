import { createClient } from "@supabase/supabase-js";

const MAX_BODY_BYTES = 4096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const REASON_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

type JsonObject = Record<string, unknown>;

function configuredOrigins(): Set<string> {
  return new Set(
    (Deno.env.get("ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(origin: string | null, allowed: Set<string>): Headers {
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, idempotency-key",
    "Access-Control-Max-Age": "86400",
  });
  if (origin && allowed.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function jsonResponse(body: JsonObject, status: number, headers: Headers): Response {
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

async function readLimitedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    byteLength += item.value.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("BODY_TOO_LARGE");
    }
    chunks.push(item.value);
  }

  const merged = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function errorStatus(code: string): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "INVALID_ARGUMENT":
    case "INVALID_IDEMPOTENCY_KEY":
    case "INVALID_REASON":
      return 422;
    case "ALREADY_CLOSED":
    case "INVALID_STATE":
    case "VERSION_CONFLICT":
    case "IDEMPOTENCY_CONFLICT":
      return 409;
    default:
      return 500;
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    const origin = request.headers.get("origin");
    const origins = configuredOrigins();
    const headers = corsHeaders(origin, origins);

    if (origin && !origins.has(origin)) {
      return jsonResponse({ error: "ORIGIN_NOT_ALLOWED", request_id: requestId }, 403, headers);
    }

    if (request.method === "OPTIONS") {
      if (!origin || !origins.has(origin)) {
        return jsonResponse({ error: "ORIGIN_NOT_ALLOWED", request_id: requestId }, 403, headers);
      }
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "METHOD_NOT_ALLOWED", request_id: requestId }, 405, headers);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "BACKEND_NOT_CONFIGURED", request_id: requestId }, 500, headers);
    }

    const authorization = request.headers.get("authorization") ?? "";
    const bearer = authorization.match(/^Bearer\s+(\S+)$/i);
    if (!bearer) {
      return jsonResponse({ error: "UNAUTHENTICATED", request_id: requestId }, 401, headers);
    }

    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
      return jsonResponse({ error: "INVALID_IDEMPOTENCY_KEY", request_id: requestId }, 422, headers);
    }

    let payload: JsonObject;
    try {
      const rawBody = await readLimitedBody(request);
      if (rawBody.length === 0 || new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return jsonResponse({ error: "INVALID_ARGUMENT", request_id: requestId }, 422, headers);
      }
      const parsed: unknown = JSON.parse(rawBody);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return jsonResponse({ error: "INVALID_ARGUMENT", request_id: requestId }, 422, headers);
      }
      payload = parsed as JsonObject;
    } catch {
      return jsonResponse({ error: "INVALID_ARGUMENT", request_id: requestId }, 422, headers);
    }

    // Reject client-supplied actor, organization, role, target status or audit fields.
    const permittedKeys = new Set(["vacancy_id", "reason_code", "expected_version"]);
    if (Object.keys(payload).some((key) => !permittedKeys.has(key))) {
      return jsonResponse({ error: "INVALID_ARGUMENT", request_id: requestId }, 422, headers);
    }

    const vacancyId = payload.vacancy_id;
    const reasonCode = payload.reason_code;
    const expectedVersion = payload.expected_version;

    if (
      typeof vacancyId !== "string" ||
      !UUID_PATTERN.test(vacancyId) ||
      typeof reasonCode !== "string" ||
      !REASON_PATTERN.test(reasonCode) ||
      typeof expectedVersion !== "number" ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    ) {
      return jsonResponse({ error: "INVALID_ARGUMENT", request_id: requestId }, 422, headers);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(bearer[1]);
    if (authError || !authData.user) {
      return jsonResponse({ error: "UNAUTHENTICATED", request_id: requestId }, 401, headers);
    }

    const { data, error } = await admin.rpc("close_published_vacancy", {
      p_vacancy_id: vacancyId,
      p_actor_user_id: authData.user.id,
      p_reason_code: reasonCode,
      p_expected_version: expectedVersion,
      p_request_id: requestId,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      console.error("close-vacancy RPC failed", {
        request_id: requestId,
        code: error.code ?? "RPC_ERROR",
      });
      return jsonResponse({ error: "INTERNAL_ERROR", request_id: requestId }, 500, headers);
    }

    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      console.error("close-vacancy RPC returned invalid shape", { request_id: requestId });
      return jsonResponse({ error: "INTERNAL_ERROR", request_id: requestId }, 500, headers);
    }

    const result = data as JsonObject;
    if (result.ok !== true) {
      const code = typeof result.error === "string" ? result.error : "INTERNAL_ERROR";
      return jsonResponse({ error: code, request_id: requestId }, errorStatus(code), headers);
    }

    return jsonResponse({ ...result, response_request_id: requestId }, 200, headers);
  },
};
