# VS Store marketing launch runbook

This runbook keeps the first US acquisition test small, measurable, and
reversible. Shopify is the catalog and order source of truth. Local generated
catalog files are not used as a runtime fallback.

## Read-only preparation

Run these commands from the storefront repository after loading the local
Shopify Admin credentials:

```sh
npm run marketing:cohort:audit
npm run marketing:cohort:review
npm run marketing:preflight
```

`marketing:cohort:audit` reads active products, variant prices, Shopify cost
and inventory, removes duplicate review candidates, flags obvious policy-risk
terms, and writes `output/marketing-cohort-audit.json`. The result is a
review shortlist only; it is not margin approval.

`marketing:cohort:review` turns that snapshot into
`output/marketing-cohort-review.md`, a handle-by-handle sign-off sheet. It
keeps Shopify cost evidence separate from the still-required supplier,
shipping, returns, landed-cost, policy, and operator approval checks.

After the live audit, generate a template containing the actual 12–18 candidate
handles:

```sh
npm run marketing:cohort:approval-template
```

Copy `output/marketing-cohort-approval-template.json` to
`docs/marketing-cohort-approval.json` only after the operator has verified the
manual evidence and filled every required flag. The template is intentionally
unapproved. Then run:

```sh
npm run marketing:cohort:approval-check
npm run marketing:google-feed:preview
npm run marketing:merchant-center:preview
npm run marketing:campaign:plan
```

The Merchant Center preview requires 12–18 explicitly approved handles,
fetches those products live from Shopify, rejects unknown inventory or missing
product URLs/images, and writes only a local XML preview. It never uploads a
feed or enables Google spend. Merchant Center shipping and product approval
remain separate launch gates.

`marketing:merchant-center:preview` is a separate read-only reconciliation
record. It compares the current Merchant Center shipping window with the
Shopify Admin rate, carries the Shopify refund-policy source, and records when
CPA is not calculable because paid-order, ad-spend, landed-cost, or refund
evidence is missing. It never saves a Merchant Center policy or shipping
service.

Merchant Center source read-back must remain Shopify-only. The current account
has two Shopify App API / Merchant API country feeds (United States and the
international country set); their item totals include variant and
country-scoped rows, so they must not be compared directly with the Shopify
product count. No manual or unknown source should be deleted without a fresh
source-level read-back and explicit approval.

Product pages in the Shopify theme also contain a request-time fallback inside
the React root: title, current variant, price, availability, a native
`/cart/add` form, shipping details, and return-policy structured data. The
normal React storefront replaces it on load. This keeps Google and customers
with delayed JavaScript from seeing an empty product shell, while still using
Shopify's live product record as the source of truth.

Copy `docs/marketing-launch-evidence.example.json` to
`docs/marketing-launch-evidence.json` and update it only with verified
milestones. The preflight reads this file for shipping/payment/returns, DSers
routing, test-order/refund, Meta/Google readback, and Merchant Center approval;
missing or partial evidence remains blocked.

`marketing:campaign:plan` writes a proposal-only budget and campaign
structure: one Meta Sales campaign at approximately ₹100/day and one Google
Shopping campaign at approximately ₹67/day. It never creates a campaign or
changes spend; use the strict preflight as the final launch guard.

After a campaign has run, assemble verified platform readback and Shopify
order/refund data in a local `docs/marketing-performance.json` file based on
`docs/marketing-performance.example.json`, then run:

```sh
npm run marketing:performance:report
```

The report applies the 14-day funnel rules per product and calculates CPA,
conversion rate, AOV, refund rate, and contribution after landed cost and ad
spend. It is read-only: `scale-next-cycle` and `pause-product` are operator
recommendations only, and the report never changes a budget, campaign, or
Shopify record. Before 14 complete days it returns `observe-until-14-days` for
every product so an early signal cannot trigger a budget change.

`marketing:preflight` writes
`output/marketing-launch-preflight.json`. It checks the live product count,
the three launch collections, canonical policy status, Shopify webhook state,
order-read permission, tracking configuration, and the cohort approval file.
It also records whether a `shopify.app.toml` exists in this storefront or its
parent directory. This repository currently uses saved Shopify CLI store auth,
not a local app configuration; request `read_orders` and `read_markets` in the
Shopify app/Partner configuration before retrying the preflight.

The strict form is a release guard:

```sh
npm run marketing:preflight:strict
```

