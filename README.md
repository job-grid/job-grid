# Job Grid — Phase 1 website foundation

A responsive public website shell and reusable brand/design foundation. This phase deliberately does not connect to Supabase, query live jobs, collect candidate information, authenticate users, deploy, or alter database schemas.

## Brand system

- The official logo was supplied by the owner. `public/job-grid-logo.webp (served at `/job-grid-logo.webp`)` is a separate 96×96, display-optimized WebP variant derived from that source for the 48px header/footer placement. It preserves the emblem proportions; the original uploaded PNG was not overwritten or redrawn.
- Header and footer share a reusable `job-grid-brand` web component, using the same logo asset and responsive sizing rules.
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
- `npm test` — run tests with Node's built-in test runner, including the official logo's WebP signature and reusable brand component.
- `npm run build` — copy public files into `dist/`; no deployment occurs.

The owner-supplied image remains the source of truth. If a full-resolution or transparent export is later needed, prepare it as a separate asset; do not overwrite the owner's PNG.

## Current boundaries

- Vacancy cards are clearly labelled sample design content, not active listings.
- Job search, filtering, registration, authentication, application tracking, and employer tools are not implemented.
- No production credentials or backend URLs are required.
- No migration, backup workflow, deployment workflow, or production setting was changed.

## Next planned phases

1. Review/sign off the official logo placement and palette.
2. Build job discovery, live listings/pagination, filters, and job details against an approved data contract.
3. Add candidate and employer authentication/registration with authorization tests.
4. Add applications and applicant tracking.
5. Add moderation/admin workflows and SEO route generation.
6. Establish and test an isolated Cloudflare preview/deployment path before separately authorizing production configuration.
