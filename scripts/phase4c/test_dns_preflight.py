import io
import os
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from production_preflight import (
    APPROVED_HOST,
    PreflightCode,
    PreflightFailure,
    check_dns,
)


class DNSPreflightTests(unittest.TestCase):
    def test_dns_accepts_ipv4_address_records(self):
        records = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.0.2.10", 0))]
        with patch("production_preflight.socket.getaddrinfo", return_value=records) as lookup:
            check_dns(APPROVED_HOST)
        lookup.assert_called_once_with(
            APPROVED_HOST,
            None,
            family=socket.AF_UNSPEC,
            type=socket.SOCK_STREAM,
        )

    def test_dns_accepts_ipv6_address_records(self):
        records = [(socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2001:db8::10", 0, 0, 0))]
        with patch("production_preflight.socket.getaddrinfo", return_value=records):
            check_dns(APPROVED_HOST)

    def test_dns_accepts_dual_stack_address_records(self):
        records = [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.0.2.10", 0)),
            (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2001:db8::10", 0, 0, 0)),
        ]
        with patch("production_preflight.socket.getaddrinfo", return_value=records):
            check_dns(APPROVED_HOST)

    def test_dns_rejects_unapproved_hostname_without_lookup(self):
        with patch("production_preflight.socket.getaddrinfo") as lookup:
            with self.assertRaises(PreflightFailure) as ctx:
                check_dns("pooler.example.invalid")
        self.assertEqual(ctx.exception.code, PreflightCode.DNS_FAILED.value)
        lookup.assert_not_called()

    def test_dns_rejects_empty_resolution(self):
        with patch("production_preflight.socket.getaddrinfo", return_value=[]):
            with self.assertRaises(PreflightFailure) as ctx:
                check_dns(APPROVED_HOST)
        self.assertEqual(ctx.exception.code, PreflightCode.DNS_FAILED.value)

    def test_dns_rejects_resolution_error_with_fixed_code(self):
        with patch("production_preflight.socket.getaddrinfo", side_effect=socket.gaierror("secret-host-detail")):
            with self.assertRaises(PreflightFailure) as ctx:
                check_dns(APPROVED_HOST)
        self.assertEqual(str(ctx.exception), PreflightCode.DNS_FAILED.value)
        self.assertNotIn("secret-host-detail", str(ctx.exception))

    def test_dns_rejects_resolution_timeout_with_fixed_code(self):
        with patch("production_preflight.socket.getaddrinfo", side_effect=TimeoutError("secret-timeout-detail")):
            with self.assertRaises(PreflightFailure) as ctx:
                check_dns(APPROVED_HOST)
        self.assertEqual(str(ctx.exception), PreflightCode.DNS_FAILED.value)
        self.assertNotIn("secret-timeout-detail", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
