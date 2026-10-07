#!/usr/bin/env bash
set -euo pipefail

MIGRATIONS_DIR="supabase/migrations"

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "No supabase/migrations directory; migration validation skipped."
  exit 0
fi

mapfile -t files < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -print | sort)
if (( ${#files[@]} == 0 )); then
  echo "No migration files; migration validation skipped."
  exit 0
fi

for file in "${files[@]}"; do
  base="$(basename "$file")"
  if [[ ! "$base" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]]; then
    echo "Invalid migration filename: $base" >&2
    exit 1
  fi
  version="${base:0:14}"
  count=$(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name "${version}_*.sql" | wc -l)
  if (( count != 1 )); then
    echo "Duplicate migration version: $version" >&2
    exit 1
  fi
  if grep -Eiq '(^|[^-])\b(DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|TRUNCATE|DELETE[[:space:]]+FROM)\b' "$file"; then
    if ! grep -Eiq '^--[[:space:]]*destructive-review:[[:space:]]*(approved|phase0-controlled-test)[[:space:]]*$' "$file"; then
      echo "Destructive SQL requires explicit review marker: $base" >&2
      exit 1
    fi
  fi
done

echo "Validated ${#files[@]} migration file(s)."
