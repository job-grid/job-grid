/*
 * Public runtime configuration for the static Job Grid website.
 *
 * Only publishable/public values belong here. Never place a Supabase service-role
 * key, database password, private token, or other secret in this file.
 *
 * The portal stays safely disabled until an owner-approved Supabase URL,
 * publishable key, and approved authentication adapter are configured.
 */
window.JOB_GRID_CONFIG = Object.freeze({
  supabaseUrl: "",
  publishableKey: "",
  closeFunctionUrl: "",
});
