# Job Grid location-selector MVP

## What this branch adds

A responsive, keyboard-accessible location-selector preview to the static Job Grid homepage. It lets the user choose a country, search for a populated place or administrative area scoped to that country, and select a result. Available parent labels (admin1–admin4) are shown when supplied; a missing administrative level is allowed and does not break a lookup.

The picker is a **frontend preview only**. It does not save a candidate profile, create a database table, change an API, import a catalog or deploy to production.

## Current provider adapter

- Country labels are loaded from the REST Countries public endpoint.
- Place suggestions use the Open-Meteo Geocoding API, which documents the `countryCode` parameter and uses GeoNames-derived location data.
- The request is constrained by the selected country code; results are filtered again client-side. This protects users from similarly named towns in other countries.
- A limited fallback list is provided if the country-list service is unavailable. The interface explicitly says it is only a fallback rather than silently claiming that it is the full list.
- User-visible remote strings are escaped before insertion into the page. Search requests are debounced and stale responses are discarded.

## Before commercial release

Treat these public services as **preview adapters**, not an approved production data contract. Review the provider's current commercial usage terms, rate limits, attribution requirements, uptime and data-refresh guarantees. Replace the adapters with an approved licensed/self-hosted data source or a controlled server-side catalog as needed. Do not store these provider codes as verified internal/ISO identities simply because they were returned by an API.

## Follow-on implementation

1. Approve a data provider and durable country/place schema.
2. Implement candidate-profile persistence and country-aware search through the approved backend.
3. Add CI integration tests for provider normalization and manual/contract tests against verified Kenya and Japan fixtures.
4. Import only reviewed operational records; unresolved parents remain unresolved and do not block countries whose identity and place type are supported.
5. Do not run database migrations/imports or deploy this preview without separate authorization.
