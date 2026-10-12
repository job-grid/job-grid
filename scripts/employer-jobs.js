const ALLOWED_CLOSE_REASONS = new Set([
  "filled",
  "cancelled_by_employer",
  "incorrect_listing",
]);
const CLOSE_ROLES = new Set(["owner", "admin", "recruiter"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function normalizeEmployerConfig(config = {}) {
  const supabaseUrl = typeof config.supabaseUrl === "string"
    ? config.supabaseUrl.trim().replace(/\/+$/, "")
    : "";
  const publishableKey = typeof config.publishableKey === "string"
    ? config.publishableKey.trim()
    : "";

  if (!supabaseUrl || !publishableKey) {
    return { configured: false, error: "BACKEND_NOT_CONFIGURED" };
  }

  let base;
  try {
    base = new URL(supabaseUrl);
  } catch {
    return { configured: false, error: "INVALID_BACKEND_URL" };
  }
  if (base.protocol !== "https:" || base.pathname !== "/" || base.username || base.password || base.search || base.hash) {
    return { configured: false, error: "INVALID_BACKEND_URL" };
  }

  const expectedCloseUrl = new URL("/functions/v1/close-vacancy", base.origin).href;
  let closeFunctionUrl = expectedCloseUrl;
  if (typeof config.closeFunctionUrl === "string" && config.closeFunctionUrl.trim()) {
    try {
      const candidate = new URL(config.closeFunctionUrl.trim());
      if (
        candidate.protocol !== "https:" ||
        candidate.origin !== base.origin ||
        candidate.pathname !== "/functions/v1/close-vacancy" ||
        candidate.search ||
        candidate.hash ||
        candidate.username ||
        candidate.password
      ) {
        return { configured: false, error: "INVALID_CLOSE_ENDPOINT" };
      }
      closeFunctionUrl = candidate.href;
    } catch {
      return { configured: false, error: "INVALID_CLOSE_ENDPOINT" };
    }
  }

  return {
    configured: true,
    supabaseUrl: base.origin,
    publishableKey,
    closeFunctionUrl,
  };
}

function assertSession(session) {
  if (
    !session ||
    typeof session.accessToken !== "string" ||
    !session.accessToken.trim() ||
    !session.user ||
    typeof session.user.id !== "string" ||
    !UUID_PATTERN.test(session.user.id)
  ) {
    throw new Error("AUTH_REQUIRED");
  }
}

export async function getFreshEmployerSession(auth, previousSession = null) {
  if (!auth || typeof auth.getSession !== "function") {
    throw new Error("AUTH_REQUIRED");
  }

  let session;
  try {
    session = await auth.getSession();
    assertSession(session);
  } catch {
    throw new Error("AUTH_REQUIRED");
  }

  // Do not reuse a vacancy view if another account becomes active in this tab.
  if (previousSession && session.user.id !== previousSession.user.id) {
    throw new Error("AUTH_REQUIRED");
  }

  return session;
}

function getRestUrl(config, resource, parameters = {}) {
  const url = new URL(`/rest/v1/${resource}`, config.supabaseUrl);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function requestJson(fetchImpl, url, options, failureCode = "BACKEND_REQUEST_FAILED") {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch {
    throw new Error("BACKEND_UNREACHABLE");
  }

  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      if (response.ok) throw new Error("INVALID_BACKEND_RESPONSE");
    }
  }

  if (!response.ok) {
    const code = payload && typeof payload.error === "string"
      ? payload.error
      : failureCode;
    throw new Error(code);
  }
  return payload;
}

function authenticatedHeaders(config, session) {
  assertSession(session);
  return {
    apikey: config.publishableKey,
    Authorization: `Bearer ${session.accessToken}`,
    Accept: "application/json",
  };
}

export async function loadEmployerVacancies(rawConfig, session, fetchImpl = fetch) {
  const config = normalizeEmployerConfig(rawConfig);
  if (!config.configured) throw new Error(config.error);
  const headers = authenticatedHeaders(config, session);

  const membershipUrl = getRestUrl(config, "organization_memberships", {
    select: "organization_id,role,status",
    user_id: `eq.${session.user.id}`,
    status: "eq.active",
    order: "organization_id.asc",
    limit: "100",
  });
  const [memberships, vacancies, organizations] = await Promise.all([
    requestJson(fetchImpl, membershipUrl, { headers }, "MEMBERSHIP_LOAD_FAILED"),
    requestJson(fetchImpl, getRestUrl(config, "vacancies", {
      select: "id,organization_id,reference_code,title,status,version,published_at,expires_at,updated_at",
      order: "updated_at.desc",
      limit: "100",
    }), { headers }, "VACANCY_LOAD_FAILED"),
    requestJson(fetchImpl, getRestUrl(config, "organizations", {
      select: "id,display_name",
      order: "display_name.asc",
      limit: "100",
    }), { headers }, "ORGANIZATION_LOAD_FAILED"),
  ]);

  if (!Array.isArray(memberships) || !Array.isArray(vacancies) || !Array.isArray(organizations)) {
    throw new Error("INVALID_BACKEND_RESPONSE");
  }

  // RLS is the tenant boundary. This client-side join only decides what to
  // render and is not used as authorization for a Close Job request.
  const activeMemberships = new Map(
    memberships
      .filter((membership) =>
        membership &&
        membership.status === "active" &&
        typeof membership.organization_id === "string" &&
        typeof membership.role === "string"
      )
      .map((membership) => [membership.organization_id, membership.role]),
  );
  const organizationById = new Map(
    organizations
      .filter((organization) => organization && typeof organization.id === "string")
      .map((organization) => [organization.id, organization]),
  );

  return vacancies
    .filter((vacancy) => vacancy && activeMemberships.has(vacancy.organization_id))
    .map((vacancy) => ({
      ...vacancy,
      organization: organizationById.get(vacancy.organization_id) ?? null,
      membershipRole: activeMemberships.get(vacancy.organization_id),
    }))
    .sort((left, right) => String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? "")));
}

