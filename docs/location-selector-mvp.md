# Job Grid location-selector MVP

## What this branch adds

A responsive, keyboard-accessible location-selector preview to the static Job Grid homepage. It lets the user choose a country, search for a populated place or administrative area scoped to that country, and select a result. Available parent labels (admin1–admin4) are shown when supplied; a missing administrative level is allowed and does not break a lookup.

The picker is a **frontend preview only**. It does not save a candidate profile, create a database table, change an API, import a catalog or deploy to production.

## Bundled country fallback

A bundled, sorted JSON country-name/code list of **249 entries** is included in `public/data/countries.en.json` so the country dropdown can still offer a broad list when the remote country endpoint is unavailable. It was captured on 2026-10-12 from [umpirsky/country-list commit `bd490a163ae4709bbe4b54c4f638f24e032828d2`](https://github.com/umpirsky/country-list/commit/bd490a163ae4709bbe4b54c4f638f24e032828d2), source file [`data/en/country.json`](https://github.com/umpirsky/country-list/blob/bd490a163ae4709bbe4b54c4f638f24e032828d2/data/en/country.json), provided under the MIT License. The license notice is shipped at `public/data/COPYING-country-list.txt`.

This file is a **country picker fallback only**. It is not treated as a newly approved ISO authority snapshot, and its entries do not establish sovereignty, legal status, employment eligibility or operational geography completeness. The place-search provider is still needed for city/town suggestions.

## Current provider adapter

- Country labels are loaded from the REST Countries public endpoint.
- Place suggestions use the Open-Meteo Geocoding API, which documents the `countryCode` parameter and uses GeoNames-derived location data.
- The request is constrained by the selected country code; results are filtered again client-side. This protects users from similarly named towns in other countries.
- A limited fallback list is provided if the country-list service is unavailable. The interface explicitly says it is only a fallback rather than silently claiming that it is the full list.
- User-visible remote strings are escaped before insertion into the page. Search requests are debounced and stale responses are discarded.

## Selection event contract

When a user selects a result, the component emits a bubbling `job-grid-location-selected` custom event. The versioned `detail` payload contains:
- a selected country code and display name;
- provider name and provider ID (not an internal Job Grid place ID);
- place name, feature code/type and available administrative labels;
- coordinates when both are available; and
- a display label for presentation.

The payload is rejected by the helper when the selected place's country does not match the selected country. Missing admin levels stay omitted. This makes the preview consumable by a future profile/search form without claiming the selection was saved. A backend integration must validate country and provider IDs server-side, resolve them to internal catalog identities and handle provider-data changes.

## Before commercial release

Treat these public services as **preview adapters**, not an approved production data contract. Review the provider's current commercial usage terms, rate limits, attribution requirements, uptime and data-refresh guarantees. Replace the adapters with an approved licensed/self-hosted data source or a controlled server-side catalog as needed. Do not store these provider codes as verified internal/ISO identities simply because they were returned by an API.

## Follow-on implementation

1. Approve a data provider and durable country/place schema.
2. Implement candidate-profile persistence and country-aware search through the approved backend.
3. Add CI integration tests for provider normalization and manual/contract tests against verified Kenya and Japan fixtures.
4. Import only reviewed operational records; unresolved parents remain unresolved and do not block countries whose identity and place type are supported.
5. Do not run database migrations/imports or deploy this preview without separate authorization.
