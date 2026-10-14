# Job Grid — Phase 1 website foundation

A responsive public website with a searchable starter catalogue of 496 distinct job types across 25 categories. The country selector reads the public, read-only `country_options` catalog from the existing Supabase project. Real employer job listings, candidate data collection, authentication and applications are not connected to the website yet.

## Brand system

- The website uses `public/job-grid-logo.png`, served at `/job-grid-logo.png`. The asset is PNG; this repository branch does not require a WebP logo. Do not replace, redraw, overwrite, or convert the owner's original logo without separate authorization and a demonstrated requirement.
- Header and footer share a reusable `job-grid-brand` web component, using the same PNG asset and responsive sizing rules.
- `styles/tokens.css` centralizes the logo-derived royal blue (#004EF5), bright blue (#1161F6), white, deep navy, typography, spacing, borders, radii, and shadows.
- Keyboard focus, skip navigation, reduced-motion preference, and mobile navigation states are included.

## Technology decision

The repository did not have an application/package manifest or frontend framework at the Phase 1 starting point. This foundation uses semantic HTML, CSS custom properties, native Web Components, modern JavaScript modules, and Node's built-in test runner. No third-party runtime dependencies were added.

**Recommended next-stage application stack:** TypeScript + React/Next.js, once the Cloudflare deployment path is confirmed with a non-production preview. This fits the planned job-search routes, SEO, job details, and protected account areas. The existing repository does not establish a deployed app path, so Phase 1 does not invent one.

## Development

Requirements: Node.js 22+ and npm.

- `npm ci` — install the dependency-free lockfile.
- `npm run lint` — check semantic metadata, accessibility hooks, design tokens, and source invariants.
- `npm run typecheck` — syntax-check JavaScript modules; no TypeScript is introduced in this static-first phase.
- `npm test` — run tests with Node's built-in test runner, including the PNG signature and the reusable brand component's logo reference.
- `npm run build` — copy public files into `dist/`; no deployment occurs.

The owner-supplied image remains the source of truth. If a full-resolution or transparent export is later needed, prepare it as a separate asset; do not overwrite the owner's PNG.

## Current boundaries

- The role directory shows 496 cleaned base job types from the uploaded workbook. These are not confirmed vacancies or officially verified occupational classifications.
- Job-type title/category search is implemented. Live vacancy querying, registration, authentication, applications, application tracking, and employer tools are not implemented.
- `scripts/supabase-config.js` contains only the Supabase project URL and a browser-safe publishable key so the country dropdown can read the public catalog. Never place a secret/service-role key in that file.
- No migration, backup workflow, deployment workflow, or production setting was changed.

## Next planned phases

1. Review/sign off the official logo placement and palette.
2. Build job discovery, live listings/pagination, filters, and job details against an approved data contract.
3. Add candidate and employer authentication/registration with authorization tests.
4. Add applications and applicant tracking.
5. Add moderation/admin workflows and SEO route generation.
6. Establish and test an isolated Cloudflare preview/deployment path before separately authorizing production configuration.
