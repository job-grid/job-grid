/**
 * Backend-neutral vacancy closure domain rule.
 *
 * IMPORTANT: call only from a trusted server path after the server has resolved
 * the current session, active organization membership/moderator permission,
 * vacancy ownership/scope, and active reason-code catalog entry. Never accept
 * the authorization object directly from a browser request.
 *
 * This module is intentionally not included in the public static build. It does
 * not persist changes; callers must perform an authorized, version-checked
 * database transaction and append the returned audit event atomically.
 */

const FAILURE_MESSAGES = Object.freeze({
  INVALID_INPUT: "The closure request is invalid.",
  UNAUTHENTICATED: "A verified actor is required.",
  FORBIDDEN: "The actor is not authorized to close this vacancy.",
  INVALID_STATE: "Only a published vacancy can be closed.",
  ALREADY_CLOSED: "The vacancy is already closed.",
  VERSION_CONFLICT: "The vacancy has changed. Reload it before trying again.",
  IDEMPOTENCY_CONFLICT: "The idempotency key was already used for a different closure request.",
  INVALID_REASON: "A valid controlled reason code is required.",
  INVALID_TIMESTAMP: "The closure timestamp must be a canonical UTC timestamp.",
  INVALID_REQUEST_ID: "A valid request ID and idempotency key are required."
});

function fail(code) {
  return { ok: false, error: { code, message: FAILURE_MESSAGES[code] ?? FAILURE_MESSAGES.INVALID_INPUT } };
}

function nonBlankString(value, maxLength = 256) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.trim().length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

function isValidRequestToken(value) {
  return nonBlankString(value, 128) && value.trim().length >= 8;
}

function hasCloseCapability({ vacancy, actor, authorization }) {
  if (!authorization || authorization.allowed !== true) return false;
  if (authorization.capability !== "vacancy.close") return false;
  if (authorization.actorUserId !== actor.userId) return false;
  if (authorization.vacancyId !== vacancy.id) return false;

  if (authorization.scope === "organization") {
    return nonBlankString(vacancy.organizationId)
      && authorization.organizationId === vacancy.organizationId;
  }

  // The trusted API must set this scope only after independently checking the
  // active moderator permission and any conflict-of-interest constraints.
  return authorization.scope === "moderator";
}

/**
 * Close a published vacancy with optimistic concurrency and an auditable result.
 *
 * @returns {object} { ok: true, vacancy, auditEvent, replayed } or a structured error.
 */
export function closePublishedVacancy(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("INVALID_INPUT");

  const { vacancy, actor, authorization, expectedVersion, reasonCode, occurredAt, requestId, idempotencyKey } = input;
  if (!vacancy || typeof vacancy !== "object" || Array.isArray(vacancy)
    || !nonBlankString(vacancy.id)
    || !nonBlankString(vacancy.organizationId)
    || !Number.isSafeInteger(vacancy.version)
    || vacancy.version < 1
    || !nonBlankString(vacancy.status)) return fail("INVALID_INPUT");

  if (!actor || typeof actor !== "object" || !nonBlankString(actor.userId)) return fail("UNAUTHENTICATED");
  if (!hasCloseCapability({ vacancy, actor, authorization })) return fail("FORBIDDEN");

  // Require a controlled catalog-style identifier. The server must additionally
  // resolve it against the active, approved reason catalog before calling here.
  if (!nonBlankString(reasonCode, 64) || !/^[a-z][a-z0-9_]{1,63}$/.test(reasonCode.trim())) {
    return fail("INVALID_REASON");
  }
  if (!isCanonicalUtcTimestamp(occurredAt)) return fail("INVALID_TIMESTAMP");
  if (!isValidRequestToken(requestId) || !isValidRequestToken(idempotencyKey)) return fail("INVALID_REQUEST_ID");
  const normalizedRequestId = requestId.trim();
  const normalizedIdempotencyKey = idempotencyKey.trim();

  // Safe replay: caller must still be authorized. Do not emit a second audit event.
  if (vacancy.status === "closed") {
    if (vacancy.closureIdempotencyKey === normalizedIdempotencyKey) {
      if (vacancy.closureReasonCode !== reasonCode.trim()) return fail("IDEMPOTENCY_CONFLICT");
      return {
        ok: true,
        replayed: true,
        vacancy: { ...vacancy },
        auditEvent: null
      };
    }
    return fail("ALREADY_CLOSED");
  }

  if (vacancy.status !== "published") return fail("INVALID_STATE");
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return fail("INVALID_INPUT");
  if (vacancy.version >= Number.MAX_SAFE_INTEGER) return fail("INVALID_INPUT");
  if (expectedVersion !== vacancy.version) return fail("VERSION_CONFLICT");

  const closedVacancy = {
    ...vacancy,
    status: "closed",
    version: vacancy.version + 1,
    closedAt: occurredAt,
    closureReasonCode: reasonCode.trim(),
    closureRequestId: normalizedRequestId,
    closureIdempotencyKey: normalizedIdempotencyKey,
    updatedAt: occurredAt
  };

  return {
    ok: true,
    replayed: false,
    vacancy: closedVacancy,
    auditEvent: {
      eventType: "vacancy.closed",
      actorUserId: actor.userId.trim(),
      actorScope: authorization.scope,
      organizationId: vacancy.organizationId,
      resourceType: "vacancy",
      resourceId: vacancy.id,
      fromStatus: "published",
      toStatus: "closed",
      fromVersion: vacancy.version,
      toVersion: closedVacancy.version,
      reasonCode: reasonCode.trim(),
      occurredAt,
      requestId: normalizedRequestId
    }
  };
}

/**
 * Conservative predicate for public search/detail handlers.
 * The backend must call this after its own authorization and database query;
 * filtering in a browser is never a privacy/access-control boundary.
 */
export function isPubliclyDiscoverableVacancy(vacancy, asOf) {
  if (!vacancy || typeof vacancy !== "object" || vacancy.status !== "published") return false;
  if (!isCanonicalUtcTimestamp(asOf) || !isCanonicalUtcTimestamp(vacancy.publishedAt)) return false;
  if (Date.parse(vacancy.publishedAt) > Date.parse(asOf)) return false;

  if (vacancy.expiresAt != null) {
    if (!isCanonicalUtcTimestamp(vacancy.expiresAt)) return false;
    if (Date.parse(vacancy.expiresAt) <= Date.parse(asOf)) return false;
  }
  return true;
}
