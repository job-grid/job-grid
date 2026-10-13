import os
import ssl
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from production_preflight import (
    APPROVED_HOST,
    BackupPreflight,
    PreflightCode,
    PreflightConfig,
    PreflightFailure,
    _create_postgres_ssl_context,
    check_authentication,
    check_dns,
)


class DNSPreflightTests(unittest.TestCase):
    def test_dns_accepts_ipv4_address_records(self):
        result = subprocess.CompletedProcess(["getent", "ahosts", APPROVED_HOST], 0, "192.0.2.10 STREAM\n")
        with patch("production_preflight.subprocess.run", return_value=result) as lookup:
            check_dns(APPROVED_HOST)
        self.assertEqual(lookup.call_args.args[0], ["getent", "ahosts", APPROVED_HOST])
        self.assertEqual(lookup.call_args.kwargs["timeout"], 5)

    def test_dns_accepts_ipv6_address_records(self):
        result = subprocess.CompletedProcess(["getent", "ahosts", APPROVED_HOST], 0, "2001:db8::10 STREAM\n")
        with patch("production_preflight.subprocess.run", return_value=result):
            check_dns(APPROVED_HOST)

    def test_dns_accepts_dual_stack_address_records(self):
        output = "192.0.2.10 STREAM\n2001:db8::10 STREAM\n"
        result = subprocess.CompletedProcess(["getent", "ahosts", APPROVED_HOST], 0, output)
        with patch("production_preflight.subprocess.run", return_value=result):
            check_dns(APPROVED_HOST)

    def test_dns_rejects_unapproved_hostname_without_lookup(self):
        with patch("production_preflight.subprocess.run") as lookup:
            with self.assertRaises(PreflightFailure) as ctx:
                check_dns("pooler.example.invalid")
        self.assertEqual(ctx.exception.code, PreflightCode.DNS_FAILED.value)
        lookup.assert_not_called()

    def test_dns_rejects_empty_resolution(self):
        result = subprocess.CompletedProcess(["getent", "ahosts", APPROVED_HOST], 0, "")
        with patch("production_preflight.subprocess.run", return_value=result):
            with self.assertRaises(PreflightFailure) as ctx:
                check_dns(APPROVED_HOST)
        self.assertEqual(ctx.exception.code, PreflightCode.DNS_FAILED.value)

    def test_dns_rejects_resolution_error_with_fixed_code(self):
        with patch("production_preflight.subprocess.run", side_effect=OSError("secret-host-detail")):
            with self.assertRaises(PreflightFailure) as ctx:
                check_dns(APPROVED_HOST)
        self.assertEqual(str(ctx.exception), PreflightCode.DNS_FAILED.value)
        self.assertNotIn("secret-host-detail", str(ctx.exception))

    def test_dns_rejects_resolution_timeout_with_fixed_code(self):
        with patch("production_preflight.subprocess.run", side_effect=subprocess.TimeoutExpired("getent", 5)):
            with self.assertRaises(PreflightFailure) as ctx:
                check_dns(APPROVED_HOST)
        self.assertEqual(str(ctx.exception), PreflightCode.DNS_FAILED.value)
        self.assertNotIn("TimeoutExpired", str(ctx.exception))


    def test_preflight_rejects_unapproved_port_before_network_access(self):
        config = PreflightConfig(APPROVED_HOST, 6543, "postgres", "synthetic-user", "synthetic-password", "17", Path(tempfile.gettempdir()), b"0" * 32)
        with patch("production_preflight.check_client") as client_check:
            with self.assertRaises(PreflightFailure) as ctx:
                BackupPreflight(r2_client=object(), bucket="synthetic").run(config)
        self.assertEqual(ctx.exception.code, PreflightCode.TCP_FAILED.value)
        client_check.assert_not_called()


    def test_ssl_context_loads_supabase_root_ca_without_disabling_verification(self):
        with tempfile.TemporaryDirectory() as temp:
            ca_file = Path(temp) / "project-root-ca.crt"
            ca_file.write_text("synthetic CA fixture", encoding="utf-8")
            with patch.dict(os.environ, {"PGSSLROOTCERT": str(ca_file)}, clear=False):
                with patch("production_preflight.ssl.create_default_context") as create_context:
                    context = create_context.return_value
                    result = _create_postgres_ssl_context()
            self.assertIs(result, context)
            context.load_verify_locations.assert_called_once_with(cafile=str(ca_file))
            self.assertEqual(context.minimum_version, ssl.TLSVersion.TLSv1_2)

    def test_ssl_context_fails_closed_when_root_ca_is_missing(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(PreflightFailure) as ctx:
                _create_postgres_ssl_context()
        self.assertEqual(ctx.exception.code, PreflightCode.TLS_FAILED.value)

    def test_ssl_context_converts_invalid_ca_to_fixed_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            ca_file = Path(temp) / "project-root-ca.crt"
            ca_file.write_text("invalid CA fixture", encoding="utf-8")
            with patch.dict(os.environ, {"PGSSLROOTCERT": str(ca_file)}, clear=False):
                with patch("production_preflight.ssl.create_default_context") as create_context:
                    create_context.return_value.load_verify_locations.side_effect = ssl.SSLError("secret certificate detail")
                    with self.assertRaises(PreflightFailure) as ctx:
                        _create_postgres_ssl_context()
        self.assertEqual(ctx.exception.code, PreflightCode.TLS_FAILED.value)
        self.assertNotIn("secret certificate detail", str(ctx.exception))


    def test_authentication_check_supports_psycopg3_connection_info(self):
        class ConnectionWithoutPsycopg2SslAttribute:
            closed = False

            def close(self):
                self.closed = True

        config = PreflightConfig(
            APPROVED_HOST, 5432, "postgres", "synthetic-user",
            "synthetic-password", "17", Path(tempfile.gettempdir()), b"0" * 32
        )
        conn = ConnectionWithoutPsycopg2SslAttribute()
        with patch("production_preflight._connect", return_value=conn) as connect:
            check_authentication(config)
        connect.assert_called_once_with(config)
        self.assertTrue(conn.closed)

if __name__ == "__main__":
    unittest.main()
