import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = "https://jobs-grid.co.ke";
const cataloguePath = path.join(root, "public", "data", "job-types.json");
const outputRoot = path.join(root, "dist");
const categoryNames = new Map([
  ["agriculture-farming", "Agriculture & Farming"],
  ["construction-building", "Construction & Building"],
  ["skilled-trades-repair", "Skilled Trades & Repair"],
  ["driving-transport", "Driving & Transport"],
  ["warehouse-logistics", "Warehouse & Logistics"],
  ["cleaning-housekeeping", "Cleaning & Housekeeping"],
  ["security-safety", "Security & Safety"],
  ["hospitality-tourism", "Hospitality & Tourism"],
  ["food-service-catering", "Food Service & Catering"],
  ["retail-sales", "Retail & Sales"],
  ["customer-service", "Customer Service"],
  ["general-labour", "General Labour"],
  ["manufacturing-factory", "Manufacturing & Factory"],
  ["domestic-household-work", "Domestic & Household Work"],
  ["health-care-caregiving", "Healthcare & Caregiving"],
  ["education-training", "Education & Training"],
  ["office-administration", "Office & Administration"],
  ["it-technology", "IT & Technology"],
  ["finance-accounting", "Finance & Accounting"],
  ["engineering", "Engineering"],
  ["beauty-personal-care", "Beauty & Personal Care"],
  ["maintenance-facilities", "Maintenance & Facilities"],
  ["marketing-communications", "Marketing & Communications"],
  ["professional-services", "Professional Services"],
  ["other", "Other"]
]);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const data = JSON.parse(await readFile(cataloguePath, "utf8"));
if (!Array.isArray(data.roles)) throw new Error("job-types.json must contain a roles array.");

const seen = new Set();
const roles = [];
for (const row of data.roles) {
  if (!Array.isArray(row) || (row.length !== 2 && row.length !== 3)) {
    throw new Error("Invalid job type row: expected [title, categorySlug] or [title, categorySlug, canonicalSlug].");
  }
  const title = typeof row[0] === "string" ? row[0].trim() : "";
  const categorySlug = typeof row[1] === "string" ? row[1].trim() : "";
  if (!title || !categoryNames.has(categorySlug)) throw new Error(`Invalid occupation title or category: ${JSON.stringify(row)}`);
  const slug = typeof row[2] === "string" && row[2].trim() ? row[2].trim() : slugify(title);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`Invalid canonical URL slug "${slug}" for: ${title}`);
  if (seen.has(slug)) throw new Error(`Duplicate occupation URL slug "${slug}". Resolve the title/slug collision before publishing.`);
  seen.add(slug);
  roles.push({ title, categorySlug, categoryName: categoryNames.get(categorySlug), slug });
}
if (roles.length === 0) throw new Error("Refusing to generate an empty occupation catalogue.");

const today = new Date().toISOString().slice(0, 10);
const corePaths = [
  "/",
  "/job-types/",
  "/vacancies.html",
  "/countries.html",
  "/for-employers.html"
];
const urls = [
  ...corePaths.map((route) => ({ loc: `${siteRoot}${route}`, lastmod: today })),
  ...roles.map((role) => ({
    loc: `${siteRoot}/job-types/${role.slug}/`,
    lastmod: today
  }))
];

