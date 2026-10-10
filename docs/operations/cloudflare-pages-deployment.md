# Cloudflare Pages deployment configuration

**Project:** `job-grid`  
**Repository:** `job-grid/job-grid`  
**Status:** Operational reference; production deployment verification is pending.

## Configuration record

The values below record the owner's latest Cloudflare Pages dashboard screenshots. They are recorded as owner-reported configuration, not as an independent live read of Cloudflare settings.

| Setting | Recorded value | Evidence status |
|---|---|---|
| Cloudflare Pages project | `job-grid` | Owner-reported |
| Connected repository | `job-grid/job-grid` | Owner-reported |
| Production branch | `main` | Owner-reported |
| Automatic production deployments | Enabled | Owner-reported |
| Build command | `npm run build` | Owner-reported |
| Build output directory | `dist` | Owner-reported |
| Preview branch mode | Custom branches | Owner-reported |
| Preview branch include pattern | `*` | Owner-reported |
| Preview branch exclude pattern | `docs/*` | Owner-reported |
| Build watch paths | `*` | Owner-reported |

Verify these values in the Cloudflare Pages project if settings may have changed since the screenshots.

## Preview branch filter semantics

The `docs/*` exclusion is a **branch-name filter** for Preview deployments. It excludes matching branch names, such as `docs/example`, from preview deployments. It does **not** exclude documentation-file changes from a branch whose name is otherwise eligible for Preview deployment.

Because the include pattern is `*`, branches are generally eligible for Preview unless excluded by the configured branch-name pattern. Documentation-only branches should use a name outside the `docs/*` pattern when a Preview deployment is expected.

The build watch path `*` is recorded as the configured path filter; confirm its exact interpretation in Cloudflare if the dashboard configuration changes.

## Build and deployment responsibilities

The repository's `scripts/build.mjs` creates the static site in `dist/`. It clears and recreates that directory, copies `index.html`, styles and browser-facing modules, and copies `public/job-grid-logo.png` to `dist/job-grid-logo.png`. The script explicitly states that the build does not deploy the site or connect to a backend.

The GitHub Actions workflow at `.github/workflows/production-deploy.yml` is a **control-only workflow**, not an application deployment implementation. It is manually dispatched, restricts its gate to `main`, declares the `production` environment and a concurrency group, and then intentionally exits with failure after stating that application deployment is not configured in Phase 0. It must not be treated as the mechanism that publishes the website.

Cloudflare Pages Git integration is the configured automatic-deployment mechanism described by the owner-reported settings above. A successful Preview deployment demonstrates a Preview build/deployment only; it is not evidence that Production has updated.

## Production verification procedure

After an approved change is merged to `main`:

1. Open the Cloudflare dashboard for Pages project `job-grid` and inspect **Deployments**.
2. Locate the Production deployment and confirm its status is successful.
3. Confirm its source branch is `main` and its source commit matches the resulting `main` revision.
4. Record the production deployment URL and commit for the release record.
5. Open the production URL in a browser and confirm the site loads correctly.

Do not report production as updated based only on GitHub CI, a successful Preview deployment, or the configured production branch setting. Until a successful Production deployment is observed with the expected source branch and commit, production update status remains **not verified**.

## Current verification boundary

At the time this document was prepared, repository evidence confirms that `main` contains the Job Grid Phase 1 merge commit. The owner reports that the Production branch was changed to `main` and automatic production deployments remain enabled, but the latest dashboard screenshot still showed Production pointing to the prior feature-branch deployment. Therefore, the intended `main` revision's Production deployment is **pending verification**.

No application deployment is performed by this document or by `scripts/build.mjs`; this document does not change Cloudflare settings or trigger a deployment.
