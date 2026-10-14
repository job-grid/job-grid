/*
 * Browser-safe configuration for the Job Grid public website.
 *
 * This file intentionally contains only a public project URL and a Supabase
 * publishable key. Publishable keys are designed to be visible in browsers;
 * Row Level Security and table grants control what they can read.
 *
 * NEVER put an sb_secret_ key, service-role key, password, or private token here.
 */
export const SUPABASE_URL = "https://tnrdovdhlwitjzecduxa.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_OzsMC9pLncvrpqleMYGovA_XGsAy0qg";
