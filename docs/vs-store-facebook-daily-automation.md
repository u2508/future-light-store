# VS Store Facebook + Instagram daily automation

This is a standalone social automation. It is deliberately not part of the
Shopify release graph and does not load the release environment. Every
successful run uses the same final image and caption for the VS Store Facebook
Page and the connected Instagram account `@vs.store2608`.

## Setup

Copy `.env.vs-store-social.example` to `.env.vs-store-social.local` and fill in
the Future Light Shopify and Meta Page values locally. Do not paste tokens into
chat or commit the local file. Shopify can use either a token with permission to
read products, collections, variants, and inventory costs and create code
discounts, or an authenticated Shopify CLI session.

For CLI-backed Shopify access, set:

```bash
FUTURE_LIGHT_SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
FUTURE_LIGHT_SHOPIFY_USE_CLI=1
FUTURE_LIGHT_SHOPIFY_CLI_BINARY=shopify
```

The runner then uses `shopify store execute` for catalog reads and guarded
Friday discount create/update/readback. Authenticate the store once with
`shopify store auth`; the runner does not copy a CLI token into the social
environment.

Check the safe, redacted configuration with:

```bash
npm run social:daily:check-config
```

Preview the selected content, copy, image, audience timing, and offer decision
without publishing or creating a discount:

```bash
npm run social:daily:dry-run
```

Run one daily cycle:

```bash
npm run social:daily
```

The runner writes durable state and logs to `output/social/`. It uses the
America/New_York weekday schedule:

- Friday: heartfelt VS Store banner with the weekend sale
- Saturday: collection showcase
- Sunday: different collection showcase
- Monday: product showcase
- Tuesday: Friday-sale teaser banner
- Wednesday: different product showcase
- Thursday: different collection showcase

Products and collections are selected from active, published, in-stock,
image-backed catalog entries. A persistent usage ledger prevents reuse while
an eligible never-used item remains and avoids repeats within the same week
when alternatives exist.

Friday reconciles the storewide `VSSTORE15` code for 15% off. If the 15%
margin gate fails, it tries `VSSTORE10` at 10%. Both options use the $16
overhead and $10 minimum contribution floor. Missing costs, unsafe margins,
unmanaged code conflicts, or failed readback skip the coupon while allowing
the heartfelt post to continue without a discount claim. A verified coupon
runs from Friday 00:00 through Monday 00:00 in America/New_York, is limited
to one use per customer, and cannot stack.

Live posts require a Codex Image Gen creative. Dry-run only prepares and
reports the Image Gen references; it does not call a local image renderer or
publish anything.

## Image Gen handoff

When a live cycle needs a creative, it writes
`output/social/imagegen-request.json` and enters `waiting_for_imagegen`. The
separate Codex automation reads the request, calls the Image Gen tool with all
listed local references, inspects the generated image, and copies the result
to the requested `outputPath` while leaving the original generated file intact.
It then records the verified file:

```bash
node scripts/vs-store-social-imagegen-bridge.mjs --write-result \
  --run-key YYYY-MM-DD \
  --fingerprint IMAGEGEN_FINGERPRINT \
  --image-path /absolute/path/to/output/social/assets/YYYY-MM-DD/imagegen-post.png
npm run social:daily:resume-imagegen
```

The bridge accepts only an image path, run key, and fingerprint. The runner
checks the path, file type, size, and matching fingerprint before any Meta or
browser publish step. If Image Gen is unavailable, the run remains paused and
no local image renderer is substituted.

## Internal-browser fallback

When the API path cannot publish both destinations, cannot schedule the exact
same local creative for Instagram, or cannot create a safe discount, the runner writes
`output/social/browser-fallback-request.json` and enters `waiting_for_browser`.
The Codex automation should use the authenticated internal browser only, follow
the request actions, and never change ads, spend, campaigns, Threads, SALT, or
theme settings.

After the internal-browser flow has verified both the Facebook post and the
connected Instagram post, plus the Shopify discount when requested, write the
result through the bridge. Record the exact final caption when practical so the
runner can reject unresolved offer placeholders and raw catalog labels:

```bash
node scripts/vs-store-social-browser-bridge.mjs --write-result \
  --run-key YYYY-MM-DD \
  --fingerprint PENDING_FINGERPRINT \
  --post-id VERIFIED_POST_ID \
  --post-url VERIFIED_POST_URL \
  --post-caption "EXACT_FINAL_CAPTION" \
  --instagram-post-id VERIFIED_INSTAGRAM_POST_ID \
  --instagram-post-url VERIFIED_INSTAGRAM_POST_URL \
  --instagram-post-caption "EXACT_FINAL_CAPTION" \
  --discount-id VERIFIED_DISCOUNT_ID \
  --discount-code VERIFIED_CODE \
  --discount-percent 15 \
  --discount-starts-at 2026-09-18T04:00:00.000Z \
  --discount-ends-at 2026-09-21T04:00:00.000Z \
  --discount-target-type all \
  --discount-all-items \
  --discount-applies-once \
  --discount-no-stacking
npm run social:daily:resume-browser
```

If the weekly offer was not created, remove the entire offer paragraph from the
caption, use `--skip-offer` with the bridge, and resume the verified normal
post. The bridge accepts identifiers only; it never accepts or prints access
tokens.

## Automation behavior

The separate Codex scheduled task invokes `npm run social:daily`, resumes
`waiting_for_network` and `waiting_for_browser` state, and reports only
material failures, completion, or required setup. Keep the Mac and Codex
desktop app available for local scheduled runs and internal-browser fallback.
