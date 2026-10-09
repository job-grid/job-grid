# Job Grid — Phase 1 website foundation

A responsive, static-first public website shell and reusable brand/design foundation. This phase deliberately does not connect to Supabase, query live jobs, collect candidate information, authenticate users, deploy, or alter database schemas.

## Technology decision

The repository did not have an application/package manifest or frontend framework at the Phase 1 starting point. This initial public shell uses standards-based HTML, CSS custom properties, native Web Components, and modern JavaScript modules. That avoids introducing a large dependency tree before the first interface and deployment architecture have been reviewed.

**Recommended next-stage application stack:** TypeScript + React/Next.js, provided the Cloudflare deployment path is confirmed with a non-production preview first. That will suit the planned route structure, job-detail pages, protected account areas, and server-rendered SEO. The current control-plane repository does not itself establish an application deployment configuration, so Phase 1 does not add an unverified production path.

## Development

Requirements: Node.js 22+ and npm.

- `npm ci` — install the locked dependency graph (no third-party runtime dependencies in this phase).
- `npm run lint` — check HTML metadata, semantic landmarks, accessibility hooks, core tokens, mobile/reduced-motion rules, and absence of database coupling.
- `npm run typecheck` — syntax-check the JavaScript modules. No TypeScript has been introduced in this static phase.
- `npm test` — run built-in Node test runner checks.
- `npm run build` — copy the public files into `dist/`; no deployment occurs.

Open `index.html` through a local static server to inspect the page. The homepage is responsive and uses reusable header/footer Web Components. The “LOGO PENDING” outline is temporary and should be replaced with the owner's supplied logo without changing the page layout.

## Current boundaries

- Vacancy cards are clearly labelled sample design content, not active listings.
- Job search, filtering, registration, authentication, application tracking, and employer tools are not implemented.
- No production credentials or backend URLs are required.
- No migration, backup workflow, deployment workflow, or production setting was changed.

## Next planned phases

1. Add the approved logo asset, responsive logo sizing, and brand sign-off.
2. Build job discovery, live listings/pagination, filters, and job details against a separately reviewed data contract.
3. Add candidate and employer authentication/registration with authorization tests.
4. Add applications and applicant tracking.
5. Add moderation/admin workflows and SEO route generation.
6. Establish and test an isolated Cloudflare preview/deployment path before separately authorizing any production configuration.
