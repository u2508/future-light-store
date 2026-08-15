# VS Future Store

Standalone product plan: VS

Product concept

Build VS, a premium, light-first sci-fi marketplace combining:

Amazon’s utility, search, filtering, and fulfillment clarity

Flipkart’s offers, price visibility, and order tracking

Myntra’s visual discovery, wishlist, variant selection, and styling

Meesho’s price-led browsing and social-friendly discovery

The experience should feel like a beautiful future-facing marketplace, not a cyberpunk dashboard: polished white surfaces, black typography, cobalt blue actions, and controlled red alerts.

Reference only: an established premium commerce storefront. Reusable patterns include the layered header/search, category navigation, curated product shelves, wishlist, account/orders, trust signals, and protected finance workspace. Do not copy another brand’s identity, assets, copy, layout exactly, or domain behavior.

Brand rules

Public brand name: VS or final approved VS store name.

Do not display:

The registered entity name in customer-facing merchandising

Industrial, chemical, or manufacturing imagery

Reference-brand logos, colors, copy, assets, handles, domains, or product names

Builder logos, badges, default favicons, default metadata, or builder attribution

If required legally, the registered entity can appear only in the legal footer, terms, invoices, or business contact information.

Visual direction

Use a premium white canvas with strong contrast:

Background: soft white / cool gray

Text: near-black

Primary action: cobalt blue

Secondary accent: electric blue

Alerts, discounts, and urgent states: signal red

Borders: cool gray-blue

Cards: white with thin borders and restrained shadows

Typography: modern geometric display font with highly readable sans-serif body text

Components: 14–20px radius, crisp spacing, subtle hover motion

Avoid: excessive neon, noisy gradients, dark full-screen cyberpunk styling, glassmorphism everywhere

The visual language should be “luxury retail interface from the near future.”

Main storefront structure

Header

Create a responsive sci-fi commerce header with:

VS logo and wordmark

Category selector

Predictive search field

Account and orders

Wishlist count

Bag/cart count

Mobile search overlay

Secondary navigation rail for collections, offers, new arrivals, trending, and support

Optional delivery-location selector

Homepage

Sections should include:

Hero campaign with one strong CTA

Trending categories

New arrivals

Best sellers

Limited-time offers

“Under ₹/$X” price discovery shelf

Personalized or recently viewed products

Editorial discovery banner

Reviews and social proof

Delivery, returns, and secure-checkout trust strip

Newsletter or notification opt-in

All product shelves must be data-driven. Demo products should be isolated behind a clearly defined demo mode and never presented as real Shopify data.

Required routes

Public:

/

/shop

/collections/:handle

/search

/products/:handle

/wishlist

/cart

/account

/orders

/track-order

/offers

/help

