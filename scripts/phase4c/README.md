# Phase 4C tooling

This directory contains tooling-only safety and artifact primitives.

## Current implementation-stage contract

The current stage does **not** create backups and does **not** restore databases.

Run the deterministic self-check with:

```bash
python3 scripts/phase4c/phase4c_tooling.py --self-check
```

Run unit tests with:

```bash
python3 -m unittest discover -s scripts/phase4c -p 'test_*.py'
```

No production credentials, recovery credentials, R2 credentials, Supabase credentials, or encryption keys are required for these checks.

Actual backup creation and restore are intentionally separate future stages requiring explicit authorization.
