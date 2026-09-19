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
API publish step. If Image Gen is unavailable, the run remains paused and
no local image renderer is substituted.

## API-only execution

The social runner has no authenticated-browser fallback. Meta Page and
Instagram publishing, Shopify catalog reads, and guarded discount creation must
complete through their configured APIs. A missing permission, missing linked
Instagram account, missing public image URL, or non-network API failure stops
the run with a durable `failed` state; it never silently changes the post,
creates a duplicate, or asks the browser to finish it. DNS, timeout, and rate
limit failures remain in the durable `waiting_for_network` state and are
retried with backoff.

## Automation behavior

The separate Codex scheduled task invokes `npm run social:daily`, resumes
`waiting_for_network` state, and reports only material failures, completion, or
required setup. Keep the Mac and Codex desktop app available for the local
scheduled task and Image Gen handoff.
