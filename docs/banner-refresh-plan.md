# VS Store banner refresh — audited implementation plan

## Approved scope and preview boundary

- Refresh homepage artwork and Shopify collection banners in a restrained sci-fi style: charcoal, silver, white, cyan and violet; cinematic images with editable HTML copy.
- The three merchandising navigation links are New Arrivals, Best Sellers and Premium Picks, pointing to their real collection URLs. This does not reduce the full catalog to three collections.
- The full top navigation is restored as Shop all, Collections, New arrivals, Best sellers, Premium picks, Track order, Support and Contact us. Premium Picks remains the merchandising hero/collection destination; Offers remains a working route but is intentionally not in this eight-link top strip.
- Remove the screenshot's repeated flat sidebar link list. Repair the sidebar's portal placement, full-height scrolling, keyboard focus, Escape/backdrop dismissal and focus restoration.
- Implement and verify locally, then show the working preview before requesting publication. Do not push Git, update live collection images or publish a theme before that review.

## Audit findings

1. Existing New Arrivals and Best Sellers nav links point to sorted Shop all pages. All three requested handles exist in the local Shopify snapshot, including Premium Picks; collection creation is unnecessary unless a fresh read contradicts this.
2. Read-only Shopify inventory verified 115 collections, 98 with existing images; the local empty-image snapshot was stale. Refresh all 113 customer-facing collections, including empty collections; explicitly exclude the two internal classification queues. Preserve the original image URLs in the rollout manifest.
3. Collection detail pages do not render their collection image. Uploading banners alone would therefore not make them visible on those pages.
4. The homepage contains design-process copy ("Silky gradients", "Luxury spacing"). Replace it with shopping-focused editorial content and category discovery.
5. The sidebar is a fixed element inside a backdrop-filtered header, which can constrain fixed positioning. It also repeats the complete primary nav under Quick links.
6. Live browser inspection found malformed doubled-origin modulepreload URLs and a root /assets hero request returning 404. Verify the generated Shopify asset rewriting with a local theme harness as part of release preparation.
7. The old collection-artwork script targets only 27 missing-image handles, skips replacements, and contains a hard-coded image directory. It is not suitable for this rollout.

## Implementation

1. Capture current storefront and fetch Shopify collection inventory read-only, verifying permanent shop identity.
2. Generate and save category-appropriate text-free artwork, retain prompts, optimize assets and map every public collection. Keep internal taxonomy queues out of customer navigation.
3. Add one shared artwork resolver for local preview and image rendering. Use real collection membership for the three homepage shelves; keep product, cart and checkout behavior intact.
4. Update hero, collection discovery cards, collection detail banners and the requested navigation/sidebar.
5. Prepare a resumable image rollout with an explicit before snapshot, exact IDs, per-file hashes, dry run, per-item errors and fresh Shopify readback. Run only read-only preparation before preview approval.
6. Validate build, relevant lint/type checks, all artwork mappings/files, desktop/mobile layouts, real collection destinations, drawer keyboard/scroll behavior, product/cart interactions, reduced motion and Shopify asset URLs.
7. Open the local preview and report actual completed coverage and any limits. After user approves push, publish the targeted artwork/theme changes and verify Shopify Admin plus storefront separately.

## Acceptance evidence

Save before/after screenshots and browser diagnostics in output/playwright. Require a complete artwork inventory and valid image files for every intended target; no completion claim based on a sample. Keep live publication status separate from local readiness. A zero-error guarantee is not possible; unresolved failures must be identified rather than hidden.

## Local verification snapshot — 2026-09-14

- Artwork coverage: 113 customer-facing targets and 2 excluded internal classification queues. The source set contains 113 full-resolution JPEGs at 1536×1024, 113 responsive files at 768×512 and 113 menu thumbnails at 240×160. The reviewed manifest fingerprint is `bab861f537dedc489ac0f7a94754e4e44e3d1c729e82ef7af18504653ea9f32d`.
- Release safety: `node scripts/collection-banner-release.mjs --dry-run` completed with `targets: 113`, `excluded: 2` and `liveWrites: 0`. The apply path remains approval-gated by the reviewed fingerprint and was not run.
- Code checks: TypeScript, targeted ESLint, `git diff --check` and all 8 collection-banner manifest safety tests pass. The web build generated 2,451 crawlable pages; the isolated theme bundle is in `output/banner-theme-preview`.
- Browser proof: the local app was checked at 1440px, 390px, 320px and 844×390px. Homepage hero artwork loads, the eight-slide carousel resolves to the three merchandising collections plus Travel & Outdoor, Portable Gadgets, Kitchen, Beauty Essentials and Home Decor, and no horizontal overflow, page error or HTTP error appeared in the final homepage run.
- Sidebar proof: the sheet is a body-level portal, full-height and scrollable; focus remains trapped, Escape restores the trigger, backdrop dismissal works, and the menu uses 240px thumbnails. The old repeated `Offers`, `Shop all` and `Collections` entries are absent; the menu now contains category cards plus compact Saved, Track order and Help centre utilities.
- Collection/theme proof: the artwork review gallery loaded all 113/113 images across 8 pages. The theme harness loaded the New Arrivals, Best Sellers, Premium Picks and Home & Decor routes with their artwork and product grids, with no page errors or HTTP errors. Correct Shopify-style asset paths load and wrong asset paths return 404; no malformed doubled-origin modulepreloads remain.
- Interaction proof: carousel next/previous controls and reduced-motion behavior pass; mobile search reaches `/search?q=earbuds` and closes its sheet; wishlist, Quick Actions and add/increase/remove bag behavior pass with a controlled local cart mock only. No order or live checkout was created.

## Preview gate

Open `http://127.0.0.1:4175/` for the app preview. Open `http://127.0.0.1:4174/` for the isolated Shopify asset/theme harness. Review the screenshots in `output/playwright/banner-final-home-desktop-top.png`, `output/playwright/banner-final-home-mobile-top.png`, `output/playwright/sidebar-final-desktop.png` and `output/playwright/sidebar-final-mobile.png`. After visual approval, publication is a separate step: first approve the exact manifest fingerprint, then run the targeted collection-image release and verify Shopify Admin/CDN readback and the customer-facing storefront independently.

### Navigation follow-up

The full header strip requested after the first preview is now restored with exact labels and routes: Shop all (`/shop`), Collections (`/collections`), New arrivals (`/collections/new-arrivals`), Best sellers (`/collections/best-sellers`), Premium picks (`/collections/premium-picks`), Track order (`/track-order`), Support (`/help`) and Contact us (`/policies/contact`). Desktop distributes all eight links across the full-width header; mobile removes the cramped desktop strip and uses the hamburger drawer, which now exposes Featured edits plus the full category grid. Evidence is in `output/playwright/header-nav-restored-desktop.png` and `output/playwright/header-nav-restored-mobile.png`.

The homepage now also surfaces five requested discovery worlds directly below the hero: Travel & Outdoor, Portable Gadgets, Kitchen, Beauty Essentials and Home Decor. Each card uses the real collection route and the reviewed artwork resolver, so these are shoppable discovery links rather than decorative labels.

The same five worlds are also available as additional shoppable hero banners. The carousel now reports `01 / 08` through `08 / 08`, with a distinct CTA and collection destination for every slide. It auto-advances every 3.8 seconds, pauses while hovered or focused, and respects a reduced-motion preference.

Public storefront shells now use a 1600px wide-screen cap with consistent responsive gutters, while mobile keeps the bottom navigation clear of content with safe-area spacing, a drawer-first header and touch-sized controls.
