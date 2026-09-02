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

### Cost-based pricing

The approved pricing stage reads each live variant's Shopify inventory cost and
calculates its retail price independently. It applies the approved overhead
and cost bands, preserves variant differences, and normalizes only existing
compare-at prices. The full-catalog audit and live readback cover every active
variant, including variants that did not need a mutation. The same-product
alignment stage uses this same target and proposes zero flattening edits when
the pricing stage is complete.

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
