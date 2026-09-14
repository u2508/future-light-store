# VS Store Facebook daily automation

This is a standalone social automation. It is deliberately not part of the
Shopify release graph and does not load the release environment.

## Setup

Copy `.env.vs-store-social.example` to `.env.vs-store-social.local` and fill in
the Future Light Shopify Admin and Meta Page values locally. Do not paste tokens
into chat or commit the local file. The Shopify credential must be able to read
products, collections, variants, and inventory costs, and create code discounts.

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
product → collection → welcome-banner rotation, verifies copy against catalog
evidence, and allows at most one successful offer in a rolling seven-day
window. The highest safe discount is 15%; missing costs or an unsafe margin
skip the offer. Live posts require a Codex Image Gen creative. Dry-run only
prepares and reports the Image Gen references; it does not call a local image
renderer or publish anything.

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

When the API path cannot publish or create a safe discount, the runner writes
`output/social/browser-fallback-request.json` and enters `waiting_for_browser`.
The Codex automation should use the authenticated internal browser only, follow
the request actions, and never change ads, spend, Instagram, Threads, or theme
settings.

After the internal-browser flow has verified the Facebook post and, when
requested, the Shopify discount, write the result through the bridge. Record
the exact final caption when practical so the runner can reject unresolved
offer placeholders and raw catalog labels:

```bash
node scripts/vs-store-social-browser-bridge.mjs --write-result \
  --run-key YYYY-MM-DD \
  --fingerprint PENDING_FINGERPRINT \
  --post-id VERIFIED_POST_ID \
  --post-url VERIFIED_POST_URL \
  --post-caption "EXACT_FINAL_CAPTION" \
  --discount-id VERIFIED_DISCOUNT_ID \
  --discount-code VERIFIED_CODE \
  --discount-percent 10
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
