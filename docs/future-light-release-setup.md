# Future Light Store Release Runner

This repository now contains a copy of the catalog, SEO, metafield, price,
variant-image, taxonomy, collection, shuffle, publication, theme, and
live-readback scripts from the SALT release workflow.

## First-time setup

1. Copy `.env.release.example` to `.env.release.local`.
2. Set `SALT_SHOP_URL` to the Future Light Store Shopify domain.
3. Set `SHOPIFY_ADMIN_ACCESS_TOKEN`, or configure the Shopify CLI for that
   store. Do not copy the SALT admin token.
   If the category-metafield dry run reports evidence-backed candidates, the
   authenticated app also needs Shopify `read_metaobjects` and
   `write_metaobjects`. The apply remains guarded until that scope and this
   Future-Light-specific flag are present:

   ```text
   FUTURE_LIGHT_CATEGORY_METAOBJECTS_APPROVED=1
   ```
4. Review and replace the pending approval manifests in `docs/` with
   Future-Light-specific approved manifests. The runner intentionally refuses
   to use SALT approval IDs or a pending manifest for live writes.
5. Fetch the new store catalog and build its local knowledge artifacts:

   ```sh
   set -a
   source .env.release.local
   set +a
   npm run sync:data
   npm run catalog:knowledge:model:train
   npm run catalog:artifacts
   ```

   With Shopify CLI auth and a password-protected storefront, keep
   `SALT_SHOPIFY_SYNC_ACTIVE_CATALOG=1` and
   `SALT_SHOPIFY_USE_CLI_ADMIN_PRICING=1` enabled so catalog and pricing reads
   use the authenticated Admin GraphQL session instead of public JSON feeds.
   The local release profile uses `SALT_RECENTLY_ORDERED_PRODUCT_MINIMUM=100`
   because this new store has no order history yet; the template default remains
   300 for established stores.

6. Run a release only after the approval gates are updated:

   ```sh
   npm run release
   ```

The release interface intentionally has only two commands:

```sh
npm run release
npm run release --resume
```

`release` runs the full Future Light Store daily profile and automatically
continues a matching failed/interrupted run from its last guarded step. Use
`npm run release --resume` when you explicitly want persisted resume behavior. The
older `release:daily` and `release:daily:resume` names remain only as
backward-compatible automation aliases. `npm run release --fresh` is an
emergency step-1 reset for after the release graph has been reviewed.

The runner applies bounded request concurrency, retry backoff, and local
in-flight request reuse automatically. You can tune the limits with
`SALT_SHOPIFY_REQUEST_CONCURRENCY`, `SALT_SHOPIFY_REQUEST_DELAY_MS`, and the
existing per-workflow concurrency variables without changing the release
ordering or its live-readback gates.

### Network and DNS resilience

Release-level transport failures are handled separately from catalog or
validation failures. If a guarded remote step reports a DNS, timeout, socket,
rate-limit, or transient Shopify service error, the runner records
`waiting_for_network` in `output/release-run-state.json`, probes the configured
Future Light store, and keeps polling until connectivity returns. It then
retries the same guarded step, so partially completed writes remain protected
by that step's existing manifests and live readback. A process restart also
recognizes `waiting_for_network` as resumable.

The default probe interval is 30 seconds. Optional local tuning variables are
`SALT_RELEASE_NETWORK_POLL_MS`, `SALT_RELEASE_NETWORK_PROBE_TIMEOUT_MS`,
`SALT_RELEASE_NETWORK_FAILURE_BACKOFF_MS`, and
`SALT_RELEASE_NETWORK_FAILURE_BACKOFF_MAX_MS`. Non-network failures still stop
and remain visible as `failed`; use `npm run release --resume` after the issue
is corrected rather than silently retrying a real data, approval, build, or
readback failure.

### Cost-based pricing

The approved pricing stage reads each live variant's Shopify inventory cost and
calculates its retail price independently. It adds the approved $16 overhead to
each cost-band retail target, preserves variant differences, and normalizes only existing
compare-at prices. The full-catalog audit and live readback cover every active
variant, including variants that did not need a mutation. The same-product
alignment stage uses this same target and proposes zero flattening edits when
the pricing stage is complete.

### Low-stock product removal

The release now audits active products against live `Product.totalInventory`,
validates the total against every tracked variant quantity, and holds products
with unmeasurable inventory. Products below `FUTURE_LIGHT_LOW_STOCK_THRESHOLD`
(default `200`) are only deleted after a fresh pre-delete read, asynchronous
delete completion, and post-delete live readback. Draft, archived, untracked,
truncated, and mismatched-inventory products are not deleted.

The apply stage is approval-gated and requires both conditions below:

1. Review the dry-run manifest at
   `output/shopify-low-stock-product-delete-manifest.json`.
2. Update `docs/catalog-low-stock-removal-approval.json` to the exact approved
   scope and set `FUTURE_LIGHT_LOW_STOCK_DELETE_APPROVED=1` in
   `.env.release.local`.

If the approval manifest is pending, the release stops at this gate and will not
silently delete products. Once both conditions are approved, the next release
that reaches the apply stage can permanently delete the audited candidates; do
not start that stage when you only want to audit.

### Missing-cost product removal

Before cost-based pricing, the release audits the complete Shopify product
catalog. A product is a candidate when any variant has a missing or invalid
`inventoryItem.unitCost.amount`. The apply stage permanently deletes the whole
product only after a fresh pre-delete read confirms the same condition,
Shopify's asynchronous delete operation completes, and a post-delete live read
confirms the product is absent. Draft, archived, and active products are all in
scope because the pricing gate audits the complete catalog.

The apply stage requires the explicit Future-Light approval manifest at
`docs/catalog-missing-cost-product-removal-approval.json` and these matching
local settings:

```text
FUTURE_LIGHT_MISSING_COST_DELETE_APPROVED=1
FUTURE_LIGHT_MISSING_COST_DELETE_APPROVAL_ID=future-light-store-missing-cost-product-removal-approved-2026-09-07
```

The dry-run and live-delete manifests are written to
`output/shopify-missing-cost-product-delete-manifest.json`. The release stops
if any deletion fails or if live verification finds a product still present.

The release keeps the visual classification queue at
`output/catalog-visual-review-queue.json` and waits for image decisions rather
than completing with unresolved products. After decisions are recorded in the
taxonomy image overrides, the guarded integrity step resumes; completion is
allowed only when `classificationReviewRemaining` is zero.

## Isolation guarantees

- The wrapper rejects the SALT Shopify hostname.
- Release telemetry is written only to this repository's `output/` directory.
- The Shopify theme defaults to `../future-light-store-shopify` and can be
  overridden with `SALT_SHOPIFY_THEME_DIR`.
- SALT `.env`, generated catalog data, output manifests, approval files, and
  Shopify theme files were not copied into this repository.
- Mobile Capacitor synchronization is disabled by default because this store
  does not contain the SALT iOS/Android shells.