/policies/*

Private admin:

/admin/finance

/admin/orders

/admin/inventory

/admin/agent

/admin/settings

/admin/audit-log

Predictive search

Implement a shared search engine used by the header, search page, and collection pages.

Features:

Instant autocomplete while typing

Typo tolerance

Synonyms and aliases

Product, collection, category, tag, and SKU matching

Popular searches

Recent searches

“Top matches,” “Collections,” and “Suggested categories” groups

Keyboard navigation

Highlighted matched terms

Empty-state recovery suggestions

Mobile full-screen search experience

URL-persistent search state

Debounced requests and cached search results

The reference storefront’s reusable search behavior is conceptual only; VS uses its own data model and brand vocabulary.

Collection filtering and Liquid parity

The collection experience should support:

Price range slider plus manual min/max inputs

Availability: in stock, low stock, out of stock

Product tags

Category

Brand/vendor

Size

Color

Rating

Discount percentage

Sort by featured, newest, price, rating, and best selling

Active filter chips

Clear-all action

Result count

Mobile filter drawer

Shareable URL query parameters

Example:

/collections/shoes?min_price=1000&max_price=5000&availability=in-stock&tag=running&sort=price-asc

If Shopify Liquid output is required, create a parallel Liquid collection scaffold using Shopify’s native product filters and URL parameters. React remains the main experience and Liquid maintains behavioral parity.

Shopify’s product query supports pagination, search, sorting, filters, variants, prices, inventory, tags, and product availability, making it suitable for this contract. Shopify product query documentation

Product quick-actions panel

Every product card should support a quick-actions panel or responsive bottom sheet with:

Product image gallery

Product title, price, compare-at price, and discount

Variant selection

Size and color controls

Stock status

Size guide

Wishlist toggle

Quantity selector

One-click add-to-bag

Delivery estimate if available

“View full details” fallback

Confirmation toast and mini-cart update

For single-variant products, add to bag immediately. For multi-variant products, require a valid variant before adding.

Use the reusable behavior patterns already present in this repository, while keeping all storage keys, events, classes, and product types specific to VS.

Commerce essentials to add

Also include:

Shopify checkout handoff

Customer account and order history

Order tracking

Returns and refund requests

Product reviews and ratings

Promo codes and campaign banners

Recently viewed products

Product comparison

Low-stock notices

Back-in-stock notifications

Saved addresses

Payment and shipping trust indicators

Error, loading, empty, and offline states

SEO metadata and structured product data

Cookie/analytics consent

Accessible keyboard and screen-reader flows

Mobile-first responsive layouts

Cart recovery hooks

Support/contact entry points

Admin finance workspace

Create a protected finance dashboard that shows:

Total sales across all orders

Gross sales

Discounts

Refunds and returns

Chargebacks

Net sales

Cost of goods sold

Payment and Shopify fees

Campaign spend

Subscription/software costs

Shipping and fulfillment costs

Other operating expenses

Gross profit

Operating profit or loss

Profit margin

Refund rate

Chargeback rate

Average order value

Best-performing products

Best-performing campaigns

Inventory value

Orders needing attention

Recommended calculation model:

Gross sales

- discounts
- refunds and returns
- chargeback losses
  = net sales

Net sales

- product cost
- payment fees
- campaign spend
- subscription costs
- shipping/fulfillment costs
- other operating expenses
  = operating profit or loss

Refunds and chargebacks must remain separate ledger categories so the system does not double-count deductions.

The finance page should include:

Date-range selector

Currency and timezone display

Daily, weekly, monthly, and custom periods

Revenue/profit charts

P&L table

Order profitability table

Refund and chargeback table

Campaign-cost table

Subscription-cost table

Data freshness indicators

Source confidence indicators

CSV and PDF export

Manual expense entry

Reconciliation exceptions

Audit history

Use the finance requirements in this brief as conceptual guidance only; keep the implementation specific to VS.

Shopify’s order query supports reporting, filtering, order status, financial status, and chargeback status. Shopify orders documentation

MCP agent architecture

Do not expose Shopify Admin API tokens in the browser.

Recommended architecture:

React/Vite storefront
|
v
Supabase Auth + Edge Functions
|
+--> Shopify Storefront API
+--> Shopify Admin GraphQL API
+--> Shopify webhooks
+--> MCP agent tool layer
|
v
Supabase Postgres finance ledger

MVP agent tools should be read-only:

shopify_search_products

shopify_get_product

shopify_get_inventory

shopify_list_orders

shopify_get_order

shopify_list_refunds

shopify_list_chargebacks

shopify_get_payouts

finance_get_summary

finance_get_profit_loss

finance_get_exceptions

finance_refresh_data

The admin agent console should support natural-language requests such as:

“Show sales for the last 30 days.”

“Which products are low in stock?”

“List refunded orders this month.”

“What caused the profit drop?”

“Show orders with chargebacks.”

“Compare campaign spend against net profit.”

Every response should show:

Data source

Date range

Last synced time

Currency

Filters used

Confidence or missing-data warning

Shopify’s Storefront MCP is intended for customer-facing catalog, cart, and policy experiences; the private finance console should use a protected server-side Admin API/MCP adapter instead. Shopify Storefront MCP documentation

Use Shopify webhooks for order, inventory, product, refund, and fulfillment changes rather than relying only on repeated polling. Shopify webhook documentation

Supabase data model

Create tables for:

shopify_connections

shopify_products

shopify_variants

inventory_snapshots

orders

order_line_items

refunds

chargebacks

payouts

campaign_costs

subscriptions

operating_expenses

finance_snapshots

sync_runs

agent_audit_logs

Apply Row Level Security to every private table. Store Shopify credentials only in server-side secrets or a secure vault. Never place Admin API credentials in VITE_* variables or client bundles.

Shopify inventory is location-aware and includes SKU, tracking, unit cost, and inventory levels. Shopify inventory documentation

Recommended VS Store implementation phases

Phase 1: Brand and foundation

Remove all reference-brand and builder traces

Establish VS tokens, logo, favicon, metadata, and copy system

Build responsive application shell

Connect Supabase Auth

Add Shopify environment configuration

Phase 2: Storefront

Homepage

Header and predictive search

Collections

Product cards

Product detail pages

Cart and checkout handoff

Wishlist and account routes

Phase 3: Marketplace experience

Advanced filters

Sorting

Quick-actions panel

Reviews

Offers

Recently viewed

Back-in-stock states

Mobile interaction polish

Phase 4: Data and finance

Shopify Admin API connection

Initial product/order/inventory sync

Webhook sync

Refund and chargeback handling

Campaign and subscription cost entry

Finance calculations

Admin dashboard

MCP agent console

Phase 5: Hardening

Real Shopify data validation

Desktop and mobile Playwright flows

Accessibility audit

SEO checks

Loading/error/empty-state QA

Security and RLS review

Finance reconciliation against Shopify

Final metadata and branding sweep

Definition of done

The VS Store build is complete when:

No reference-brand, builder, or industrial-entity branding appears in the UI, HTML, metadata, assets, favicon, or source configuration.

Product data comes from Shopify or an explicitly isolated demo mode.

Search works instantly on desktop and mobile.

Collection filters are functional, shareable, and URL-persistent.

Quick add correctly handles variants and availability.

Wishlist and cart persist across sessions.

Shopify checkout and order tracking work.

Finance uses real order, refund, chargeback, campaign, subscription, and expense data.

MCP responses identify their source and freshness.

Shopify Admin credentials remain server-side.

Finance pages require authenticated admin access.

Every important screen has loading, empty, error, and offline states.

Desktop and mobile purchase flows pass browser validation.

The final visual result feels premium, clean, rich, and distinctly VS.

Use this as the VS Store implementation brief. The current store domain is
`vs-future-store-0jl2t-jxu6tnr3.myshopify.com`, with USD as the initial storefront
currency and Asia/Kolkata as the operating timezone.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
