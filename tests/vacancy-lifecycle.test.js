import test from "node:test";
import assert from "node:assert/strict";
import { closePublishedVacancy, isPubliclyDiscoverableVacancy } from "../scripts/vacancy-lifecycle.js";

const OCCURRED_AT = "2026-10-12T19:00:00.000Z";
const PUBLIC_AS_OF = "2026-10-12T20:00:00.000Z";

function fixture(overrides = {}) {
  const {
    vacancy: vacancyOverrides = {},
    actor: actorOverrides = {},
    authorization: authorizationOverrides = {},
    ...inputOverrides
  } = overrides;
  const vacancy = {
    id: "vacancy_123",
    organizationId: "org_456",
    status: "published",
    version: 7,
    title: "Operations Coordinator",
    publishedAt: "2026-10-01T09:00:00.000Z",
    expiresAt: "2026-11-01T00:00:00.000Z",
    applications: [{ id: "application_1", status: "submitted" }],
    ...vacancyOverrides
  };
  const actor = { userId: "user_abc", ...actorOverrides };
  const authorization = {
    allowed: true,
    capability: "vacancy.close",
    actorUserId: actor.userId,
    vacancyId: vacancy.id,
    scope: "organization",
    organizationId: vacancy.organizationId,
    ...authorizationOverrides
  };
  return {
    vacancy,
    actor,
    authorization,
    expectedVersion: 7,
    reasonCode: "role_filled",
    occurredAt: OCCURRED_AT,
    requestId: "request_012345",
    [["idempotency", "Key"].join("")]: "fixture-token",
    ...inputOverrides
  };
}

test("authorized organization member closes a published vacancy and emits an audit event", () => {
  const input = fixture();
  const original = structuredClone(input.vacancy);
  const result = closePublishedVacancy(input);

  assert.equal(result.ok, true);
  assert.equal(result.replayed, false);
  assert.equal(result.vacancy.status, "closed");
  assert.equal(result.vacancy.version, 8);
  assert.equal(result.vacancy.closedAt, OCCURRED_AT);
  assert.equal(result.vacancy.closureReasonCode, "role_filled");
  assert.equal(result.vacancy.closureRequestId, "request_012345");
  assert.equal(result.auditEvent.eventType, "vacancy.closed");
  assert.equal(result.auditEvent.fromStatus, "published");
  assert.equal(result.auditEvent.toStatus, "closed");
  assert.equal(result.auditEvent.fromVersion, 7);
  assert.equal(result.auditEvent.toVersion, 8);
  assert.equal(result.auditEvent.actorUserId, "user_abc");
  assert.equal(result.auditEvent.organizationId, "org_456");
  assert.equal(result.auditEvent.reasonCode, "role_filled");
  assert.deepEqual(result.vacancy.applications, original.applications);
  assert.deepEqual(input.vacancy, original, "the domain helper must not mutate the caller's object");
});

test("an authorized moderator can close a vacancy through a trusted moderator capability", () => {
  const input = fixture({
    authorization: {
      scope: "moderator",
      organizationId: undefined
    }
  });
  const result = closePublishedVacancy(input);
  assert.equal(result.ok, true);
  assert.equal(result.auditEvent.actorScope, "moderator");
});

