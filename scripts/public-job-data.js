/** Public-data adapter for the proposed /api/v1/jobs contract.
 *
 * These helpers never create sample vacancies. The trusted API must enforce
 * moderation state, tenant/privacy boundaries and publication status; browser
 * checks below are only a conservative stale-response guard.
 */
export const PUBLIC_JOBS_ENDPOINT = "/api/v1/jobs";
export const PUBLIC_JOB_PAGE_SIZE = 25;

const FORBIDDEN_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function cleanPublicText(value, maxLength = 240) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (FORBIDDEN_CONTROL_CHARACTERS.test(normalized)) return "";
  return normalized.slice(0, maxLength);
}

export function isPubliclyVisibleJob(job, asOf = Date.now()) {
  if (!job || typeof job !== "object" || Array.isArray(job)) return false;
  // Some public API responses intentionally omit internal status fields.
  // When a status is present, fail closed unless it is exactly published.
  if (job.status !== undefined && job.status !== "published") return false;

  const publishedAt = Date.parse(job.publishedAt);
  const expiresAt = Date.parse(job.expiresAt);
  if (!Number.isFinite(publishedAt) || !Number.isFinite(expiresAt)) return false;
  if (!Number.isFinite(asOf) || publishedAt > asOf || expiresAt <= asOf) return false;
  if (expiresAt <= publishedAt) return false;
  return true;
}

function normalizeSalary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { min: null, max: null, currency: "", payPeriod: "" };
  }

  const currency = cleanPublicText(value.currency, 3).toUpperCase();
  const min = value.min === null || value.min === undefined ? null : value.min;
  const max = value.max === null || value.max === undefined ? null : value.max;
  const validCurrency = /^[A-Z]{3}$/.test(currency);
  const validAmount = (amount) => amount === null || (typeof amount === "number" && Number.isFinite(amount) && amount >= 0);
  const hasAmount = min !== null || max !== null;

  if (!validCurrency || !hasAmount || !validAmount(min) || !validAmount(max) || (min !== null && max !== null && max < min)) {
    return { min: null, max: null, currency: "", payPeriod: "" };
  }

  return {
    min,
    max,
    currency,
    payPeriod: cleanPublicText(value.payPeriod, 24).toLowerCase()
  };
}

export function normalizePublicJob(raw, asOf = Date.now(), includeDetails = false) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !isPubliclyVisibleJob(raw, asOf)) return null;

  const id = cleanPublicText(raw.id, 160);
  const slug = cleanPublicText(raw.slug, 200);
  const title = cleanPublicText(raw.title, 200);
  const organizationName = cleanPublicText(raw.organization?.displayName, 180);
  if (!id || !slug || !title || !organizationName) return null;

  const location = raw.location && typeof raw.location === "object" && !Array.isArray(raw.location)
    ? raw.location
    : {};
  const occupation = raw.occupation && typeof raw.occupation === "object" && !Array.isArray(raw.occupation)
    ? raw.occupation
    : {};

  const result = {
    id,
    reference: cleanPublicText(raw.reference, 80),
    slug,
    title,
    organization: {
      displayName: organizationName,
      verified: cleanPublicText(raw.organization?.verificationStatus, 32).toLowerCase() === "verified"
    },
    location: {
      countryCode: /^[A-Z]{2}$/.test(cleanPublicText(location.countryCode, 2).toUpperCase())
        ? cleanPublicText(location.countryCode, 2).toUpperCase()
        : "",
      region: cleanPublicText(location.region, 120),
      city: cleanPublicText(location.city, 120),
      town: cleanPublicText(location.town, 120)
    },
    occupation: {
      label: cleanPublicText(occupation.label, 160)
    },
    employmentType: cleanPublicText(raw.employmentType, 40).toLowerCase(),
    salary: normalizeSalary(raw.salary),
    sponsorshipStatus: cleanPublicText(raw.sponsorshipStatus, 40).toLowerCase() || "not_stated",
    publishedAt: raw.publishedAt,
    expiresAt: raw.expiresAt
  };

  if (includeDetails) {
    result.description = cleanPublicText(raw.description, 16000);
    result.applicationInstructions = cleanPublicText(raw.applicationInstructions, 5000);
  }

  // Deliberately do not propagate arbitrary source properties (moderation notes,
  // reviewer identity, audit metadata, private document URLs, or candidate data).
  return result;
}