export function canCloseVacancy(vacancy, now = Date.now()) {
  if (!vacancy || vacancy.status !== "published" || !CLOSE_ROLES.has(vacancy.membershipRole)) {
    return false;
  }
  const published = Date.parse(vacancy.published_at);
  const expires = vacancy.expires_at == null ? null : Date.parse(vacancy.expires_at);
  if (!Number.isFinite(published) || published > now) return false;
  if (expires !== null && (!Number.isFinite(expires) || expires <= now)) return false;
  return Number.isSafeInteger(vacancy.version) && vacancy.version >= 1;
}

export async function closeVacancy(
  rawConfig,
  session,
  vacancy,
  reasonCode,
  idempotencyKey,
  fetchImpl = fetch,
) {
  const config = normalizeEmployerConfig(rawConfig);
  if (!config.configured) throw new Error(config.error);
  assertSession(session);
  if (!vacancy || typeof vacancy.id !== "string" || !UUID_PATTERN.test(vacancy.id)) {
    throw new Error("INVALID_VACANCY");
  }
  if (!canCloseVacancy(vacancy)) throw new Error("VACANCY_NOT_CLOSABLE");
  if (!ALLOWED_CLOSE_REASONS.has(reasonCode)) throw new Error("INVALID_REASON");
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    throw new Error("INVALID_IDEMPOTENCY_KEY");
  }

  const payload = await requestJson(
    fetchImpl,
    config.closeFunctionUrl,
    {
      method: "POST",
      headers: {
        ...authenticatedHeaders(config, session),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      cache: "no-store",
      body: JSON.stringify({
        vacancy_id: vacancy.id,
        reason_code: reasonCode,
        expected_version: vacancy.version,
      }),
    },
    "CLOSE_REQUEST_FAILED",
  );

  if (!payload || payload.ok !== true || payload.status !== "closed") {
    throw new Error("INVALID_BACKEND_RESPONSE");
  }
  return payload;
}

const ERROR_MESSAGES = {
  BACKEND_NOT_CONFIGURED: "The approved backend URL and publishable key are not configured yet.",
  INVALID_BACKEND_URL: "The configured backend URL is invalid. Use the HTTPS URL for the approved Job Grid project.",
  INVALID_CLOSE_ENDPOINT: "The Close Job endpoint must use the same approved Supabase project URL.",
  AUTH_REQUIRED: "Please sign in through the approved Job Grid authentication service, then return to this page.",
  BACKEND_UNREACHABLE: "Job Grid could not reach the backend. Check the connection and try again.",
  INVALID_BACKEND_RESPONSE: "The backend returned an unexpected response. No success has been assumed.",
  MEMBERSHIP_LOAD_FAILED: "Your organization membership could not be loaded.",
  VACANCY_LOAD_FAILED: "Your organization vacancies could not be loaded.",
  ORGANIZATION_LOAD_FAILED: "Your organization details could not be loaded.",
  UNAUTHENTICATED: "Your session is not valid. Sign in again through Job Grid.",
  FORBIDDEN: "Your current organization role is not permitted to close this vacancy.",
  NOT_FOUND: "This vacancy is no longer available to your account.",
  INVALID_REASON: "Choose an approved reason for closing this vacancy.",
  INVALID_ARGUMENT: "The close request was rejected because its information was invalid.",
  INVALID_IDEMPOTENCY_KEY: "The request key is invalid. Close the confirmation and retry.",
  VERSION_CONFLICT: "This vacancy changed after you opened the page. Refresh before trying again.",
  ALREADY_CLOSED: "This vacancy is already closed.",
  INVALID_STATE: "This vacancy is no longer eligible for closure.",
  IDEMPOTENCY_CONFLICT: "The previous request used this request key with different information. Keep the same reason and retry.",
  VACANCY_NOT_CLOSABLE: "Only active published vacancies can be closed by owner, admin or recruiter members.",
  INVALID_VACANCY: "The vacancy identifier is not valid.",
  INTERNAL_ERROR: "The backend could not complete the request. The system has not reported success.",
};