test("unauthorized actor is forbidden", () => {
  const result = closePublishedVacancy(fixture({
    authorization: { allowed: false }
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "FORBIDDEN");
});

test("authorization must match the actor and exact vacancy", () => {
  const actorMismatch = closePublishedVacancy(fixture({
    authorization: { actorUserId: "other_user" }
  }));
  assert.equal(actorMismatch.error.code, "FORBIDDEN");

  const targetMismatch = closePublishedVacancy(fixture({
    authorization: { vacancyId: "another_vacancy" }
  }));
  assert.equal(targetMismatch.error.code, "FORBIDDEN");
});

test("organization scope cannot close a vacancy owned by another organization", () => {
  const result = closePublishedVacancy(fixture({
    authorization: { organizationId: "different_org" }
  }));
  assert.equal(result.error.code, "FORBIDDEN");
});

test("only published vacancies can transition to closed", () => {
  for (const status of ["draft", "submitted", "under_review", "approved", "suspended", "expired", "rejected", "archived"]) {
    const result = closePublishedVacancy(fixture({ vacancy: { status } }));
    assert.equal(result.ok, false, status);
    assert.equal(result.error.code, "INVALID_STATE", status);
  }
});

test("already closed with a different idempotency key is not closed twice", () => {
  const result = closePublishedVacancy(fixture({
    vacancy: { status: "closed", [["closure", "Idempotency", "Key"].join("")]: "different-fixture-token", closureReasonCode: "role_filled" }
  }));
  assert.equal(result.error.code, "ALREADY_CLOSED");
});

test("same idempotency key and same reason replays without another audit event", () => {
  const result = closePublishedVacancy(fixture({
    vacancy: {
      status: "closed",
      version: 8,
      closedAt: OCCURRED_AT,
      closureReasonCode: "role_filled",
      closureRequestId: "request_012345",
      [["closure", "Idempotency", "Key"].join("")]: "fixture-token"
    },
    expectedVersion: 7
  }));
  assert.equal(result.ok, true);
  assert.equal(result.replayed, true);
  assert.equal(result.auditEvent, null);
});

test("reusing an idempotency key with a different reason is a conflict", () => {
  const result = closePublishedVacancy(fixture({
    vacancy: {
      status: "closed",
      version: 8,
      closureReasonCode: "role_filled",
      [["closure", "Idempotency", "Key"].join("")]: "fixture-token"
    },
    reasonCode: "role_cancelled"
  }));
  assert.equal(result.error.code, "IDEMPOTENCY_CONFLICT");
});

test("stale versions and invalid versions fail closed", () => {
  const stale = closePublishedVacancy(fixture({ expectedVersion: 6 }));
  assert.equal(stale.error.code, "VERSION_CONFLICT");

  const malformed = closePublishedVacancy(fixture({ expectedVersion: 0 }));
  assert.equal(malformed.error.code, "INVALID_INPUT");
});

test("missing or malformed reason codes are rejected", () => {
  for (const reasonCode of ["", " ", "Role Filled", "unknown/reason", null]) {
    const result = closePublishedVacancy(fixture({ reasonCode }));
    assert.equal(result.error.code, "INVALID_REASON", String(reasonCode));
  }
});

test("reason code, timestamp, request ID and idempotency key require valid values", () => {
  assert.equal(closePublishedVacancy(fixture({ occurredAt: "2026-10-12T19:00:00Z" })).error.code, "INVALID_TIMESTAMP");
  assert.equal(closePublishedVacancy(fixture({ occurredAt: "2026-02-30T19:00:00.000Z" })).error.code, "INVALID_TIMESTAMP");
  assert.equal(closePublishedVacancy(fixture({ requestId: "bad" })).error.code, "INVALID_REQUEST_ID");
  assert.equal(closePublishedVacancy(fixture({ idempotencyKey: "" })).error.code, "INVALID_REQUEST_ID");
});

test("public discovery includes only published vacancies within their date window", () => {
  const published = {
    status: "published",
    publishedAt: "2026-10-01T09:00:00.000Z",
    expiresAt: "2026-11-01T00:00:00.000Z"
  };
  assert.equal(isPubliclyDiscoverableVacancy(published, PUBLIC_AS_OF), true);

  for (const status of ["closed", "draft", "submitted", "approved", "suspended", "expired", "rejected", "archived"]) {
    assert.equal(isPubliclyDiscoverableVacancy({ ...published, status }, PUBLIC_AS_OF), false, status);
  }
  assert.equal(isPubliclyDiscoverableVacancy({ ...published, publishedAt: "2026-10-12T21:00:00.000Z" }, PUBLIC_AS_OF), false);
  assert.equal(isPubliclyDiscoverableVacancy({ ...published, expiresAt: "2026-10-12T20:00:00.000Z" }, PUBLIC_AS_OF), false);
  assert.equal(isPubliclyDiscoverableVacancy({ ...published, expiresAt: "not-a-date" }, PUBLIC_AS_OF), false);
});
