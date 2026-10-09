import subprocess
import unittest
from unittest.mock import patch

from production_preflight import APPROVED_HOST, PreflightCode, PreflightFailure, check_dns


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


if __name__ == "__main__":
    unittest.main()