export function friendlyEmployerError(error) {
  const code = error instanceof Error ? error.message : String(error ?? "");
  return ERROR_MESSAGES[code] ?? "Something went wrong. Please refresh and try again.";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not set"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function currentPortalElements() {
  return {
    state: document.querySelector(".portal-state"),
    stateTitle: document.querySelector("#connection-title"),
    stateMessage: document.querySelector("#connection-message"),
    notice: document.querySelector("#portal-notice"),
    noticeMessage: document.querySelector("#notice-message"),
    workspace: document.querySelector("#vacancy-workspace"),
    vacancyList: document.querySelector("#vacancy-list"),
    vacancyCount: document.querySelector("#vacancy-count"),
    refresh: document.querySelector("#refresh-vacancies"),
    dialog: document.querySelector("#close-vacancy-dialog"),
    dialogDescription: document.querySelector("#close-dialog-description"),
    dialogError: document.querySelector("#close-dialog-error"),
    closeForm: document.querySelector("#close-vacancy-form"),
    reason: document.querySelector("#closure-reason"),
    confirm: document.querySelector("#confirm-close"),
    cancel: document.querySelector("#cancel-close"),
  };
}

function setConnection(elements, state, title, message) {
  elements.state.dataset.state = state;
  elements.stateTitle.textContent = title;
  elements.stateMessage.textContent = message;
}

function showNotice(elements, message) {
  elements.notice.hidden = false;
  elements.noticeMessage.textContent = message;
  elements.workspace.hidden = true;
  elements.refresh.disabled = true;
}

function renderVacancies(elements, vacancies, onClose) {
  elements.vacancyList.replaceChildren();
  elements.vacancyCount.textContent = `${vacancies.length} ${vacancies.length === 1 ? "vacancy" : "vacancies"}`;

  if (vacancies.length === 0) {
    const empty = el("div", "empty-vacancies");
    empty.append(el("h3", "", "No vacancies to manage yet"));
    empty.append(el("p", "", "No vacancies were returned for your active organization memberships. No sample jobs are shown."));
    elements.vacancyList.append(empty);
    return;
  }

  for (const vacancy of vacancies) {
    const card = el("article", "employer-vacancy-card");
    const main = el("div", "employer-vacancy-main");
    const organizationName = vacancy.organization?.display_name || "Your organization";
    main.append(el("p", "employer-vacancy-org", organizationName));
    const status = el("span", "vacancy-status", String(vacancy.status ?? "unknown").replaceAll("_", " "));
    status.dataset.status = vacancy.status ?? "unknown";
    main.append(status);
    main.append(el("h3", "", vacancy.title || "Untitled vacancy"));
    const meta = el("div", "employer-vacancy-meta");
    meta.append(el("span", "", vacancy.reference_code ? `Reference: ${vacancy.reference_code}` : `Vacancy ${vacancy.id}`));
    meta.append(el("span", "", `Updated ${formatDate(vacancy.updated_at)}`));
    if (vacancy.status === "published") meta.append(el("span", "", `Expires ${formatDate(vacancy.expires_at)}`));
    main.append(meta);
    card.append(main);

    const actions = el("div", "vacancy-actions");
    if (canCloseVacancy(vacancy)) {
      const button = el("button", "button button-secondary button-small", "Close job");
      button.type = "button";
      button.addEventListener("click", () => onClose(vacancy));
      actions.append(button);
      actions.append(el("span", "vacancy-locked-note", "Requires confirmation"));
    } else {
      const reason = vacancy.status === "closed"
        ? "Already closed"
        : vacancy.status !== "published"
        ? "Not published"
        : vacancy.membershipRole === "viewer"
        ? "Read-only membership"
        : "Not eligible for closure";
      actions.append(el("span", "vacancy-locked-note", reason));
    }
    card.append(actions);
    elements.vacancyList.append(card);
  }
}

