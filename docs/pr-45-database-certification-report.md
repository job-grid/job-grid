# PR #45 — Database Certification Report

**Report date:** 14 October 2026  
**Certification outcome:** **PASS — isolated PostgreSQL certification**  
**Production release outcome:** **NOT APPROVED / UNVERIFIED**  
**Production migration:** Not executed  
**PR status at certification:** Open, draft, unmerged

## 1. Certified revision and target

- **Implementation/test revision that passed the database certification:** 1220683862a6ce734527664147b1c98876966516
- **Target branch:** main
- **Target branch SHA at certification:** d096b8ef4c91a1ca40fe72205abc117759e90f99
- **PR:** [#45 — verified international job workflow](https://github.com/job-grid/job-grid/pull/45)
- **Database certification run:** [GitHub Actions — Phase 0 CI](https://github.com/job-grid/job-grid/actions/runs/38625077456)
- **Isolated PostgreSQL certification job:** [Job logs](https://github.com/job-grid/job-grid/actions/runs/38625077456/job/116062044992)
- **No merge or production migration was performed.** The PR remains draft. The successful Cloudflare Pages check is a branch/CI check; this report does not treat it as a production release.

## 2. Test environment and method

The proposed migration was applied to an ephemeral **PostgreSQL 17** service created for a GitHub Actions run. The test database is separate from the live Job-Grid Supabase project.

The test setup used:
1. The repository’s actual country-options migration.
2. The repository’s actual existing category-and-jobs migration.
3. A minimal Supabase-compatible fixture for anon, authenticated, service_role, auth.users, and auth.uid().
4. The PR #45 migration, followed by catalog, constraint, permission, synthetic-record, and publication tests.

The authenticated identities and every employer, occupation, source, and vacancy created by the test are **synthetic fixtures only**. No external website was contacted. No real vacancy or workbook occupation was imported.

**Limit:** this is a real PostgreSQL migration/SQL certification, but it is not a hosted Supabase preview project. PostgREST, the real Supabase Auth service, gateway/JWT handling, and the production configuration were not exercised end-to-end.

## 3. Production baseline and preservation proof

Read-only checks were performed against the live Job-Grid project before the isolated test. The isolated database was then seeded from the repository migrations and compared against the production category and country content fingerprints.

| Baseline check | Result | Evidence |
|---|---|---|
| Existing public.job_categories rows | **PASS — 25 active categories** | Count and deterministic row fingerprint matched |
| Existing public.country_options rows | **PASS — 249 country options** | Count and deterministic row fingerprint matched |
| Existing public.jobs rows before migration | **PASS — 0** | Count matched |
| Category fingerprint | **PASS** | 480311db1f5387645f67aa8cadf91d37 |
| Country fingerprint | **PASS** | b7b741c57938e86b7593723bce9a6f26 |
| Duplicate category table | **PASS — none created** | Migration inspection and database catalog query |
| Parallel job_vacancies table | **PASS — none created** | Database catalog query |
| Existing category/country/jobs counts and hashes after migration | **PASS — unchanged** | Before/after comparison succeeded |
| 5,000-row occupation workbook import | **PASS — not performed** | No occupation rows are inserted by the migration; public.jobs remains the one vacancy table |

These are MD5-style fingerprints used to compare deterministic query output, not cryptographic assurances about all production database contents. The existing categories and country options are preserved under the fields included in those query fingerprints.

## 4. Required-control results

| Required control | Status | Test result / qualification |
|---|---|---|
| Pin PR and target SHAs | **PASS** | Implementation revision and main target SHA are recorded above |
| Isolated PostgreSQL/Supabase-compatible environment | **PASS** | Temporary PostgreSQL 17 database with synthetic identity/auth fixtures |
| Apply proposed migration | **PASS** | Baseline migrations and PR migration applied successfully in the isolated database |
| Preserve 25 categories and country records | **PASS** | Exact row counts and deterministic content fingerprints matched before/after |
| Preserve single existing jobs table | **PASS** | It is extended; no replacement vacancy table is created |
| Foreign-key catalog integrity | **PASS** | All declared public foreign keys are validated; the certification suite exercises invalid references across the relationship set, including same-job evidence/dedupe references |
| Check-constraint catalog integrity | **PASS** | All declared public CHECK constraints are validated in PostgreSQL’s catalog |
| Critical constraint behavior | **PASS** | Negative cases exercise invalid category/country/occupation/employer/source links, skill/employment types, salary range, HTTPS application URL, publication window, missing employer/occupation/source evidence, embedded connector secrets, and confirmed sponsorship without vacancy-specific evidence |
| Duplicate controls | **PASS — exact/source identity** | Global canonical URL identity and per-source external ID uniqueness reject duplicate identities |
| RLS and browser grants | **PASS** | RLS is enabled on workflow tables; public roles are read-only for jobs; private source/evidence/review/role tables are not exposed; active-but-pending occupations are hidden |
| Security-definer functions | **PASS — isolated database** | Required functions exist, are security-definer functions, and have pinned empty search_path; reviewer/publisher/source-control paths were exercised |
| Anonymous permissions | **PASS** | Cannot call reviewer RPC or directly insert a job; sees only the valid published synthetic listing |
| Ordinary authenticated permissions | **PASS** | Does not gain reviewer/publisher rights merely by being authenticated; sees only public listings |
| Reviewer permissions | **PASS** | Authorized reviewer can approve a complete current evidence set; unauthorized/non-reviewer users and reviewers without evidence are rejected |
| Publisher permissions | **PASS** | Publisher can publish an approved in-date record and suspend/unpublish a record; reviewer cannot publish |
| Administrator/source-administrator permissions | **PASS — tested operations** | Synthetic administrator can control/disable a source with audit recording; revoked source cannot be re-enabled |
| Unknown international eligibility | **PASS — blocked** | A record with unknown eligibility cannot be approved for publication |
| Missing eligibility/application evidence | **PASS — blocked** | Missing evidence cannot be approved |
| Unknown/missing sponsorship evidence | **PASS — blocked where sponsorship is claimed** | Confirmed sponsorship without supporting vacancy evidence fails the database constraint |
| Expired vacancy | **PASS — blocked** | Publisher cannot publish an expired synthetic listing |
| Revoked source | **PASS — withdrawn/blocked** | Source revocation disables the source connection and removes the linked vacancy from public results; source cannot be re-enabled without approved permission evidence |
| Stale approval after job/source/evidence/eligibility change | **PASS — invalidated** | Job edits, source-link changes, evidence changes and eligibility-assessment changes return the listing to draft/review |
| Employer identity change | **PASS — re-verification required** | Change resets employer verification evidence, retracts linked job, and blocks reapproval until the employer is reverified |
| Occupation identity change | **PASS — re-verification required** | Change resets occupation verification, marks it inactive, retracts linked job, and blocks reapproval until the occupation is reverified |
| Website/database category compatibility | **PASS — data contract** | Existing website’s 496 unique starter titles map to the 25 category slugs from PostgreSQL; 0 unmapped titles; public query returns the expected category list |
| Existing website end-to-end in a real browser against hosted Supabase | **UNVERIFIED** | The automated test checks the category data contract in PostgreSQL; it does not launch a browser against the hosted live Supabase API |
| Real external source collection and permission compliance | **UNVERIFIED / deliberately disabled** | No sources are seeded/enabled, no fetch connector is running, and no public job source was contacted |
| Cross-source fuzzy duplicate matching | **UNVERIFIED / not implemented** | Exact source-ID/canonical-URL unique keys are tested. Candidate review storage exists, but production fuzzy matching is not delivered by this schema migration |
| Hosted Supabase Auth/PostgREST/RLS/JWT behavior | **UNVERIFIED** | PostgreSQL roles and auth.uid() are represented by an isolated compatible fixture, not the actual Supabase hosted gateway |
| Backup restoration and production recovery | **UNVERIFIED** | This PR did not restore a backup or alter the recovery project. A backup object alone is not proof that a restoration works |
| Production migration execution | **UNVERIFIED / not performed** | Production schema and data were not changed |
| Merge/deployment approval | **NOT APPROVED** | Must remain stopped at the PR/production approval gate |

## 5. Failures found and corrections

The branch was not certified on its first attempt. The certification process caught and corrected these issues before the passing run:

1. **Parent invalidation triggers were declared but not registered.** The migration was corrected to register the employer, occupation and source invalidation triggers.
2. **Duplicate-source and confirmed-sponsorship test SQL used malformed dollar-quote delimiters.** The test statements were corrected, and the isolated run was repeated.
3. **The final tests check trigger behavior, not only trigger presence.** Job details, employer identity, occupation identity, source links, source evidence, and eligibility assessments were changed. The tests confirmed the prior publication is withdrawn and requires fresh approval. Employer/occupation tests additionally confirmed identity changes reset verification evidence and prevent reapproval until the parent is reverified.

The final database certification run on revision 1220683862a6ce734527664147b1c98876966516 completed successfully. The final Phase 0 CI run also reports success for application validation, migration validation, repository integrity, secret scanning, dependency review, isolated database certification, and the other configured checks.

## 6. Rollback and recovery plan

### What happened in this certification
Only an ephemeral PostgreSQL service was modified. The service is stopped and discarded when the GitHub Actions job ends. No production rollback was required.

### Before any production migration is approved
1. Export and retain a verified pre-migration backup of the production schema/data and preserve the exact release commit.
2. Prove that the backup can be restored to an isolated recovery target. **This has not been demonstrated yet**, so recovery remains a release blocker.
3. Record category/country/jobs row counts and content fingerprints immediately before the migration, and run the same checks after the migration.
4. Apply the reviewed migration once, then rerun the schema, RLS, application, and publication checks against the actual Supabase project.
5. Keep source connectors empty/disabled until each access method, permitted use, attribution, retention rule, and owner has been reviewed and approved.

### If a later release must be reversed
Do not blindly drop new tables or reverse columns once any real source, review, audit or vacancy data exists. First disable all source connectors and unpublish affected listings; then prefer a reviewed forward-fix. If restoring a pre-migration snapshot is required, do so only after the recovery procedure has been demonstrated and the restore target has been verified. A destructive down-migration is not certified by this report.

## 7. Final decision

**PASS for the migration in an isolated PostgreSQL 17 environment and the documented synthetic database/permission/publication cases.**

**NOT CERTIFIED FOR PRODUCTION RELEASE.** Remaining blockers are hosted-Supabase integration verification, browser-to-hosted-API regression testing, approved source acquisition, cross-source fuzzy deduplication, and a demonstrated backup restoration.

PR #45 must remain open and unmerged. No external collection may be activated, no occupation candidates may be loaded into live vacancies, and no production migration may be run until those release blockers are resolved and production execution is explicitly approved.
