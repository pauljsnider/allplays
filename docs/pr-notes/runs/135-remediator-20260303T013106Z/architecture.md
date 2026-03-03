# Architecture Role Notes

## Current state
- Calendar ICS proxy function accepts any CORS origin and uses per-instance in-memory cache.
- URL normalization blocks localhost only, leaving internal IP range and metadata path bypasses.
- Client hardcodes a project-specific Cloud Function endpoint.

## Proposed state
- Function validates request origin against configured allowlist and rejects untrusted origins.
- Function removes in-memory caching and always fetches live ICS content.
- Function performs SSRF hardening by checking hostname/IP and DNS-resolved addresses for private/link-local ranges.
- Client resolves function URL from runtime configuration (`window.__ALLPLAYS_CONFIG__`, global override, or meta tag), avoiding hardcoded project endpoint.

## Risk and blast radius
- Main risk is misconfigured CORS allowlist causing browser calls to be rejected (intentional fail-closed).
- SSRF guard may reject malformed or non-resolvable hosts that previously passed.
- No schema or storage changes.
