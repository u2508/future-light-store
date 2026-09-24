# VS Store Facebook + Instagram daily automation

This is a standalone social automation. It is deliberately not part of the
Shopify release graph and does not load the release environment. Every
successful run uses the same final image and caption for the VS Store Facebook
Page and the connected Instagram account `@vs.store2608`.

## Setup

Copy `.env.vs-store-social.example` to `.env.vs-store-social.local` and fill in
the Shopify values locally. For the normal route, configure
`VS_STORE_SOCIAL_PUBLISHER=meta-api-primary`, the exact VS Store Page ID, the
Page access token from the logged-in Meta developer session, and the verified
linked Instagram Business account ID. Do not paste passwords, OTPs, browser
cookies, or tokens into chat or commit the local file. The Page credential is
used for both Facebook and the linked Instagram account in the Facebook Login
flow; a separate Instagram token is optional.

Business Suite identity and browser profile values are retained for an
explicit `business-suite-browser` publisher configuration only. API mode never
switches transports automatically.

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
upload, publish, or mutate production data.

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

The bridge checks containment, real image type, decoded dimensions, size, SHA-256
hash, and matching fingerprint before any browser handoff. If Image Gen is
unavailable, the run remains paused and no local image renderer is substituted.

## Meta API primary execution

When the API preflight confirms the exact Page `VS Store` and connected
Instagram `@vs.store2608`, the runner publishes Facebook and Instagram through
the Graph API and verifies each platform independently. The API path keeps the
same Shopify live-catalog read, guarded Friday discount, Image Gen handoff,
image hash, usage ledger, durable lock, partial retry, and ambiguous-submit
recovery rules.

Instagram content publishing is only attempted after the Facebook publish
readback supplies a verified reusable image URL. This avoids requiring a
separate public-image-URL setting for normal generated creatives. If that
readback is unavailable after Facebook succeeds, the run is recorded as
ambiguous/needs-review rather than duplicated through the fallback.

The API cannot schedule an Instagram post for a future best-time slot. When a
slot is still in the future, the runner stores `waiting_for_publish_window`
and publishes through the API only when the due slot arrives. A failed
read-only preflight stores `waiting_for_setup`; it never creates a browser
handoff or publishes to only one platform. Browser publishing is available
only when `VS_STORE_SOCIAL_PUBLISHER=business-suite-browser` is explicitly
configured. An API run is never switched to the browser after a submit attempt
or ambiguous result.

To explicitly move an untouched pending browser handoff to API mode, use
`npm run social:daily:resume-api`. The command refuses the migration if a
browser submit intent, result, external-attempt journal entry, changed image,
or non-`not_started` platform state exists.

## Business Suite browser fallback

Meta Page and Instagram publishing are delivered through visible Business Suite
controls in the dedicated browser profile. The Node runner creates one frozen
request containing the same local image, caption, Page identity, Instagram
handle, offer snapshot, and hashes for both destinations. A browser worker must
record independent receipts for each platform; Facebook success does not imply
Instagram success.

Use the read-only setup commands:

```bash
npm run social:daily:browser-login
npm run social:daily:check-browser
npm run social:daily:status
```

`check-browser` stops on login, 2FA, CAPTCHA, consent, unexpected Page identity,
missing connected Instagram, or an unrecognized Business Suite UI. It never
opens a composer or clicks Publish. Live publishing is disabled by default with
`VS_STORE_SOCIAL_LIVE_ENABLED=0`; the normal run stops at durable
`waiting_for_browser` and writes `output/social/browser-request.json`.

After a separately verified browser interaction, validate and copy its result,
then reconcile it under the same lock:

```bash
node scripts/vs-store-social-browser-bridge.mjs \
  --write-result \
  --run-key YYYY-MM-DD \
  --fingerprint REQUEST_FINGERPRINT \
  --result-path /absolute/path/to/browser-result.json
npm run social:daily:resume-browser
```

When live mode is explicitly enabled for a real rollout, the browser worker
must record submit intent immediately before the one Publish click. This is a
durable guard against ambiguous clicks and duplicate retries; it is refused
while the example configuration keeps live mode disabled:

```bash
npm run social:daily:browser:write-intent -- \
  --run-key YYYY-MM-DD \
  --fingerprint REQUEST_FINGERPRINT \
  --attempt-id ATTEMPT_ID \
  --platforms facebook,instagram
```

If the intent exists without a verified result, `resume-browser` reports
`needs_review` and does not click or retry. A successful reconciliation archives
the redacted result and intent under the run directory before clearing their
compatibility pointers.

Timeout after a Publish click is recorded as `unknown`, not retried blindly.
Partial success keeps the successful receipt and retries only a conclusively
failed destination. `business-suite-browser` remains available as an explicit
browser-only mode.

## Automation behavior

The separate Codex scheduled task invokes `npm run social:daily`, resumes
`waiting_for_network` state, and reports only material failures, completion, or
required setup. Each request carries the selected best-time slot. In API mode,
if the slot is still in the future, the run remains durably waiting and makes
no submission; at the due time, the API publishes and verifies both
destinations. If the slot has passed, it publishes immediately and never
creates a retroactive schedule. Browser scheduling is used only when the
publisher is explicitly configured as `business-suite-browser`; action-time
confirmation is required immediately before a Schedule or Publish control is
activated in that mode.

Keep the Mac and Codex desktop app available for the local scheduled task and
Image Gen handoff.
