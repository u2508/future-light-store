# VS Store retention flow plan

This is a configuration blueprint, not an activation record. It keeps
customer messaging reversible, consent-aware, and dependent on verified
Shopify order states. No production message is sent by this document.

## Installed app mapping

Read-only Shopify Admin inspection on 2026-09-21 found:

- WorkflowMail Emails: transactional email actions.
- Shopify Messaging: email, SMS, and WhatsApp marketing capability.
- Shopify Flow: event-driven automation.
- Wava Carts: abandoned-cart WhatsApp recovery; the installed app page showed
  zero active extensions.
- Judge.me Reviews: one active extension for review display/collection.

## Flows

| Flow            | Trigger and timing                                                     | Channel             | Required guards                                                             | Status                             |
| --------------- | ---------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| Welcome         | Confirmed email signup; one message immediately                        | Email               | Marketing consent, unsubscribe link, no unapproved discount claim           | Pending configuration              |
| Browse abandon  | Product view with no add-to-cart after 4 hours; one reminder in 7 days | Email               | Consent, product still active, no purchase, no fake scarcity                | Pending configuration              |
| Abandoned cart  | Cart/checkout abandoned; maximum two reminders at 2 and 24 hours       | Email or WhatsApp   | Channel opt-in, current price/shipping re-check, suppress after order       | Pending configuration              |
| Order follow-up | `ORDERS_PAID`, then fulfillment/tracking state changes                 | Transactional email | Shopify order source of truth, verified tracking URL, support/refund path   | Blocked until webhook/test order   |
| Review request  | Delivered order plus a post-delivery delay                             | Judge.me email      | Real delivered order, one request per order, no fabricated review or rating | Blocked until delivered test order |

## Message constraints

- Do not promise a delivery date or returns destination that Shopify and the
  verified policy evidence do not support.
- Do not use blanket discount language, fake low-stock claims, or unsupported
  “best seller” claims. Customer-facing collection wording stays “Curated
  Picks” until paid-order evidence exists.
- Every marketing message needs a working unsubscribe/consent path and must
  respect US customer quiet hours.
- A Shopify order, refund, fulfillment, or customer opt-out event must suppress
  any pending message before it is sent.
- Test messages stay in preview/draft mode; implementation must not send a
  production test message.

## Activation checklist

- [ ] Confirm the US returns address/destination and publish the final policy.
- [ ] Confirm Shopify order-read access and apply the webhook receipt migration.
- [ ] Deploy and verify the signed `ORDERS_PAID`/fulfillment webhook.
- [ ] Complete one controlled checkout, DSers handoff, tracking, and refund.
- [ ] Confirm consent and unsubscribe behavior in the selected app.
- [ ] Configure each flow in draft/preview mode and read back the suppression
      rules before enabling it.
