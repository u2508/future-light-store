# VS Store Meta Purchase tracking

The Vercel storefront owns catalog and cart interactions, while Shopify owns the
hosted checkout. A browser-only pixel cannot reliably observe a paid order after
the customer leaves the Vercel origin, so the Shopify `ORDERS_PAID` webhook now
sends one server-side Meta Conversions API `Purchase` event.

## Supabase secrets

Add these as Supabase Edge Function secrets. Never place the access token in the
Vite app, `.env.local`, Git, or a browser form:

- `META_CONVERSIONS_API_ACCESS_TOKEN` — the access token generated for Pixel
  `921792280984136` in Meta Events Manager.
- `META_PIXEL_ID` — optional; defaults to `921792280984136`.
- `META_GRAPH_VERSION` — optional; defaults to `v23.0`.
- `META_EVENT_SOURCE_URL` — optional; defaults to `https://vss-store.vercel.app/`.

After adding the secret, deploy the `shopify-webhook` Edge Function and keep the
existing Shopify `ORDERS_PAID` webhook subscription. No Shopify release or SALT
workflow is involved.

The event uses a stable `event_id` derived from the Shopify order ID, hashes the
checkout email server-side, and sends the verified order total, currency, line
items, and order ID. A missing Meta token never blocks Shopify order mirroring;
the webhook row is recorded as `processed_with_warnings` until the secret is
configured.

## Verification

Place a real or test order, then verify the corresponding `Purchase` event in
Meta Events Manager → Test Events / Diagnostics and the webhook event row in
Supabase. The dashboard warning will not clear retroactively; Meta needs a new
paid checkout after the fix.