// Generate a real directory landing page as well as individual occupation pages.
const directoryPath = path.join(outputRoot, "job-types", "index.html");
await mkdir(path.dirname(directoryPath), { recursive: true });
const groupedRoles = new Map([...categoryNames.keys()].map((slug) => [slug, []]));
for (const role of roles) groupedRoles.get(role.categorySlug).push(role);
const directoryTitle = "Browse Job Types and Occupations | Job Grid";
const directoryDescription = "Browse Job Grid's occupation catalogue by category and search for matching vacancies.";
const directoryCanonical = `${siteRoot}/job-types/`;
const directorySchema = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: directoryTitle,
  description: directoryDescription,
  url: directoryCanonical,
  isPartOf: { "@type": "WebSite", name: "Job Grid", url: siteRoot }
};
const directorySections = [...groupedRoles.entries()]
  .filter(([, items]) => items.length > 0)
  .map(([slug, items]) => `<section class="occupation-category" data-category="${escapeHtml(slug)}"><div class="occupation-category-heading"><h2>${escapeHtml(categoryNames.get(slug))}</h2><span>${items.length} occupations</span></div><ul class="occupation-grid">${items
    .map((role) => `<li class="occupation-card" data-occupation-title="${escapeHtml(role.title.toLowerCase())}"><a href="/job-types/${role.slug}/"><span class="occupation-card-icon" aria-hidden="true">${escapeHtml(role.title.trim().charAt(0).toUpperCase())}</span><span class="occupation-card-copy"><strong>${escapeHtml(role.title)}</strong><small>Explore role and matching opportunities</small></span><span class="occupation-card-arrow" aria-hidden="true">↗</span></a></li>`)
    .join("")}</ul></section>`)
  .join("\n");
const directoryHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <title>${escapeHtml(directoryTitle)}</title>
  <meta name="description" content="${escapeHtml(directoryDescription)}">
  <link rel="canonical" href="${directoryCanonical}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(directoryTitle)}">
  <meta property="og:description" content="${escapeHtml(directoryDescription)}">
  <meta property="og:url" content="${directoryCanonical}">
  <link rel="stylesheet" href="/styles/tokens.css">
  <link rel="stylesheet" href="/styles/global.css">

  <style>
    .occupation-directory{--occupation-border:#e4eaf4;max-width:1240px;margin:0 auto;padding:3.5rem 1.5rem 5rem}
    .occupation-hero{max-width:820px;margin:0 auto 3.5rem;text-align:center}
    .occupation-hero .eyebrow{color:var(--color-primary);font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-size:.78rem;margin-bottom:.8rem}
    .occupation-hero h1{max-width:800px;margin:0 auto 1rem;font-size:clamp(2.4rem,5vw,4.2rem);line-height:1.08}
    .occupation-hero>p:not(.eyebrow){max-width:680px;margin:0 auto 1.5rem;font-size:1.08rem}
    .occupation-search-label{display:block;text-align:left;max-width:680px;margin:1.5rem auto .5rem;font-weight:700;color:var(--color-secondary)}
    .occupation-search-wrap{display:flex;align-items:center;gap:.75rem;max-width:680px;margin:0 auto;padding:.45rem .65rem .45rem 1rem;border:1px solid #d7dfed;border-radius:16px;background:#fff;box-shadow:0 10px 30px rgba(18,40,91,.08)}
    .occupation-search-wrap>span{font-size:1.6rem;color:var(--color-primary)}
    .occupation-search-wrap input{flex:1;min-width:0;border:0;outline:none;padding:.8rem 0;background:transparent;color:var(--color-text)}
    .occupation-search-wrap input:focus-visible{outline:0}
    .occupation-search-wrap button{border:0;border-radius:10px;padding:.55rem .8rem;background:#edf3ff;color:var(--color-secondary);font-weight:700;cursor:pointer}
    .occupation-search-status{font-size:.9rem;margin:.65rem auto 0!important}
    .occupation-pagination{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.5rem;margin:1.75rem auto 0;padding:1rem;border:1px solid #e4eaf4;border-radius:14px;background:#fff}
    .occupation-pagination button{min-width:2.6rem;border:1px solid #d7dfed;border-radius:9px;padding:.6rem .8rem;background:#fff;color:var(--color-secondary);font-weight:700;cursor:pointer}
    .occupation-pagination button[aria-current="page"]{background:var(--color-primary);border-color:var(--color-primary);color:#fff}
    .occupation-pagination button:disabled{opacity:.4;cursor:not-allowed}
    .occupation-pagination-summary{width:100%;text-align:center;color:#5b6b89;font-size:.88rem}
    .occupation-directory-intro{display:flex;align-items:end;justify-content:space-between;gap:1rem;margin-bottom:1.25rem}
    .occupation-directory-intro h2{font-size:1.7rem;margin:0}
    .occupation-directory-intro p{max-width:560px;margin:0;font-size:.92rem}
    .occupation-categories{display:grid;grid-template-columns:minmax(0,1fr);gap:1.25rem;align-items:start}
    .occupation-category{min-width:0;padding:1.4rem;border:1px solid var(--occupation-border);border-radius:18px;background:#fff;box-shadow:0 6px 22px rgba(18,40,91,.035)}
    .occupation-category[hidden],.occupation-grid li[hidden]{display:none!important}
    .occupation-category-heading{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding-bottom:.9rem;border-bottom:1px solid #edf0f6;margin-bottom:.85rem}
    .occupation-category-heading h2{font-size:1.22rem;letter-spacing:-.025em;margin:0}
    .occupation-category-heading>span{flex-shrink:0;font-size:.75rem;font-weight:700;color:#5b6b89;background:#f1f5fb;border-radius:999px;padding:.3rem .55rem}
    .occupation-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.85rem}
    .occupation-grid li{min-width:0}
    .occupation-grid a{display:flex;align-items:center;gap:.75rem;min-height:94px;height:100%;padding:.85rem;border:1px solid #e4eaf4;border-radius:13px;background:linear-gradient(145deg,#fff,#f8faff);color:var(--color-text);font-size:.9rem;line-height:1.35;overflow-wrap:anywhere;box-shadow:0 4px 14px rgba(18,40,91,.035);transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease}
    .occupation-card-icon{display:grid;place-items:center;flex:0 0 42px;width:42px;height:42px;border-radius:12px;background:linear-gradient(145deg,#0755f5,#163779);color:#fff;font-size:1rem;font-weight:800;box-shadow:0 5px 12px rgba(7,85,245,.18)}
    .occupation-card-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:.3rem}
    .occupation-card-copy strong{font-size:.9rem;font-weight:750;line-height:1.35}
    .occupation-card-copy small{color:#6b7892;font-size:.73rem;line-height:1.35}
    .occupation-card-arrow{flex-shrink:0;color:var(--color-primary);font-size:.9rem;opacity:.75}
    .occupation-grid a:hover{border-color:#9dbbff;background:#f3f7ff;color:var(--color-primary);box-shadow:0 9px 22px rgba(18,40,91,.09);transform:translateY(-2px)}
    .occupation-grid a:focus-visible{outline:3px solid #9dbbff;outline-offset:2px}
    @media(max-width:1000px){.occupation-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.occupation-directory-intro{display:block}.occupation-directory-intro p{margin-top:.45rem}}
    @media(max-width:600px){.occupation-directory{padding:2rem 1rem 3rem}.occupation-hero{margin-bottom:2.5rem}.occupation-grid{grid-template-columns:1fr}.occupation-category{padding:1rem}.occupation-category-heading h2{font-size:1.08rem}.occupation-grid a{min-height:78px}}
  </style>
  <script type="module" src="/scripts/components.js"></script>
  <script type="module" src="/scripts/main.js"></script>
  <script type="application/ld+json">${JSON.stringify(directorySchema).replace(/</g, "\\u003c")}</script>
</head>
<body>
  <job-grid-header></job-grid-header>
  <main class="occupation-directory section-wrap">
    <section class="occupation-hero">
      <p class="eyebrow">Explore your next move</p>
      <h1>Find your place in the world of work</h1>
      <p>Explore 9,044 occupations across industries. Search by job title or browse a category to discover career paths and matching vacancies.</p>
      <label class="occupation-search-label" for="occupation-search">Search occupations</label>
      <div class="occupation-search-wrap">
        <span aria-hidden="true">⌕</span>
        <input id="occupation-search" type="search" placeholder="Try “driver”, “nurse” or “accountant”" autocomplete="off">
        <button id="occupation-search-clear" type="button" hidden>Clear</button>
      </div>
      <p class="occupation-search-status" id="occupation-search-status" aria-live="polite">Showing all 9,044 occupations</p>
    </section>
    <div class="occupation-directory-intro"><h2>Explore by category</h2><p>Choose an occupation to view its page and search for matching vacancies. A listed occupation is not a guarantee of a current opening.</p></div>
    <div class="occupation-categories">${directorySections}</div>
    <nav class="occupation-pagination" id="occupation-pagination" aria-label="Occupation directory pages"></nav>
  </main>
  <script>
    (() => {
      const input = document.getElementById("occupation-search");
      const clear = document.getElementById("occupation-search-clear");
      const status = document.getElementById("occupation-search-status");
      const items = [...document.querySelectorAll("[data-occupation-title]")];
      const sections = [...document.querySelectorAll(".occupation-category")];
      const pageSize = 30;
      const pagination = document.getElementById("occupation-pagination");
      let currentPage = 1;
      const update = () => {
        const query = input.value.trim().toLocaleLowerCase();
        const matches = items.filter((item) => !query || item.dataset.occupationTitle.includes(query));
        const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
        currentPage = Math.min(currentPage, pageCount);
        const start = (currentPage - 1) * pageSize;
        const visibleItems = new Set(matches.slice(start, start + pageSize));
        for (const item of items) item.hidden = !visibleItems.has(item);
        for (const section of sections) {
          section.hidden = !section.querySelector("[data-occupation-title]:not([hidden])");
        }
        clear.hidden = !query;
        status.textContent = query
          ? "Showing " + matches.length.toLocaleString() + " matching occupations · page " + currentPage + " of " + pageCount
          : "Showing " + items.length.toLocaleString() + " occupations · page " + currentPage + " of " + pageCount;
        pagination.replaceChildren();
        const summary = document.createElement("span");
        summary.className = "occupation-pagination-summary";
        summary.textContent = matches.length
          ? "Showing " + (start + 1).toLocaleString() + "–" + Math.min(start + pageSize, matches.length).toLocaleString() + " of " + matches.length.toLocaleString() + " occupations"
          : "No occupations match your search.";
        pagination.append(summary);
        if (pageCount > 1) {
          const addButton = (label, page, options = {}) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            if (options.current) button.setAttribute("aria-current", "page");
            button.disabled = Boolean(options.disabled);
            button.addEventListener("click", () => {
              currentPage = page;
              update();
              pagination.scrollIntoView({ behavior: "smooth", block: "nearest" });
            });
            pagination.append(button);
          };
          addButton("Previous", Math.max(1, currentPage - 1), { disabled: currentPage === 1 });
          const first = Math.max(1, Math.min(currentPage - 2, pageCount - 4));
          const last = Math.min(pageCount, first + 4);
          for (let page = first; page <= last; page++) addButton(String(page), page, { current: page === currentPage });
          addButton("Next", Math.min(pageCount, currentPage + 1), { disabled: currentPage === pageCount });
        }
      };
      input.addEventListener("input", () => { currentPage = 1; update(); });
      clear.addEventListener("click", () => { input.value = ""; currentPage = 1; update(); input.focus(); });
      update();
    })();
  </script>
  <job-grid-footer></job-grid-footer>
</body>
</html>`;
await writeFile(directoryPath, directoryHtml, "utf8");

function occupationCopy(role) {
  const title = role.title;
  const normalized = title.toLowerCase();
  const work = normalized.includes("manager") || normalized.includes("director") || normalized.includes("supervisor")
    ? "coordinating work, planning resources, supporting colleagues, monitoring progress, and helping a team meet its objectives"
    : normalized.includes("technician") || normalized.includes("mechanic") || normalized.includes("engineer") || normalized.includes("repair") || normalized.includes("installer")
      ? "checking, installing, operating, maintaining, troubleshooting, or repairing relevant equipment and systems"
      : normalized.includes("assistant") || normalized.includes("clerk") || normalized.includes("administrator") || normalized.includes("coordinator")
        ? "organising information, maintaining records, supporting daily operations, and helping colleagues or customers"
        : normalized.includes("officer") || normalized.includes("specialist") || normalized.includes("analyst") || normalized.includes("consultant")
          ? "applying role-specific knowledge, reviewing information, solving problems, and supporting reliable decisions or services"
          : normalized.includes("driver") || normalized.includes("operator") || normalized.includes("pilot")
            ? "operating vehicles or equipment safely, following procedures, checking conditions, and keeping accurate records"
            : normalized.includes("teacher") || normalized.includes("trainer") || normalized.includes("instructor") || normalized.includes("tutor")
              ? "preparing learning activities, explaining skills, supporting learners, and reviewing progress"
              : normalized.includes("nurse") || normalized.includes("care") || normalized.includes("therapist") || normalized.includes("medical")
                ? "supporting health, care, wellbeing, or treatment needs within the role's scope and applicable standards"
                : normalized.includes("sales") || normalized.includes("marketing") || normalized.includes("account")
                  ? "understanding customer needs, communicating options, maintaining relationships, and supporting service goals"
                  : "carrying out the practical and specialist tasks associated with the occupation, following workplace procedures and quality standards";
  const categoryFocus = {
    "Agriculture & Farming": "work may take place on farms, in agricultural businesses, supply chains, laboratories, or rural projects",
    "Construction & Building": "work may involve building sites, materials, inspections, maintenance, or project coordination",
    "Skilled Trades & Repair": "work often relies on practical technical skills, safe tool use, fault-finding, and quality checks",
    "Driving & Transport": "safe movement of people or goods, route awareness, checks, and punctuality may be important",
    "Warehouse & Logistics": "work may involve stock control, receiving and dispatch, order fulfilment, inventory, or transport coordination",
    "Cleaning & Housekeeping": "work focuses on hygiene, orderly spaces, safe product handling, and consistent service standards",
    "Security & Safety": "work may involve risk awareness, incident reporting, access procedures, and safety protocols",
    "Hospitality & Tourism": "work may involve guest service, bookings, travel support, accommodation, or visitor experiences",
    "Food Service & Catering": "work may involve food preparation or service, cleanliness, safe food handling, and teamwork",
    "Retail & Sales": "work may involve customer assistance, product knowledge, transactions, merchandising, or sales",
    "Customer Service": "work centres on communication, responding to enquiries, resolving issues, and customer records",
    "General Labour": "hands-on tasks, reliability, teamwork, instructions, and safe working practices may be central",
    "Manufacturing & Factory": "work may involve production processes, equipment, product checks, packaging, and safety standards",
    "Domestic & Household Work": "work supports household routines, personal service, cleanliness, organisation, or care",
    "Healthcare & Caregiving": "work requires respectful service, confidentiality, safety, and appropriate professional boundaries",
    "Education & Training": "work may involve teaching, learning support, training, assessment, or education administration",
    "Office & Administration": "work may involve scheduling, documentation, communication, data entry, and organised records",
    "IT & Technology": "work may involve digital systems, software, data, technical support, testing, security, or technology operations",
    "Finance & Accounting": "work may involve financial records, reporting, reconciliations, controls, budgets, or analysis",
    "Engineering": "work may involve technical design, analysis, testing, maintenance, project delivery, or standards",
    "Beauty & Personal Care": "work may involve client consultation, personal services, hygiene, safe product use, and customer care",
    "Maintenance & Facilities": "work may involve inspections, fault response, planned maintenance, and service continuity",
    "Marketing & Communications": "work may involve audience research, content, campaigns, brand communication, and engagement",
    "Professional Services": "work may involve specialist advice, analysis, client delivery, documentation, or compliance",
    "Other": "duties depend on the employer, sector, and exact position"
  }[role.categoryName] || "duties depend on the employer, sector, and exact position";
  return {
    overview: title + " work generally involves " + work + ". The exact scope depends on the employer, industry, seniority, and workplace, so read each vacancy's own description to understand the responsibilities of that specific position.",
    dayToDay: "Depending on the position, common work may include " + work + ". In " + role.categoryName.toLowerCase() + ", " + categoryFocus + ". Employers should explain actual tasks, reporting arrangements, location, and working conditions in each vacancy.",
    skills: "Useful transferable strengths may include clear communication, reliability, teamwork, problem-solving, attention to detail, and safe working habits. Role-specific technical skills, licences, certificates, education, and experience vary by employer and country. Check the requirements stated in each vacancy rather than assuming one universal qualification.",
    meta: "Learn what " + title + " work can involve, explore relevant skills and career considerations, and search Job Grid for matching vacancies in " + role.categoryName + ". Actual requirements depend on each employer."
  };
}

for (const role of roles) {
  const dir = path.join(outputRoot, "job-types", role.slug);
  await mkdir(dir, { recursive: true });
  const title = `${role.title} Jobs and Career Opportunities | Job Grid`;
  const copy = occupationCopy(role);
  const description = copy.meta;
  const canonical = `${siteRoot}/job-types/${role.slug}/`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url: canonical,
    about: { "@type": "Occupation", name: role.title, occupationalCategory: role.categoryName },
    isPartOf: { "@type": "WebSite", name: "Job Grid", url: siteRoot }
  };
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <link rel="stylesheet" href="/styles/tokens.css">
  <link rel="stylesheet" href="/styles/global.css">
  <style>
    .occupation-detail{width:min(calc(100% - 3rem),1040px);margin:0 auto;padding:2rem 0 4.5rem}
    .occupation-breadcrumb{margin:0 0 1.25rem;color:#53617d;font-size:.9rem}
    .occupation-breadcrumb a{color:#064fe8;font-weight:700;text-decoration:none}
    .occupation-breadcrumb a:hover{text-decoration:underline}
    .occupation-hero-card{display:grid;grid-template-columns:minmax(0,1fr) 112px;align-items:center;gap:2rem;padding:clamp(1.5rem,4vw,3rem);border:1px solid #dce5f5;border-radius:24px;background:linear-gradient(135deg,#f5f8ff 0%,#fff 72%);box-shadow:0 12px 36px rgba(16,38,92,.07)}
    .occupation-kicker{display:inline-flex;margin-bottom:.9rem;padding:.4rem .7rem;border:1px solid #d6e2ff;border-radius:999px;background:#eaf1ff;color:#1645b8;font-size:.75rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
    .occupation-hero-card h1{max-width:760px;margin:0 0 1rem;color:#10265c;font-size:clamp(2.3rem,5.5vw,4.2rem);line-height:1.08;overflow-wrap:anywhere}
    .occupation-lead{max-width:760px;margin:0 0 1.5rem;color:#465574;font-size:1.05rem;line-height:1.8}
    .occupation-actions{display:flex;flex-wrap:wrap;gap:.75rem}
    .occupation-button{display:inline-flex;min-height:48px;align-items:center;justify-content:center;gap:.5rem;padding:.8rem 1.1rem;border:1px solid #004ef5;border-radius:12px;background:#004ef5;color:#fff;font-size:.9rem;font-weight:800;text-decoration:none;box-shadow:0 6px 16px rgba(0,78,245,.16);transition:transform .16s ease,background .16s ease}
    .occupation-button:hover{transform:translateY(-2px);background:#003bc7}
    .occupation-button-secondary{border-color:#cbd7ee;background:#fff;color:#10265c;box-shadow:none}
    .occupation-button-secondary:hover{border-color:#9eb5e8;background:#f5f8ff;color:#10265c}
    .occupation-hero-mark{display:grid;place-items:center;width:104px;height:104px;border-radius:26px;background:linear-gradient(145deg,#0755f5,#163779);color:#fff;font-size:3rem;font-weight:800;box-shadow:0 12px 28px rgba(7,85,245,.22)}
    .occupation-detail-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(280px,.75fr);gap:1.25rem;margin-top:1.5rem}
    .occupation-info-card,.occupation-side-card{min-width:0;padding:clamp(1.25rem,3vw,2rem);border:1px solid #e0e7f5;border-radius:20px;background:#fff;box-shadow:0 6px 22px rgba(16,38,92,.045)}
    .occupation-info-card h2,.occupation-side-card h2{margin:0 0 .9rem;color:#10265c;font-size:clamp(1.35rem,2.8vw,1.9rem);line-height:1.25}
    .occupation-info-card p,.occupation-side-card p{margin:0;color:#4b5a76;line-height:1.8}
    .occupation-side-card ul{display:grid;gap:.65rem;margin:1rem 0 0;padding-left:1.2rem;color:#34435f;line-height:1.65}
    .occupation-trust-note{margin:1.25rem 0 0;padding:1rem 1.2rem;border:1px solid #cfe0ff;border-left:4px solid #0755f5;border-radius:12px;background:#f2f7ff;color:#34435f;line-height:1.75}
    .occupation-trust-note strong{color:#10265c}
    .occupation-related-links{display:flex;flex-wrap:wrap;gap:.75rem 1.25rem;margin-top:1.25rem}
    .occupation-related-links a{color:#064fe8;font-weight:800;text-decoration:underline;text-underline-offset:3px}
    .occupation-detail a:focus-visible{outline:3px solid #e59b25;outline-offset:3px}
    @media(max-width:700px){.occupation-detail{width:min(calc(100% - 2rem),1040px);padding-top:1.25rem}.occupation-hero-card{grid-template-columns:minmax(0,1fr);gap:1.25rem}.occupation-hero-mark{grid-row:1;width:64px;height:64px;border-radius:18px;font-size:1.8rem}.occupation-detail-grid{grid-template-columns:1fr}.occupation-actions{align-items:stretch;flex-direction:column}.occupation-button{width:100%}}
    @media(prefers-reduced-motion:reduce){.occupation-button{transition:none}}
  </style>
  <script type="module" src="/scripts/components.js"></script>
  <script type="module" src="/scripts/main.js"></script>
  <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>
</head>
<body>
  <job-grid-header></job-grid-header>
  <main class="occupation-detail">
    <p class="occupation-breadcrumb"><a href="/job-types/">Occupation directory</a> / ${escapeHtml(role.categoryName)}</p>
    <section class="occupation-hero-card">
      <div>
        <span class="occupation-kicker">Job Grid occupation guide</span>
        <h1>${escapeHtml(role.title)}</h1>
        <p class="occupation-lead">${escapeHtml(copy.overview)}</p>
        <div class="occupation-actions">
          <a class="occupation-button" href="/vacancies.html?q=${encodeURIComponent(role.title)}&category=${encodeURIComponent(role.categorySlug)}">Search matching vacancies ↗</a>
          <a class="occupation-button occupation-button-secondary" href="/job-types/">Browse occupations</a>
        </div>
      </div>
      <div class="occupation-hero-mark" aria-hidden="true">${escapeHtml(role.title.trim().charAt(0).toUpperCase())}</div>
    </section>
    <section class="occupation-detail-grid" aria-label="Occupation information">
      <article class="occupation-info-card">
        <h2>What does this role involve?</h2>
        <p>${escapeHtml(copy.dayToDay)}</p>
      </article>
      <aside class="occupation-side-card">
        <h2>Skills and requirements</h2>
        <p>${escapeHtml(copy.skills)}</p>
        <ul>
          <li>Read the employer's listed requirements carefully.</li>
          <li>Confirm location, schedule, pay, and contract details in the vacancy.</li>
          <li>Use a trusted application process to share documents.</li>
        </ul>
      </aside>
    </section>
    <p class="occupation-trust-note"><strong>Important:</strong> This page describes an occupation, not a confirmed job opening. Job Grid displays actual vacancies separately, and our team checks applications before a candidate can proceed to the next stage. Never assume a role is available until its vacancy details confirm it.</p>
    <nav class="occupation-related-links" aria-label="Related links">
      <a href="/vacancies.html?q=${encodeURIComponent(role.title)}&category=${encodeURIComponent(role.categorySlug)}">Find ${escapeHtml(role.title)} vacancies</a>
      <a href="/job-types/">Browse all job types</a>
    </nav>
  </main>
  <job-grid-footer></job-grid-footer>
</body>
</html>`;
  const canonicalTags = html.match(/<link rel="canonical" href="[^"]+">/g) ?? [];
  if (canonicalTags.length !== 1 || canonicalTags[0] !== `<link rel="canonical" href="${canonical}">`) {
    throw new Error(`Expected exactly one correct canonical URL for ${role.title}.`);
  }
  if (!html.includes(`<a href="/job-types/">Occupation directory</a>`)) {
    throw new Error(`Occupation page is missing its directory link: ${role.slug}`);
  }
  if (copy.overview.length < 100 || copy.dayToDay.length < 100 || copy.skills.length < 100) throw new Error(`Occupation copy is too thin for ${role.title}.`);
  await writeFile(path.join(dir, "index.html"), html, "utf8");
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((item) => `  <url><loc>${item.loc}</loc><lastmod>${item.lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`;
await writeFile(path.join(outputRoot, "sitemap.xml"), sitemap, "utf8");
await writeFile(path.join(outputRoot, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteRoot}/sitemap.xml\n`, "utf8");

// Fail the build unless every occupation URL appears exactly once in the directory,
 // independent of the visual markup used for the responsive card layout.
for (const role of roles) {
  const href = `href="/job-types/${role.slug}/"`;
  const linkCount = directoryHtml.split(href).length - 1;
  if (linkCount !== 1) throw new Error(`Directory must link to ${role.slug} exactly once; found ${linkCount}.`);
}
const directoryCanonicalTags = directoryHtml.match(/<link rel="canonical" href="[^"]+">/g) ?? [];
if (directoryCanonicalTags.length !== 1 || directoryCanonicalTags[0] !== `<link rel="canonical" href="${directoryCanonical}">`) {
  throw new Error("Occupation directory must have exactly one correct canonical URL.");
}

// Validate sitemap coverage and uniqueness, including all core pages and occupation URLs.
const sitemapLocations = [...sitemap.matchAll(new RegExp("<loc>([^<]+)</loc>", "g"))].map((match) => match[1]);
const expectedLocations = urls.map((item) => item.loc);
if (sitemapLocations.length !== expectedLocations.length) {
  throw new Error(`Sitemap URL count mismatch: expected ${expectedLocations.length}, found ${sitemapLocations.length}.`);
}
if (new Set(sitemapLocations).size !== sitemapLocations.length) {
  throw new Error("Sitemap contains duplicate canonical URLs.");
}
for (const expectedUrl of expectedLocations) {
  if (!sitemapLocations.includes(expectedUrl)) throw new Error(`Sitemap is missing required URL: ${expectedUrl}`);
}
if (!corePaths.every((route) => sitemapLocations.includes(`${siteRoot}${route}`))) {
  throw new Error("Sitemap is missing one or more required core pages.");
}

console.log(`Validated ${roles.length} occupation pages, directory links, unique canonical URLs, and ${sitemapLocations.length} sitemap URLs.`);