It exits non-zero while any launch gate is blocked. No ad-enablement job should
run unless this command passes after the manual gates below are documented.
The webhook gate also requires `SHOPIFY_WEBHOOK_SECRET` to be present in the
launch environment; the Edge Function rejects unsigned Shopify deliveries.

## Manual evidence required before spending

For each 12–18 approved handles, record:

- supplier and DSers mapping, supplier stock, and the US delivery estimate;
- product-specific title, description, compatibility notes, and returns path;
- selling price, landed cost, payment fee, shipping cost, refund reserve, and
  allowable CPA;
- confirmation that the product is suitable for Meta and Google policy;
- operator approval of the exact handle.

Keep the first live test to one Meta Sales campaign at about ₹100/day and one
Google Shopping campaign at about ₹67/day. Test only 3–5 approved products at
a time. Do not spread the budget across TikTok or multiple campaigns.

## Tracking and order reconciliation

The storefront emits product view, collection view, search, add-to-cart,
begin-checkout, sign-up, and email-signup events. UTM and click-id values are
copied into the Shopify cart attributes so a paid order can be reconciled after
hosted checkout. Purchase remains server-side: Shopify `ORDERS_PAID` is the
source event for Meta Conversions API and the internal order ledger.

The webhook can also emit an optional GA4 purchase event when the two
server-only Measurement Protocol secrets are configured. Treat Google Ads
conversion readback as a separate verification step; a successful HTTP send is
not proof that an Ads conversion was imported.

Before ads go live, verify a controlled checkout/order in Shopify, read back
the webhook event, and confirm Meta Purchase plus Google conversion data. Do
not treat a browser-side purchase event as proof of payment.

## Organic social acquisition track

The standalone daily VS Store social runner is an additional acquisition
source, not a replacement for the paid-campaign gates above. It keeps the
Shopify catalog read, guarded Friday discount, Image Gen handoff, New York
weekday rotation, and usage history. Meta delivery uses the authenticated
Business Suite browser handoff only; the old direct API and public-image-URL
path are retired.

The browser workflow verifies the exact VS Store Page and connected Instagram
identity before composing, freezes one image and caption for both platforms,
records submit intent before a single Publish action, and verifies Facebook and
Instagram independently. A partial or ambiguous result remains visible in
durable state and is not blindly reposted.

Read-only/setup commands:

```sh
npm run social:daily:check-config
npm run social:daily:check-browser
npm run social:daily:status
```

No production test post is part of implementation. The dedicated browser
profile must be authenticated interactively before its account preflight can
pass; live mode should remain disabled until that preflight, the browser result
contract, and the rollout approval are complete. This social workflow does not
enter the Shopify release graph or load the release environment.

## Retention app inventory (read-only)

The Shopify Admin app inventory was checked on 2026-09-21 without opening or
changing any workflow. The following installed apps can support Phase 5, but
their customer-facing automations remain disabled/pending until consent,
order-state, and test-checkout evidence are verified:

- Wava Carts: abandoned-cart recovery over WhatsApp; the installed app page
  reports zero active extensions, so no active recovery flow is claimed.
- Shopify Messaging: email, SMS, and WhatsApp marketing capability is
  installed; no campaign or automation was enabled during the audit.
- Shopify Flow: installed and available for event-driven automation; no flow
  was created or enabled during the audit.
- WorkflowMail Emails: installed for transactional email actions; welcome,
  browse-abandon, and post-purchase flows still require explicit configuration
  and read-back.
- Judge.me Reviews: installed with one active extension and order/customer
  access; review requests remain pending until a real delivered order exists.

Activation gates for these apps are separate from ad launch: verify the
Shopify order lifecycle, customer consent/marketing eligibility, refund and
support handling, and one controlled test order before enabling any message or
review automation. Never send a customer-facing test message to production as
part of this implementation.

The exact trigger, timing, consent, suppression, and activation checklist is
captured in [marketing-retention-flow-plan.md](./marketing-retention-flow-plan.md).

## Guardrails

- Never add products through DSers while the plan capacity is full.
- Never enable spend when the strict preflight is blocked.
- Do not claim “Best Sellers” until paid-order evidence exists; use curated
  wording in customer-facing copy until then.
- Do not use fake scarcity, fake reviews, unsupported discount claims, or
  automatic budget increases after a no-conversion window.
- Evaluate the first 14 days by the planned click → view → add-to-cart →
  checkout → purchase funnel, CPA, AOV, gross margin, and refunds.
