# Database Migration Governance

This repository uses forward-only, reviewed database migrations for production.

## Naming

Migration filenames use:

`YYYYMMDDHHMMSS_short_description.sql`

The timestamp prefix must be 14 digits. The description uses lowercase letters, numbers, and underscores.

## Immutability

Once a migration has been applied to production, its contents are immutable. A correction requires a new migration. Do not edit or delete an applied migration.

## Application/domain tables

No application/domain table may be introduced without an explicit authorization design. A protected table migration must explicitly establish RLS and its policies; enabling RLS alone is not sufficient.

Before creating a tenant- or jurisdiction-sensitive table, the migration PR must document the tenant boundary, jurisdiction boundary, ownership model, and expected RLS policy behavior.

## Destructive SQL

`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, broad `DELETE`, and comparable destructive operations require explicit elevated review and a documented recovery/compatibility plan. The CI validator requires a review marker for destructive SQL.

## Expand/contract

Potentially breaking schema changes use expand/contract: add compatible structure, deploy compatible application behavior, migrate/backfill, verify, switch reads/writes, then remove obsolete structure in a later reviewed migration.

## Verification

Production migration execution must verify migration version, expected schema objects, RLS/policies, and application health. Database changes must be traceable to the exact Git commit that approved them.

## Phase 0 exception

The Phase 0 control-plane branch contains two already-applied Supabase migrations that only remediate and verify the existing RLS backstop. The verification migration creates and removes a temporary probe table and is not an application/domain migration.
