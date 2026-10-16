"""Deterministic application-schema and migration inventories for Phase 4C.

Only sanitized catalog definitions are recorded. Credentials, live row data outside
the Supabase migration ledger, and managed Auth/Storage schemas are never inventoried.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from typing import Any


APPLICATION_SCHEMAS = ("public", "supabase_migrations")


def _json_value(value: Any) -> Any:
    """Convert driver values into stable JSON-safe primitives."""
    if isinstance(value, dict):
        return {str(k): _json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(v) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        return isoformat()
    return str(value)


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        _json_value(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def _append_query(cursor, items: list[dict], kind: str, sql: str) -> None:
    cursor.execute(sql)
    columns = [getattr(column, "name", column[0]) for column in cursor.description]
    for row in cursor.fetchall():
        item = {"kind": kind}
        item.update({name: _json_value(value) for name, value in zip(columns, row)})
        items.append(item)


def collect_schema_inventory(cursor) -> dict:
    """Collect stable identities/definitions for application schemas, policies and grants."""
    items: list[dict] = []
    schemas = "'public','supabase_migrations'"

    _append_query(
        cursor, items, "schema",
        f"""SELECT n.nspname AS schema_name
             FROM pg_namespace n WHERE n.nspname IN ({schemas}) ORDER BY n.nspname""",
    )
    _append_query(
        cursor, items, "relation",
        f"""SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind,
                    c.relpersistence, c.relrowsecurity, c.relforcerowsecurity,
                    c.relreplident, COALESCE(c.reloptions, ARRAY[]::text[]) AS reloptions,
                    CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid, true) END AS view_definition,
                    CASE WHEN c.relkind IN ('p') THEN pg_get_expr(c.relpartbound, c.oid, true) END AS partition_bound
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN ({schemas})
               AND c.relkind IN ('r','p','v','m','S','f')
             ORDER BY n.nspname, c.relname""",
    )
    _append_query(
        cursor, items, "column",
        f"""SELECT n.nspname AS schema_name, c.relname AS relation_name,
                    a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) AS data_type,
                    a.attnotnull, a.attidentity, a.attgenerated,
                    cn.nspname AS collation_schema, coll.collname AS collation_name,
                    pg_get_expr(d.adbin, d.adrelid, true) AS default_expression
             FROM pg_attribute a
             JOIN pg_class c ON c.oid = a.attrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
             LEFT JOIN pg_collation coll ON coll.oid = a.attcollation
             LEFT JOIN pg_namespace cn ON cn.oid = coll.collnamespace
             WHERE n.nspname IN ({schemas}) AND a.attnum > 0 AND NOT a.attisdropped
               AND c.relkind IN ('r','p','v','m','f')
             ORDER BY n.nspname, c.relname, a.attnum""",
    )
    _append_query(
        cursor, items, "constraint",
        f"""SELECT n.nspname AS schema_name, c.relname AS relation_name,
                    con.conname AS object_name, con.contype, con.convalidated,
                    con.condeferrable, con.condeferred, con.conislocal, con.coninhcount,
                    con.connoinherit, pg_get_constraintdef(con.oid, true) AS definition
             FROM pg_constraint con
             JOIN pg_class c ON c.oid = con.conrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN ({schemas})
             ORDER BY n.nspname, c.relname, con.conname""",
    )
    _append_query(
        cursor, items, "index",
        f"""SELECT n.nspname AS schema_name, idx.relname AS object_name,
                    tbl.relname AS relation_name, pg_get_indexdef(i.indexrelid) AS definition,
                    i.indisunique, i.indisprimary, i.indisexclusion,
                    i.indisvalid, i.indisready, i.indislive
             FROM pg_index i
             JOIN pg_class idx ON idx.oid = i.indexrelid
             JOIN pg_class tbl ON tbl.oid = i.indrelid
             JOIN pg_namespace n ON n.oid = tbl.relnamespace
             WHERE n.nspname IN ({schemas})
             ORDER BY n.nspname, tbl.relname, idx.relname""",
    )
    _append_query(
        cursor, items, "routine",
        f"""SELECT n.nspname AS schema_name, p.proname AS object_name,
                    p.prokind, pg_get_function_identity_arguments(p.oid) AS identity_arguments,
                    format_type(p.prorettype, NULL) AS return_type,
                    p.proretset, p.provolatile, p.prosecdef, p.proleakproof,
                    COALESCE(p.proconfig, ARRAY[]::text[]) AS routine_settings,
                    CASE WHEN p.prokind <> 'a' THEN pg_get_functiondef(p.oid) END AS definition
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname IN ({schemas})
             ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)""",
    )
    _append_query(
        cursor, items, "aggregate",
        f"""SELECT n.nspname AS schema_name, p.proname AS object_name,
                    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
                    a.aggkind, a.aggnumdirectargs, format_type(a.aggtranstype, NULL) AS transition_type,
                    a.agginitval, a.aggtransfn::regprocedure::text AS transition_function,
                    a.aggfinalfn::regprocedure::text AS final_function,
                    a.aggcombinefn::regprocedure::text AS combine_function,
                    a.aggserialfn::regprocedure::text AS serialize_function,
                    a.aggdeserialfn::regprocedure::text AS deserialize_function
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             JOIN pg_aggregate a ON a.aggfnoid = p.oid
             WHERE n.nspname IN ({schemas})
             ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)""",
    )
    _append_query(
        cursor, items, "trigger",
        f"""SELECT n.nspname AS schema_name, c.relname AS relation_name,
                    t.tgname AS object_name, pg_get_triggerdef(t.oid, true) AS definition,
                    t.tgenabled
             FROM pg_trigger t
             JOIN pg_class c ON c.oid = t.tgrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN ({schemas}) AND NOT t.tgisinternal
             ORDER BY n.nspname, c.relname, t.tgname""",
    )
    _append_query(
        cursor, items, "policy",
        f"""SELECT n.nspname AS schema_name, c.relname AS relation_name,
                    p.polname AS object_name, p.polcmd, p.polpermissive,
                    ARRAY(
                      SELECT COALESCE(r.rolname, 'PUBLIC')
                      FROM unnest(p.polroles) AS roles(role_oid)
                      LEFT JOIN pg_roles r ON r.oid = roles.role_oid
                      ORDER BY COALESCE(r.rolname, 'PUBLIC')
                    ) AS policy_roles,
                    pg_get_expr(p.polqual, p.polrelid, true) AS using_expression,
                    pg_get_expr(p.polwithcheck, p.polrelid, true) AS check_expression
             FROM pg_policy p
             JOIN pg_class c ON c.oid = p.polrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN ({schemas})
             ORDER BY n.nspname, c.relname, p.polname""",
    )
    _append_query(
        cursor, items, "user_type",
        f"""SELECT n.nspname AS schema_name, t.typname AS object_name,
                    t.typtype, t.typcategory, t.typnotnull,
                    format_type(t.typbasetype, t.typtypmod) AS base_type,
                    t.typdefault, COALESCE(
                      ARRAY(SELECT e.enumlabel FROM pg_enum e
                            WHERE e.enumtypid = t.oid ORDER BY e.enumsortorder),
                      ARRAY[]::text[]
                    ) AS enum_labels,
                    COALESCE(t.typcollation, 0) AS collation_oid
             FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname IN ({schemas}) AND t.typtype IN ('c','d','e','r','m')
             ORDER BY n.nspname, t.typname""",
    )
    _append_query(
        cursor, items, "sequence",
        f"""SELECT n.nspname AS schema_name, c.relname AS object_name,
                    s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcache, s.seqcycle
             FROM pg_sequence s
             JOIN pg_class c ON c.oid = s.seqrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN ({schemas})
             ORDER BY n.nspname, c.relname""",
    )
    _append_query(
        cursor, items, "schema_grant",
        f"""SELECT n.nspname AS schema_name, COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
                    acl.privilege_type, acl.is_grantable
             FROM pg_namespace n
             CROSS JOIN LATERAL aclexplode(
                 COALESCE(n.nspacl, acldefault('n', n.nspowner))
             ) AS acl
             LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
             WHERE n.nspname IN ({schemas}) AND acl.grantee <> n.nspowner
             ORDER BY n.nspname, grantee, acl.privilege_type, acl.is_grantable""",
    )
    _append_query(
        cursor, items, "relation_grant",
        f"""SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind,
                    COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
                    acl.privilege_type, acl.is_grantable
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
             LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
             WHERE n.nspname IN ({schemas}) AND c.relacl IS NOT NULL
               AND c.relkind IN ('r','p','v','m','S','f') AND acl.grantee <> c.relowner
             ORDER BY n.nspname, c.relname, grantee, acl.privilege_type, acl.is_grantable""",
    )
    _append_query(
        cursor, items, "routine_grant",
        f"""SELECT n.nspname AS schema_name, p.proname AS object_name,
                    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
                    COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
                    acl.privilege_type, acl.is_grantable
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
             LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
             WHERE n.nspname IN ({schemas}) AND p.proacl IS NOT NULL
               AND acl.grantee <> p.proowner
             ORDER BY n.nspname, p.proname, identity_arguments, grantee, acl.privilege_type""",
    )
    _append_query(
        cursor, items, "default_grant",
        f"""SELECT COALESCE(n.nspname, '<global>') AS schema_name,
                    COALESCE(owner_role.rolname, '<unknown>') AS owner_role,
                    d.defaclobjtype, COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
                    acl.privilege_type, acl.is_grantable
             FROM pg_default_acl d
             LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
             LEFT JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
             CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
             LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
             WHERE d.defaclnamespace = 0 OR n.nspname IN ({schemas})
             ORDER BY schema_name, owner_role, d.defaclobjtype, grantee, acl.privilege_type""",
    )

    items.sort(key=lambda item: canonical_json(item))
    counts = dict(sorted(Counter(item["kind"] for item in items).items()))
    return {
        "items": items,
        "item_count": len(items),
        "counts_by_kind": counts,
        "sha256": sha256_json(items),
    }


def collect_migration_history(cursor) -> dict:
    """Hash every ledger row and retain the complete ordered version/name list."""
    cursor.execute("SELECT to_regclass('supabase_migrations.schema_migrations')")
    present = cursor.fetchone()[0] is not None
    rows: list[dict] = []
    if present:
        cursor.execute(
            "SELECT to_jsonb(m) FROM supabase_migrations.schema_migrations AS m ORDER BY version"
        )
        rows = [_json_value(row[0]) for row in cursor.fetchall()]
    versions = [
        {"version": str(row.get("version", "")), "name": str(row.get("name", ""))}
        for row in rows
    ]
    return {
        "present": present,
        "row_count": len(rows),
        "versions": versions,
        "latest_migration": versions[-1] if versions else None,
        "rows_sha256": sha256_json(rows),
    }


def collect_publication_snapshot(cursor) -> list[dict]:
    """Capture managed publication configuration and membership for before/after comparison."""
    cursor.execute(
        """
        SELECT p.pubname, p.puballtables, p.pubinsert, p.pubupdate, p.pubdelete,
               p.pubtruncate, p.pubviaroot,
               COALESCE(
                 jsonb_agg(
                   jsonb_build_object('schema', n.nspname, 'table', c.relname)
                   ORDER BY n.nspname, c.relname
                 ) FILTER (WHERE c.oid IS NOT NULL),
                 '[]'::jsonb
               ) AS tables
        FROM pg_publication p
        LEFT JOIN pg_publication_rel pr ON pr.prpubid = p.oid
        LEFT JOIN pg_class c ON c.oid = pr.prrelid
        LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
        GROUP BY p.pubname, p.puballtables, p.pubinsert, p.pubupdate, p.pubdelete,
                 p.pubtruncate, p.pubviaroot
        ORDER BY p.pubname
        """
    )
    columns = [getattr(column, "name", column[0]) for column in cursor.description]
    return [
        {name: _json_value(value) for name, value in zip(columns, row)}
        for row in cursor.fetchall()
    ]
