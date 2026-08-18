# Future Light Store Release Runner

This repository now contains a copy of the catalog, SEO, metafield, price,
variant-image, taxonomy, collection, shuffle, publication, theme, and
live-readback scripts from the SALT release workflow.

## First-time setup

1. Copy `.env.release.example` to `.env.release.local`.
2. Set `SALT_SHOP_URL` to the Future Light Store Shopify domain.
3. Set `SHOPIFY_ADMIN_ACCESS_TOKEN`, or configure the Shopify CLI for that
   store. Do not copy the SALT admin token.
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

For the scheduled/full-catalog profile use `npm run release:daily`. To resume
an interrupted run use `npm run release:daily:resume`.

## Isolation guarantees

- The wrapper rejects the SALT Shopify hostname.
- Release telemetry is written only to this repository's `output/` directory.
- The Shopify theme defaults to `../future-light-store-shopify` and can be
  overridden with `SALT_SHOPIFY_THEME_DIR`.
- SALT `.env`, generated catalog data, output manifests, approval files, and
  Shopify theme files were not copied into this repository.
- Mobile Capacitor synchronization is disabled by default because this store
  does not contain the SALT iOS/Android shells.
