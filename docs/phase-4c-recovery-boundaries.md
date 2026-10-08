# Phase 4C — Recovery Boundaries

Phase 4C implements a controlled logical PostgreSQL backup/snapshot and isolated recovery validation process.

## In scope

### PostgreSQL database/schema/data
The logical PostgreSQL artifact covers application database objects and data that can be represented by the approved logical dump format, including schemas, tables, sequences, indexes, constraints, functions, triggers, and RLS policies where supported by the dump/restore mechanism.

Migration-state metadata is separately validated after restore.

### Supabase Auth
Supabase Auth is a managed service boundary and is **not assumed to be recovered by the PostgreSQL application-data dump alone**. Phase 4C must explicitly document and validate the selected Auth recovery method before any claim of full Auth recovery is made.

If Auth users/metadata are represented in the database artifact, that does not by itself prove that the managed Auth service is operationally restored.

### Supabase Storage
Storage metadata may be represented in PostgreSQL where applicable, but Storage objects themselves are external managed objects and are **not assumed to be recovered by pg_dump**. Object recovery requires a separately authorized object-backup/recovery mechanism.

Phase 4C therefore reports database restore success separately from Storage-object recovery.

### External configuration and provider configuration
Cloudflare configuration, R2 configuration, Supabase project configuration, provider settings, OAuth/provider configuration, secrets, API keys, webhooks, DNS, and other external configuration are outside the logical PostgreSQL backup boundary.

They must be separately inventoried and recovered through their respective protected configuration mechanisms if required.

## Recovery claim

A successful PostgreSQL restore means:

> The approved logical PostgreSQL snapshot was restored into the approved isolated recovery PostgreSQL target and passed the defined database validation suite.

It does **not** mean that Supabase Auth, Supabase Storage objects, Cloudflare, R2, secrets, DNS, or external providers have been restored.
