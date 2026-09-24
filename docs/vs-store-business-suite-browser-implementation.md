# VS Store Business Suite browser implementation map

This document maps the Business Suite migration proposal to the existing
standalone social runner. The social workflow remains outside the Shopify
release graph and release environment.

## Existing modules retained

| Responsibility         | Current module                                                                                    | Migration behavior                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily orchestration    | `scripts/run-vs-store-social-daily.mjs`                                                           | Keeps New York weekday rotation, Shopify catalog reads, guarded Friday offer flow, Image Gen pause/resume, usage history, and durable state. Meta API is primary; browser handoff is the guarded fallback. |
| Social configuration   | `scripts/lib/vs-store-social-config.mjs`                                                          | Loads only standalone social variables; accepts `meta-api-primary` with the verified Page/Instagram identity and keeps browser fallback settings available.                                                |
| Durable state and lock | `scripts/lib/vs-store-social-state.mjs`                                                           | State schema 5, shared output lock, heartbeat lease, append-only event/journal, historical usage and receipt preservation.                                                                                 |
| Shopify adapter        | `scripts/lib/vs-store-social-shopify.mjs`                                                         | Preserved for live catalog reads and guarded Friday discount create/update/readback.                                                                                                                       |
| Content and selection  | `scripts/lib/vs-store-social-content.mjs`, `scripts/lib/vs-store-social-copy.mjs`                 | Preserved; selection remains usage-aware and copy is frozen before handoff.                                                                                                                                |
| Image Gen handoff      | `scripts/vs-store-social-imagegen-bridge.mjs`, `scripts/lib/vs-store-social-image-validation.mjs` | Preserved; local image validation, containment, dimensions, fingerprint, and SHA-256 checks remain required.                                                                                               |

## Browser handoff modules

| Proposed capability                               | Implemented module                                                                                 | Boundary                                                                                                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account preflight and visible UI capability check | `scripts/lib/vs-store-social-business-suite-browser.mjs` and `scripts/vs-store-social-browser.mjs` | Opens a dedicated persistent Playwright profile, checks exact Page/Instagram identity, and stops on login, security checkpoint, missing identity, or unknown controls. Read-only preflight never opens a composer. |
| Versioned request and result contract             | `scripts/lib/vs-store-social-browser-result-schema.mjs`                                            | Freezes one local image and caption, binds hashes and destination identity, validates path containment, expiry, evidence, and independent platform receipts.                                                       |
| Durable browser request/result bridge             | `scripts/vs-store-social-browser-bridge.mjs`                                                       | Shows the request/steps, records submit intent before one Publish action, validates result files, and atomically installs the compatibility result pointer.                                                        |
| Independent verification and recovery             | `scripts/lib/vs-store-social-publish-reconciler.mjs`                                               | Produces `completed`, `partial_published`, `needs_review`, or `failed`; preserves a successful destination and allows only a conclusively failed destination on retry. Ambiguous submits remain paused.            |
| Read-only status                                  | `scripts/vs-store-social-status.mjs`                                                               | Reports redacted configuration, state, request, intent, result, and receipt summary without publishing.                                                                                                            |

The durable files live under the configured social output directory:

```text
output/social/
  vs-store-facebook-daily-state.json
  browser-request.json
  browser-intent.json
  browser-result.json
  publisher-journal.jsonl
  runs/YYYY-MM-DD/
    caption.txt
    offer.json
    browser-request.json
    browser-results/
```

The browser request can target both destinations for a first attempt or only
the missing destination on a known partial retry. A result for a timed-out
Publish click must be marked `unknown` and reconciled in Business Suite before
another submit is permitted.

## API-primary transport

`scripts/lib/vs-store-social-api-publisher.mjs` and the related Meta API
readback helpers are active for `VS_STORE_SOCIAL_PUBLISHER=meta-api-primary`.
The runner performs a read-only Page/Instagram preflight, publishes only when
the slot is due, and verifies Facebook and Instagram independently. A future
slot or preflight/setup failure before submission creates a Business Suite
request. An ambiguous or partial API attempt never falls back automatically,
which prevents duplicate posts. Browser-only mode still does not require a
Page access token or public image URL.

## Verification boundary

The implementation has local unit coverage and read-only API/browser checks.
No production test post was published during implementation. The exact Page
and connected Instagram identity were read back through the logged-in Meta
developer session; Business Suite remains the fallback preflight for the
durable browser handoff.

The current Sunday run remains preserved as a completed dual-platform history
entry. Re-running its date is a no-op and does not create another post.
