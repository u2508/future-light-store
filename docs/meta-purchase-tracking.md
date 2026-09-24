# VS Store Meta Purchase tracking

The Vercel storefront owns catalog and cart interactions, while Shopify owns the
hosted checkout. A browser-only pixel cannot reliably observe a paid order after
the customer leaves the Vercel origin, so the Shopify `ORDERS_PAID` webhook now
sends one server-side Meta Conversions API `Purchase` event.

## Supabase secrets

Add these as Supabase Edge Function secrets. Never place the access token in the
Vite app, `.env.local`, Git, or a browser form:

- `SHOPIFY_WEBHOOK_SECRET` — the Shopify app/client secret used to verify the
  `X-Shopify-Hmac-SHA256` signature on the raw webhook body. The webhook rejects
  unsigned or invalid deliveries before reading the JSON payload.
- `META_CONVERSIONS_API_ACCESS_TOKEN` — the access token generated for Pixel
  `921792280984136` in Meta Events Manager.
- `META_PIXEL_ID` — optional; defaults to `921792280984136`.
- `META_GRAPH_VERSION` — optional; defaults to `v23.0`.
- `META_EVENT_SOURCE_URL` — optional; defaults to `https://vss-store.vercel.app/`.

After adding the secret, deploy both `shopify-webhook` and `shopify-admin` Edge
Functions. The authenticated admin action that registers the bounded order,
refund, and dispute topics refuses to run until the same HMAC secret is
configured. No Shopify release or SALT workflow is involved.

The event uses a stable `event_id` derived from the Shopify order ID, hashes the
checkout email server-side, and sends the verified order total, currency, line
items, and order ID. A missing Meta token never blocks Shopify order mirroring;
the webhook row is recorded as `processed_with_warnings` until the secret is
configured.

Webhook deliveries also claim a durable receipt keyed by topic and Shopify
order ID. A completed receipt is acknowledged as a duplicate, concurrent work
returns a retryable response, and transient Shopify/Supabase failures return a
5xx so Shopify can retry. The receipt migration must be applied before the
updated function is deployed; no duplicate Shopify order or Meta event is
created by a retry.

The storefront also copies bounded `utm_*`, `gclid`, and `fbclid` values into
Shopify cart attributes. The `marketing_attribution` order field stores those
values for first-party campaign reconciliation after hosted checkout; it does
not store customer PII. Apply the matching Supabase migration before deploying
the updated webhook function.

When `GOOGLE_ANALYTICS_MEASUREMENT_ID` and
`GOOGLE_ANALYTICS_API_SECRET` are configured as server-only Supabase secrets,
the same verified `ORDERS_PAID` webhook sends an optional GA4 `purchase` event.
The storefront carries only the bounded GA client ID when available; otherwise
the server uses a deterministic order-scoped client ID. This does not replace
the required Google Ads conversion readback and Merchant Center live test.

## Verification

Place a real or test order, then verify the corresponding `Purchase` event in
Meta Events Manager → Test Events / Diagnostics and the webhook event row in
Supabase. The dashboard warning will not clear retroactively; Meta needs a new
paid checkout after the fix.