export async function initializeEmployerPortal({
  config = globalThis.window?.JOB_GRID_CONFIG,
  auth = globalThis.window?.jobGridAuth,
  fetchImpl = fetch,
  documentRef = globalThis.document,
  now = () => Date.now(),
} = {}) {
  if (!documentRef) return;
  const elements = currentPortalElements();
  const normalized = normalizeEmployerConfig(config);

  if (!normalized.configured) {
    setConnection(elements, "error", "Backend not connected", "The portal is safely disabled because no approved runtime configuration is present.");
    showNotice(elements, friendlyEmployerError(new Error(normalized.error)));
    return;
  }

  if (!auth || typeof auth.getSession !== "function") {
    setConnection(elements, "error", "Sign-in service not connected", "The backend settings exist, but the approved authentication provider has not supplied a session.");
    showNotice(elements, "Connect the approved identity provider. This page does not collect passwords or ask you to paste an access token.");
    return;
  }

  let session;
  try {
    session = await getFreshEmployerSession(auth);
  } catch {
    setConnection(elements, "error", "Sign-in required", "A verified Job Grid sign-in session is needed to view employer vacancies.");
    showNotice(elements, friendlyEmployerError(new Error("AUTH_REQUIRED")));
    return;
  }

  let currentVacancies = [];
  let selectedVacancy = null;
  let idempotencyKey = null;
  let busy = false;

  const load = async () => {
    elements.refresh.disabled = true;
    setConnection(elements, "loading", "Loading your vacancies", "Loading vacancies through your authenticated session and the backend's tenant policies.");
    try {
      // Refresh the adapter-owned session on each load so expired access tokens
      // are not reused indefinitely. The adapter remains responsible for refresh.
      session = await getFreshEmployerSession(auth, session);
      currentVacancies = await loadEmployerVacancies(config, session, fetchImpl);
      elements.notice.hidden = true;
      elements.workspace.hidden = false;
      elements.refresh.disabled = false;
      setConnection(elements, "ready", "Workspace connected", "Vacancies loaded. Close requests are re-authorized by the database.");
      renderVacancies(elements, currentVacancies, (vacancy) => {
        selectedVacancy = vacancy;
        idempotencyKey = `close-${crypto.randomUUID()}`;
        elements.dialogError.hidden = true;
        elements.dialogError.textContent = "";
        elements.dialogDescription.textContent = `${vacancy.title} (reference ${vacancy.reference_code || vacancy.id}) will be closed for ${vacancy.organization?.display_name || "your organization"}.`;
        elements.reason.value = "filled";
        elements.dialog.showModal();
      });
    } catch (error) {
      setConnection(elements, "error", "Could not load vacancies", friendlyEmployerError(error));
      showNotice(elements, friendlyEmployerError(error));
    } finally {
      elements.refresh.disabled = false;
    }
  };

  elements.refresh.addEventListener("click", () => void load());
  elements.cancel.addEventListener("click", () => {
    if (busy) return;
    elements.dialog.close("cancel");
    selectedVacancy = null;
    idempotencyKey = null;
  });

  elements.dialog.addEventListener("cancel", (event) => {
    // Escape must not close the modal while the server may be committing the
    // operation; otherwise a successful request could look like a failed one.
    if (busy) {
      event.preventDefault();
      return;
    }
    selectedVacancy = null;
    idempotencyKey = null;
  });

  elements.closeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !selectedVacancy || !idempotencyKey) return;
    if (!canCloseVacancy(selectedVacancy, now())) {
      elements.dialogError.hidden = false;
      elements.dialogError.textContent = friendlyEmployerError(new Error("VACANCY_NOT_CLOSABLE"));
      return;
    }

    busy = true;
    elements.confirm.disabled = true;
    elements.cancel.disabled = true;
    elements.reason.disabled = true;
    elements.confirm.textContent = "Closing…";
    elements.dialogError.hidden = true;
    try {
      session = await getFreshEmployerSession(auth, session);
      await closeVacancy(config, session, selectedVacancy, elements.reason.value, idempotencyKey, fetchImpl);
      elements.dialog.close("success");
      selectedVacancy = null;
      idempotencyKey = null;
      setConnection(elements, "ready", "Vacancy closed", "The backend confirmed the closure. The list is being refreshed.");
      await load();
    } catch (error) {
      elements.dialogError.hidden = false;
      elements.dialogError.textContent = friendlyEmployerError(error);
    } finally {
      busy = false;
      elements.confirm.disabled = false;
      elements.cancel.disabled = false;
      elements.reason.disabled = false;
      elements.confirm.textContent = "Confirm close";
    }
  });

  await load();
}

if (typeof document !== "undefined" && document.querySelector("#vacancy-workspace")) {
  void initializeEmployerPortal();
}