export function normalizePublicJobsResponse(payload, asOf = Date.now()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.data)) {
    throw new TypeError("The public jobs API returned an unexpected response.");
  }
  return payload.data
    .map((job) => normalizePublicJob(job, asOf, false))
    .filter(Boolean)
    .slice(0, PUBLIC_JOB_PAGE_SIZE);
}

export function validateJobSearchFilters(filters = {}) {
  const q = cleanPublicText(filters.q, 161);
  const country = cleanPublicText(filters.country, 3).toUpperCase();
  const city = cleanPublicText(filters.city, 101);

  if (q.length > 160) return { valid: false, error: "Keep the keyword search to 160 characters or fewer." };
  if (country && !/^[A-Z]{2}$/.test(country)) return { valid: false, error: "Enter a two-letter country code, such as KE, or leave this field blank." };
  if (city.length > 100) return { valid: false, error: "Keep the city or town to 100 characters or fewer." };

  return { valid: true, filters: { q, country, city } };
}

export function buildPublicJobsUrl(filters = {}, endpoint = PUBLIC_JOBS_ENDPOINT) {
  if (typeof endpoint !== "string" || !endpoint.startsWith("/") || endpoint.startsWith("//") || endpoint.includes("#")) {
    throw new TypeError("The public jobs endpoint must be a same-origin path.");
  }

  const checked = validateJobSearchFilters(filters);
  if (!checked.valid) throw new TypeError(checked.error);

  const params = new URLSearchParams();
  if (checked.filters.q) params.set("q", checked.filters.q);
  if (checked.filters.country) params.set("country", checked.filters.country);
  if (checked.filters.city) params.set("city", checked.filters.city);
  params.set("limit", String(PUBLIC_JOB_PAGE_SIZE));
  return endpoint + "?" + params.toString();
}

export function formatPublicSalary(salary) {
  if (!salary || typeof salary !== "object" || !/^[A-Z]{3}$/.test(salary.currency || "")) {
    return "Salary not stated";
  }
  const valid = (amount) => amount === null || (typeof amount === "number" && Number.isFinite(amount) && amount >= 0);
  if ((!Number.isFinite(salary.min) && !Number.isFinite(salary.max)) ||
      !valid(salary.min) || !valid(salary.max) ||
      (salary.min !== null && salary.max !== null && salary.max < salary.min)) {
    return "Salary not stated";
  }

  const format = (amount) => new Intl.NumberFormat("en", {
    style: "currency",
    currency: salary.currency,
    maximumFractionDigits: 0
  }).format(amount);

  try {
    let label;
    if (salary.min !== null && salary.max !== null) {
      label = format(salary.min) + "–" + format(salary.max);
    } else if (salary.min !== null) {
      label = "From " + format(salary.min);
    } else {
      label = "Up to " + format(salary.max);
    }
    const period = cleanPublicText(salary.payPeriod, 24).toLowerCase();
    return period ? label + " per " + period : label;
  } catch {
    return "Salary not stated";
  }
}

export function formatPublicLocation(location) {
  if (!location || typeof location !== "object") return "Location not stated";
  const countryCode = cleanPublicText(location.countryCode, 2).toUpperCase();
  const parts = [location.city, location.town, location.region, countryCode]
    .map((value) => cleanPublicText(value, 120))
    .filter(Boolean);
  const unique = parts.filter((value, index) => parts.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index);
  return unique.length ? unique.join(", ") : "Location not stated";
}

export function formatEmploymentType(value) {
  const key = cleanPublicText(value, 40).toLowerCase();
  const labels = {
    full_time: "Full-time",
    part_time: "Part-time",
    contract: "Contract",
    temporary: "Temporary",
    internship: "Internship",
    casual: "Casual",
    seasonal: "Seasonal",
    apprenticeship: "Apprenticeship"
  };
  return labels[key] || (key ? key.replace(/[_-]+/g, " ") : "Employment type not stated");
}
