# VS Store commerce launch

## Operating model: India seller, US market

- Legal seller and Shopify business location: VS Polymers, India.
- Customer-facing brand: VS Store.
- Target market and primary launch market: United States.
- Storefront market currency: USD; India remains the legal and settlement base.
- Payout destination: the approved Indian business bank account and payment provider.
- Fulfillment: India-to-US shipping or a verified US-based 3PL; do not add a US address unless it is a real business or fulfillment address.
- Shopify Markets should control US availability, USD pricing, localization, and product availability from this single store.

The registered entity may appear where legally required—policies, invoices, tax documents, and business contact information—but must not be used as customer-facing merchandising or product branding.

### India export readiness

Confirm with the company CA/export advisor before accepting live orders:

- GSTIN, company PAN, current account, and IEC where required for the goods/export route.
- LUT versus IGST-paid export treatment.
- Export invoice, packing list, shipping bill/courier export documentation, HSN code, and country of origin.
- Bank export-realisation records and reconciliation between Shopify, the payment provider, and the Indian books.

### US-market decisions still required

- Payment provider approval for international cards, settlement currency, refunds, and chargebacks.
- India-to-US shipping rates and service levels, including the US returns address/process.
- DDP versus DDU/DAP duty handling.
- Product-level HS codes and country-of-origin data.
- US sales-tax/nexus review with a qualified US tax advisor, especially before using US inventory or a 3PL.

## Shopify plan

The store is currently on Shopify trial. Select the Basic plan after confirming monthly versus yearly billing and the payment method with the store owner. The storefront uses USD for the initial US market; the subscription currency and the customer-facing market currency are separate settings. Shopify currently reports the Headless channel as unavailable while the store remains on trial.

## DSers

1. Install **DSers: Dropship+AliExpress+AI** from the Shopify App Store.
2. Approve the requested Shopify permissions for the VS store.
3. Connect the owner’s DSers account and AliExpress, Alibaba, or approved US supplier account.
4. Set US shipping, supplier mapping, pricing rules, stock sync, and order-routing rules before publishing additional products.
5. Place a test order only after the payment, shipping, returns, and supplier workflow are reviewed.

The catalog import does not include orders, refunds, transactions, customers, inventory quantities, locations, or payment data. DSers should be the source of truth for future supplier mapping and fulfillment synchronization.

## Shop

Add the Shop sales channel from Shopify admin only after reviewing eligibility for an India-based business. Keep the Online Store channel active, remove the storefront password before launch, and verify that the VS refund/shipping/terms policies are published. If Shopify continues to mark Shop unavailable, do not substitute a false US address; use the channel only if the real business setup becomes eligible.

## TikTok

Install the TikTok sales channel only if Shopify marks the India-based store eligible. Connect the owner’s TikTok for Business account, Business Center, and Ads Manager, then create or select the Pixel and choose the approved data-sharing level. Let the channel create the catalog from the US market and resolve product-policy issues before advertising. TikTok Ads and TikTok Shop eligibility are separate from the store’s ability to sell to US customers through Shopify Markets.

The custom storefront has an optional pixel loader. Set `VITE_TIKTOK_PIXEL_ID` only after the Shopify TikTok channel has created or connected the real pixel. Leaving it blank keeps the loader disabled.

## Final launch checks

- Confirm the Basic plan, payment provider, and US market settings.
- Confirm the storefront catalog is published and visible through the Storefront API.
- Confirm DSers supplier mapping and a shipping-rate test.
- Confirm Shop and TikTok product approval status.
- Test product view, variant selection, add-to-bag, checkout handoff, and policy links in Firefox and mobile view.
