-- Phase 0 security remediation: make rls_auto_enable internal-only.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role;
