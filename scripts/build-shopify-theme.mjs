#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const rootDir = process.cwd();
const distDir = resolve(rootDir, "dist");
const publicDir = resolve(rootDir, "public");
const defaultThemeDir = resolve(
  process.env.SALT_SHOPIFY_THEME_DIR ||
    process.env.SHOPIFY_THEME_DIR ||
    resolve(rootDir, "..", "future-light-store-shopify"),
);
const financeApiOrigin = (process.env.VITE_FINANCE_API_ORIGIN || "").trim().replace(/\/+$/, "");
const shopifyAppKey = (process.env.VITE_SHOPIFY_APP_KEY || "").trim();
const themeBrandName = (process.env.SALT_THEME_BRAND_NAME || "Future Light Store").trim();
const judgemePublicToken = (process.env.SALT_JUDGEME_PUBLIC_TOKEN || "").trim();
const legacyBrandLogoPath = resolve(publicDir, "brand", "salt-logo.png");

const judgemePdpTabsLiquid = `<script>
  (function () {
    if (window.__vsStoreProductNavigationGuard) return;
    window.__vsStoreProductNavigationGuard = true;
    var productPath = new RegExp("^/(?:[a-z]{2}(?:-[a-z]{2})?/)?products/[^/]+/?$", "i");
    ["pushState", "replaceState"].forEach(function (method) {
      var original = window.history[method];
      window.history[method] = function () {
        var targetUrl = arguments[2];
        if (targetUrl !== undefined && targetUrl !== null) {
          try {
            var target = new URL(targetUrl, window.location.href);
            if (target.pathname !== window.location.pathname &&
                (productPath.test(window.location.pathname) || productPath.test(target.pathname))) {
              window.location.assign(target.href);
              return;
            }
          } catch (_error) {
            // Preserve ordinary navigation for non-URL history values.
          }
        }
        return original.apply(this, arguments);
      };
    });
  })();
</script>
{% if request.page_type == 'product' and product %}
<style>
  #vs-judgeme-widget-staging {
    position: absolute !important;
    left: -10000px !important;
    top: 0 !important;
    width: min(100%, 1200px) !important;
    max-width: 1200px !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
  .vs-pdp-info-tabs { min-width: 0; }
  .vs-pdp-info-tablist {
    display: flex;
    gap: 1.5rem;
    border-bottom: 1px solid #dbe2ec;
  }
  .vs-pdp-info-tab {
    min-height: 3rem;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    padding: .75rem .1rem;
    background: transparent;
    color: #667085;
    font: inherit;
    font-size: .875rem;
    font-weight: 600;
    cursor: pointer;
  }
  .vs-pdp-info-tab[aria-selected="true"] { border-bottom-color: #1749b8; color: #111827; }
  .vs-pdp-info-tab:hover { color: #111827; }
  .vs-pdp-info-tab:focus-visible { outline: 2px solid #1749b8; outline-offset: 3px; border-radius: .25rem; }
  .vs-pdp-info-panel { min-width: 0; padding-top: 1.25rem; }
  #vs-pdp-details-panel[hidden], .vs-pdp-info-panel[hidden] { display: none !important; }
</style>
<div id="vs-judgeme-widget-staging" aria-hidden="true" inert>
  <!-- Start of Judge.me code -->
  {% assign has_legacy = false %}
  {% if product.metafields.judgeme.widget.size > 20 %}{% assign has_legacy = true %}{% endif %}
  <div style="clear:both"></div>
  <div id="judgeme_product_reviews" class="jdgm-widget jdgm-review-widget" data-product-title="{{ product.title | escape }}" data-id="{{ product.id }}" data-product-id="{{ product.id }}" data-widget="review" data-auto-install="false" data-shop-reviews-count="{{ shop.metafields.judgeme.shop_reviews_count | default: 0 | escape }}" data-entry-point="review_widget.js" data-entry-key="review-widget/main.js">
    {% if has_legacy %}<div class="jdgm-legacy-widget-content" style="display:none">{{ product.metafields.judgeme.widget }}</div>{% endif %}
  </div>
  {% if product.metafields.judgeme.review_widget_data %}
    <script>
      window.jdgm = window.jdgm || {};
      window.jdgm.data = window.jdgm.data || {};
      window.jdgm.data.reviewWidget = window.jdgm.data.reviewWidget || {};
      window.jdgm.data.reviewWidget[{{ product.id }}] = {{ product.metafields.judgeme.review_widget_data }}
    </script>
  {% endif %}
  <!-- End of Judge.me code -->
</div>
<script>
  (function () {
    var root = document.getElementById("root");
    if (!root) return;

    function installReviewTabs() {
      if (root.querySelector("#vs-pdp-info-tabs")) return true;
      var description = root.querySelector('[aria-label="Product description"]');
      var addButton = Array.prototype.slice.call(root.querySelectorAll("button")).find(function (button) {
        return /^(Add to cart|Sold out)$/.test((button.textContent || "").trim());
      });
      var actionRow = addButton && addButton.parentElement;
      var productColumn = description
        ? description.parentElement
        : actionRow && actionRow.parentElement;
      if (!productColumn) return false;

      var before = description || (actionRow && actionRow.nextElementSibling);
      if (before && before.parentElement !== productColumn) before = null;

      var tabs = document.createElement("div");
      tabs.id = "vs-pdp-info-tabs";
      tabs.className = "vs-pdp-info-tabs";
      tabs.setAttribute("aria-label", "Product information and reviews");
      var tabList = document.createElement("div");
      tabList.className = "vs-pdp-info-tablist";
      tabList.setAttribute("role", "tablist");
      tabList.setAttribute("aria-label", "Product information");

      function createTab(id, label) {
        var tab = document.createElement("button");
        tab.type = "button";
        tab.id = id;
        tab.className = "vs-pdp-info-tab";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", id === "vs-pdp-details-tab"
          ? "vs-pdp-details-panel"
          : "vs-pdp-reviews-panel");
        tab.textContent = label;
        return tab;
      }

      var detailsTab = createTab("vs-pdp-details-tab", "Details");
      var reviewsTab = createTab("vs-pdp-reviews-tab", "Reviews");
      tabList.append(detailsTab, reviewsTab);
      tabs.appendChild(tabList);

      var detailsPanel = description;
      if (detailsPanel) {
        detailsPanel.id = "vs-pdp-details-panel";
        detailsPanel.setAttribute("role", "tabpanel");
        detailsPanel.setAttribute("aria-labelledby", detailsTab.id);
        detailsPanel.tabIndex = 0;
        detailsPanel.style.paddingTop = "1.25rem";
      } else {
        detailsPanel = document.createElement("div");
        detailsPanel.id = "vs-pdp-details-panel";
        detailsPanel.className = "vs-pdp-info-panel";
        detailsPanel.setAttribute("role", "tabpanel");
        detailsPanel.setAttribute("aria-labelledby", detailsTab.id);
        detailsPanel.tabIndex = 0;
        detailsPanel.textContent = "Product details are not available yet.";
      }

      var reviewsPanel = document.createElement("div");
      reviewsPanel.id = "vs-pdp-reviews-panel";
      reviewsPanel.className = "vs-pdp-info-panel";
      reviewsPanel.setAttribute("role", "tabpanel");
      reviewsPanel.setAttribute("aria-labelledby", reviewsTab.id);
      reviewsPanel.tabIndex = 0;
      reviewsPanel.hidden = true;

      productColumn.insertBefore(tabs, before || null);
      if (!description) productColumn.insertBefore(detailsPanel, before || null);
      productColumn.insertBefore(reviewsPanel, detailsPanel.nextSibling);

      function activate(index, moveFocus) {
        var showReviews = index === 1;
        detailsTab.setAttribute("aria-selected", String(!showReviews));
        reviewsTab.setAttribute("aria-selected", String(showReviews));
        detailsTab.tabIndex = showReviews ? -1 : 0;
        reviewsTab.tabIndex = showReviews ? 0 : -1;
        detailsPanel.hidden = showReviews;
        reviewsPanel.hidden = !showReviews;
        if (moveFocus) (showReviews ? reviewsTab : detailsTab).focus();
        if (!showReviews) return;

        var staging = document.getElementById("vs-judgeme-widget-staging");
        var widget = staging && staging.querySelector("#judgeme_product_reviews");
        if (widget) {
          reviewsPanel.appendChild(widget);
          staging.remove();
          window.dispatchEvent(new Event("resize"));
        }
      }

      detailsTab.setAttribute("aria-selected", "true");
      reviewsTab.setAttribute("aria-selected", "false");
      detailsTab.tabIndex = 0;
      reviewsTab.tabIndex = -1;
      detailsTab.addEventListener("click", function () { activate(0, false); });
      reviewsTab.addEventListener("click", function () { activate(1, false); });
      tabList.addEventListener("keydown", function (event) {
        var nextIndex = null;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          nextIndex = reviewsTab.getAttribute("aria-selected") === "true" ? 0 : 1;
        }
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = 1;
        if (nextIndex === null) return;
        event.preventDefault();
        activate(nextIndex, true);
      });
      return true;
    }

    if (installReviewTabs()) return;
    var observer = new MutationObserver(function () {
      if (installReviewTabs()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
    window.setTimeout(function () { observer.disconnect(); }, 15000);
  })();
</script>
{% endif %}`;

// Shopify serves application routes through native pages. Keep these aliases
// aligned with the page shells created elsewhere in the theme build.
const SHOPIFY_APP_ROUTE_PAGE_ALIASES = Object.freeze({
  "vs-store-about": "/about",
  "vs-store-offers": "/offers",
  "vs-store-auth": "/auth",
  "vs-store-wishlist": "/wishlist",
  "vs-store-orders": "/orders",
  "vs-store-track-order": "/track-order",
  "vs-store-help": "/help",
  "vs-store-policies": "/policies",
  "vs-store-policy-shipping": "/policies/shipping",
  "vs-store-policy-returns": "/policies/returns",
  "vs-store-policy-privacy": "/policies/privacy",
  "vs-store-policy-terms": "/policies/terms",
  "vs-store-policy-contact": "/policies/contact",
});

// macOS can expose OneDrive cloud placeholders as regular files with zero
// allocated blocks. `fs.cp` can then wait indefinitely while trying to hydrate
// an optional asset. Treat those files as unavailable so a theme bundle stays
// bounded and uses the local SVG fallback when possible.
function isMaterializedFileSync(filePath) {
  try {
    const fileStat = statSync(filePath);
    return fileStat.isFile() && (fileStat.blocks === undefined || fileStat.blocks > 0);
  } catch {
    return false;
  }
}

async function isMaterializedFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && (fileStat.blocks === undefined || fileStat.blocks > 0);
  } catch {
    return false;
  }
}

async function getTrackedMode(trackedPath) {
  try {
    const { stdout } = await execFile("git", ["ls-files", "-s", "--", trackedPath], {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    const match = stdout.match(/^(\d{6})\s/);
    return match ? parseInt(match[1], 8) & 0o777 : 0o644;
  } catch {
    return 0o644;
  }
}

async function copyAssetWithTrackedFallback(sourcePath, destinationPath, trackedPath) {
  if (await isMaterializedFile(sourcePath)) {
    await cp(sourcePath, destinationPath);
    return;
  }

  // OneDrive may leave a tracked file as a zero-block cloud placeholder. Use
  // the checked-in Git blob for release assets instead of waiting on Finder's
  // hydration indefinitely. This keeps the bundle reproducible and local.
  try {
    const sourceMode = await getTrackedMode(trackedPath);
    const { stdout } = await execFile("git", ["show", `HEAD:${trackedPath}`], {
      cwd: rootDir,
      encoding: "buffer",
      maxBuffer: 128 * 1024 * 1024,
    });
    await writeFile(destinationPath, stdout, { mode: sourceMode });
    await chmod(destinationPath, sourceMode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read release asset ${trackedPath}: ${message}`);
  }
}

const themeLogoAsset = isMaterializedFileSync(legacyBrandLogoPath)
  ? "brand-salt-logo.png"
  : "future-light-logo.svg";
const themeIconAsset = isMaterializedFileSync(resolve(publicDir, "favicon.svg"))
  ? "favicon.svg"
  : "favicon.ico";

function resolveThemeDir() {
  const outIndex = process.argv.indexOf("--out");

  if (outIndex !== -1 && process.argv[outIndex + 1]) {
    return resolve(process.cwd(), process.argv[outIndex + 1]);
  }

  if (process.env.SHOPIFY_THEME_DIR) {
    return resolve(process.env.SHOPIFY_THEME_DIR);
  }

  return defaultThemeDir;
}

const themeDir = resolveThemeDir();
const themeAssetsDir = resolve(themeDir, "assets");
const themeScaffoldEntries = ["assets", "config", "layout", "locales", "sections", "templates"];
// The React storefront reads catalog, pricing, availability, search and SEO
// data from live Shopify APIs. Keep no generated catalog assets in the theme;
// their presence would make stale data available as an accidental fallback.
const THEME_CATALOG_ASSET_PATTERN = /^data-.*\.json$/;

function parseEntryAssets(indexHtml) {
  const jsMatch = indexHtml.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i);
  const cssMatch = indexHtml.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/i);

  if (!jsMatch?.[1] || !cssMatch?.[1]) {
    throw new Error("Unable to locate entry JS/CSS assets in dist/index.html");
  }

  return {
    jsPath: jsMatch[1],
    cssPath: cssMatch[1],
  };
}

async function ensureDistExists() {
  if (!existsSync(resolve(distDir, "index.html"))) {
    throw new Error("dist/index.html not found. Run `npm run build` first.");
  }
}

function templateJson(sectionType = "salt-app") {
  return JSON.stringify(
    {
      sections: {
        main: {
          type: sectionType,
          settings: {},
        },
      },
      order: ["main"],
    },
    null,
    2,
  );
}

async function writeThemeScaffold(
  settingsData = null,
  routeAssets = {},
) {
  await mkdir(resolve(themeDir, "layout"), { recursive: true });
  await mkdir(resolve(themeDir, "sections"), { recursive: true });
  await mkdir(resolve(themeDir, "templates"), { recursive: true });
  await mkdir(resolve(themeDir, "snippets"), { recursive: true });
  await mkdir(resolve(themeDir, "config"), { recursive: true });
  await mkdir(resolve(themeDir, "locales"), { recursive: true });
  await mkdir(themeAssetsDir, { recursive: true });

  // Shopify's rendered section cache can otherwise retain an older
  // `salt-app.js` asset_url version after a theme upload. Stamp the section on
  // every bundle so the new loader is referenced immediately.
  const themeBuildStamp = Date.now().toString(36);

  const themeLiquid = `<!doctype html>
<html lang="{{ request.locale.iso_code }}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <meta name="theme-color" content="#1e3a6e">
    {% assign salt_route = request.path %}
    {% assign salt_seo_title = page_title | default: shop.name %}
    {% assign salt_seo_description = page_description | default: shop.description | default: 'Shop curated cookware, gifts, apparel, and everyday essentials from Future Light Store.' %}
    {% assign salt_seo_robots = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1' %}
    {% assign salt_seo_canonical = canonical_url | split: '?' | first %}
    {% assign salt_custom_canonical = false %}

    {% if salt_route == '/' %}
      {% assign salt_seo_title = 'Future Light Store | Curated essentials and giftable finds' %}
      {% assign salt_seo_description = 'Shop practical, giftable finds across cookware, home, beauty, apparel, gadgets, and everyday essentials.' %}
      {% assign salt_seo_canonical = 'https://' | append: request.host | append: '/' %}
      {% assign salt_custom_canonical = true %}
    {% elsif salt_route == '/pages/finance' or salt_route == '/apps:finance' or salt_route == '/apps/finance' %}
      {% assign salt_seo_title = 'Future Light Store Finance | Private Operations' %}
      {% assign salt_seo_description = 'Private store operations workspace.' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
    {% elsif salt_route == '/shop' %}
      {% assign salt_seo_title = 'Shop All Products | Future Light Store' %}
      {% assign salt_seo_description = 'Browse the live Future Light Store catalog of cookware, gifts, apparel, beauty, gadgets, and everyday essentials.' %}
      {% assign salt_seo_canonical = 'https://' | append: request.host | append: '/shop' %}
      {% assign salt_custom_canonical = true %}
    {% elsif salt_route == '/search' %}
      {% assign salt_seo_title = 'Search Future Light Store' %}
      {% assign salt_seo_description = 'Search the live Future Light Store catalog for products, collections, and everyday essentials.' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
      {% assign salt_seo_canonical = 'https://' | append: request.host | append: '/search' %}
      {% assign salt_custom_canonical = true %}
    {% elsif salt_route contains '/collections/' %}
      {% assign salt_seo_canonical = 'https://' | append: request.host | append: salt_route %}
      {% assign salt_custom_canonical = true %}
    {% elsif salt_route == '/cart' or salt_route == '/wishlist' or salt_route == '/recently-viewed' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
    {% elsif salt_route == '/pages/wishlist' %}
      {% assign salt_seo_title = 'Wishlist | Future Light Store' %}
      {% assign salt_seo_description = 'Save Future Light Store products for later and keep track of items you love.' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
    {% elsif salt_route == '/pages/resources' %}
      {% assign salt_seo_title = 'Resource Hub | Future Light Store' %}
      {% assign salt_seo_description = 'Practical guides that help shoppers discover the right Future Light Store products, collections, and everyday solutions.' %}
    {% elsif salt_route == '/pages/faq' %}
      {% assign salt_seo_title = 'FAQ | Future Light Store' %}
      {% assign salt_seo_description = 'Quick answers about Future Light Store ordering, shipping, returns, and product support.' %}
    {% elsif salt_route == '/pages/contact-us' %}
      {% assign salt_seo_title = 'Contact Support | Future Light Store' %}
      {% assign salt_seo_description = 'Reach the Future Light Store support team for delivery questions, product advice, returns, or order help.' %}
    {% elsif salt_route == '/pages/about-us' %}
      {% assign salt_seo_title = 'About Future Light Store' %}
      {% assign salt_seo_description = 'Learn how Future Light Store makes practical products easy to discover, save, and buy.' %}
    {% elsif salt_route == '/pages/blog' %}
      {% assign salt_seo_title = 'Future Light Store Journal' %}
      {% assign salt_seo_description = 'Fresh stories, product education, and practical ideas from Future Light Store.' %}
    {% elsif salt_route == '/pages/affiliate-program' %}
      {% assign salt_seo_title = 'Affiliate Program | Future Light Store' %}
      {% assign salt_seo_description = 'Learn how to partner with Future Light Store and share useful products with your audience.' %}
    {% elsif salt_route == '/pages/mission-vision' %}
      {% assign salt_seo_title = 'Mission & Vision | Future Light Store' %}
      {% assign salt_seo_description = 'Learn what Future Light Store is building and how we make everyday shopping easier.' %}
    {% elsif salt_route == '/pages/wholesale-inquiries' %}
      {% assign salt_seo_title = 'Wholesale Inquiries | Future Light Store' %}
      {% assign salt_seo_description = 'Contact Future Light Store about wholesale, gifting, and business purchasing opportunities.' %}
    {% elsif salt_route == '/pages/terms-conditions' %}
      {% assign salt_seo_title = 'Terms & Conditions | Future Light Store' %}
      {% assign salt_seo_description = 'Review the terms that apply when using the Future Light Store.' %}
    {% elsif salt_route == '/pages/track-order' %}
      {% assign salt_seo_title = 'Track Order | Future Light Store' %}
      {% assign salt_seo_description = 'Use the secure order portal to review your order status and delivery details.' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
    {% elsif salt_route == '/pages/recently-viewed' %}
      {% assign salt_seo_title = 'Recently Viewed | Future Light Store' %}
      {% assign salt_seo_description = 'Pick up where you left off with products viewed on this device.' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
    {% elsif request.page_type == '404' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
    {% endif %}

    {% if request.page_type == 'product' and product %}
      {%- comment -%}
        Build PDP metadata from the actual product record at render time. Strip
        the repeated heading and generic filler from the HTML description so
        search snippets describe the item itself rather than exposing editor
        scaffolding. The selected variant is appended only when it is real.
      {%- endcomment -%}
      {% assign salt_selected_variant = product.selected_or_first_available_variant %}
      {% assign salt_variant_label = salt_selected_variant.title | default: '' | strip %}
      {% assign salt_product_detail = product.description | split: 'Key Details' | first %}
      {% assign salt_product_detail = salt_product_detail | strip_html | strip_newlines | remove: 'About' | remove: product.title | remove: 'serves the specific function identified by its handle and confirmed product details.' | remove: 'Confirmed product facts and available options help shoppers compare it for the intended task.' | replace: ' — ', ' ' | replace: '  ', ' ' | strip | truncate: 95 %}
      {% assign salt_seo_description = 'Shop ' | append: product.title | append: ' at Future Light Store.' %}
      {% if salt_product_detail != blank %}
        {% assign salt_seo_description = salt_seo_description | append: ' ' | append: salt_product_detail %}
      {% else %}
        {% assign salt_seo_description = salt_seo_description | append: ' Review the product details, options and current availability before ordering.' %}
      {% endif %}
      {% unless salt_variant_label == blank or salt_variant_label == 'Default Title' %}
        {% assign salt_seo_title = product.title | append: ' - ' | append: salt_variant_label | append: ' | Future Light Store' %}
        {% assign salt_seo_description = salt_seo_description | append: ' Selected option: ' | append: salt_variant_label | append: '.' %}
      {% endunless %}
      {% assign salt_seo_description = salt_seo_description | strip_html | strip_newlines | replace: '  ', ' ' | strip | truncate: 158 %}
    {% endif %}

    <title>{{ salt_seo_title | escape }}</title>
    {% if salt_seo_description != blank %}
      <meta name="description" content="{{ salt_seo_description | strip_html | strip_newlines | escape }}">
    {% endif %}
    <meta name="robots" content="{{ salt_seo_robots }}">
    <meta name="googlebot" content="{{ salt_seo_robots }}">
    <meta property="og:title" content="{{ salt_seo_title | escape }}">
    <meta property="og:description" content="{{ salt_seo_description | strip_html | strip_newlines | escape }}">
    {% if request.page_type == 'product' and salt_selected_variant and salt_selected_variant.featured_image %}
      <meta property="og:image" content="{{ salt_selected_variant.featured_image | image_url: width: 1200 | escape }}">
    {% endif %}
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="{{ shop.name | escape }}">
    {{ content_for_header }}
    <script>
      (function () {
        var path = window.location.pathname;
        var query = window.location.search;
        var hasQuery = query.length > 1;
        var isFinance = path === '/pages/finance' || path === '/apps:finance' || path === '/apps/finance' || (path === '/' && /(?:^|&)finance=1(?:&|$)/.test(query.slice(1)));
        var isQuerySurface = path === '/' || path === '/shop' || path === '/search';
        if (!isFinance && !(hasQuery && isQuerySurface)) return;

        function ensureMeta(name, content) {
          var tag = document.querySelector('meta[name="' + name + '"]');
          if (!tag) {
            tag = document.createElement('meta');
            tag.setAttribute('name', name);
            document.head.appendChild(tag);
          }
          tag.setAttribute('content', content);
        }

        ensureMeta('robots', 'noindex,follow');
        ensureMeta('googlebot', 'noindex,follow');

        var canonicalPath = path;
        if (path === '/shop' && /(?:^|&)resource=hub(?:&|$)/.test(query.slice(1))) {
          canonicalPath = '/pages/resources';
        } else if (path !== '/pages/finance' && path !== '/apps:finance' && path !== '/apps/finance') {
          canonicalPath = path || '/';
        }

        var canonical = document.querySelector('link[rel="canonical"]');
        if (!canonical) {
          canonical = document.createElement('link');
          canonical.setAttribute('rel', 'canonical');
          document.head.appendChild(canonical);
        }
        canonical.setAttribute('href', window.location.origin + canonicalPath);
      })();
    </script>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": {{ shop.name | json }},
        "url": "https://{{ request.host }}/",
        "logo": {{ '${themeLogoAsset}' | asset_url | json }}
      }
    </script>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": {{ shop.name | json }},
        "url": "https://{{ request.host }}/",
        "potentialAction": {
          "@type": "SearchAction",
          "target": "https://{{ request.host }}/shop?q={search_term_string}",
          "query-input": "required name=search_term_string"
        }
      }
    </script>
    {% if request.page_type == 'product' and product %}
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Product",
              "name": {{ product.title | json }},
              "description": {{ salt_seo_description | strip_html | strip_newlines | json }},
              "url": "https://{{ request.host }}{{ product.url }}",
              "image": [
                {% for image in product.images limit: 8 %}
                  {{ image | image_url: width: 1200 | prepend: 'https:' | json }}{% unless forloop.last %},{% endunless %}
                {% endfor %}
              ],
              "brand": {
                "@type": "Brand",
                "name": {{ product.vendor | default: shop.name | json }}
              },
              {% if product.type != blank %}
                "category": {{ product.type | json }},
              {% endif %}
              "offers": {
                "@type": "Offer",
                "url": "https://{{ request.host }}{{ product.url }}",
                "price": {{ salt_selected_variant.price | divided_by: 100.0 | json }},
                "priceCurrency": {{ shop.currency | json }},
                "availability": "{% if salt_selected_variant.available %}https://schema.org/InStock{% else %}https://schema.org/OutOfStock{% endif %}",
                "itemCondition": "https://schema.org/NewCondition"
              },
              "shippingDetails": {
                "@type": "OfferShippingDetails",
                "shippingDestination": {
                  "@type": "DefinedRegion",
                  "addressCountry": "US"
                },
                "shippingRate": {
                  "@type": "MonetaryAmount",
                  "value": "0",
                  "currency": {{ shop.currency | json }}
                },
                "deliveryTime": {
                  "@type": "ShippingDeliveryTime",
                  "handlingTime": {
                    "@type": "QuantitativeValue",
                    "minValue": 1,
                    "maxValue": 2,
                    "unitCode": "DAY"
                  },
                  "transitTime": {
                    "@type": "QuantitativeValue",
                    "minValue": 5,
                    "maxValue": 8,
                    "unitCode": "DAY"
                  }
                }
              },
              "hasMerchantReturnPolicy": {
                "@type": "MerchantReturnPolicy",
                "applicableCountry": "US",
                "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
                "merchantReturnDays": 30,
                "returnMethod": "https://schema.org/ReturnByMail",
                "returnFees": "https://schema.org/FreeReturn"
              }
            },
            {
              "@type": "BreadcrumbList",
              "itemListElement": [
                {
                  "@type": "ListItem",
                  "position": 1,
                  "name": "Home",
                  "item": "https://{{ request.host }}/"
                },
                {
                  "@type": "ListItem",
                  "position": 2,
                  "name": {{ product.title | json }},
                  "item": "https://{{ request.host }}{{ product.url }}"
                }
              ]
            }
          ]
        }
      </script>
    {% endif %}
    <link rel="icon" type="image/svg+xml" href="{{ '${themeIconAsset}' | asset_url }}">
    <link rel="preconnect" href="https://cdn.shopify.com" crossorigin>
    {{ 'salt-app.css' | asset_url | stylesheet_tag }}
    {% if ${JSON.stringify(routeAssets.entry || "")} != blank %}
      <link rel="modulepreload" href="{{ ${JSON.stringify(routeAssets.entry || "")} | asset_url | split: '?' | first }}" fetchpriority="high">
    {% endif %}
    {% if request.page_type == 'product' and ${JSON.stringify(routeAssets.product || "")} != blank %}
      <link rel="modulepreload" href="{{ ${JSON.stringify(routeAssets.product || "")} | asset_url | split: '?' | first }}" fetchpriority="high">
    {% elsif request.page_type == 'index' and ${JSON.stringify(routeAssets.home || "")} != blank %}
      <link rel="modulepreload" href="{{ ${JSON.stringify(routeAssets.home || "")} | asset_url | split: '?' | first }}">
    {% endif %}
    {% if request.page_type == 'product' %}
      {%- comment -%}
        The React PDP selects the live featured image and its responsive URL after
        the product payload arrives. Preloading product.featured_image here can
        fetch a different CDN variant and creates a wasted-preload warning.
      {%- endcomment -%}
      <link rel="preconnect" href="https://magecomp.us" crossorigin>
      <link rel="dns-prefetch" href="//magecomp.us">
      <script>
        (function () {
          // LimitQtyHelper is injected by a Shopify app with defer, but its
          // origin can take more than a second to respond. Keep the quantity
          // feature and its execution order independent from DOM readiness so
          // the React product page never waits on that third-party server.
          function isLimitQtyHelper(node) {
            if (!(node instanceof HTMLScriptElement) || !node.src) return false;

            try {
              var url = new URL(node.src, window.location.href);
              return url.hostname === 'magecomp.us' && url.pathname === '/js/LimitQtyHelper.js';
            } catch (error) {
              return false;
            }
          }

          function makeNonBlocking(node) {
            if (isLimitQtyHelper(node)) {
              node.async = true;
              node.defer = false;
              node.setAttribute('data-salt-nonblocking', 'true');
            }

            if (!node || !node.querySelectorAll) return;
            node.querySelectorAll('script[src]').forEach(function (script) {
              if (!isLimitQtyHelper(script)) return;
              script.async = true;
              script.defer = false;
              script.setAttribute('data-salt-nonblocking', 'true');
            });
          }

          var observer = new MutationObserver(function (records) {
            records.forEach(function (record) {
              record.addedNodes.forEach(makeNonBlocking);
            });
          });

          observer.observe(document.documentElement, { childList: true, subtree: true });
          document.addEventListener('DOMContentLoaded', function () {
            observer.disconnect();
          }, { once: true });
        })();
      </script>
    {% endif %}
    <script>
      (function () {
        var selector = '#svelte-bundle-widget, #pumper_bundle_svelte';
        var pending = /^\\/products?(?:\\/|$)/.test(window.location.pathname);
        var observer = null;
        var originalDisplays = new WeakMap();

        function rememberAndHide(element) {
          if (!(element instanceof HTMLElement)) return;

          if (!originalDisplays.has(element)) {
            originalDisplays.set(element, {
              value: element.style.getPropertyValue('display'),
              priority: element.style.getPropertyPriority('display'),
            });
          }

          if (
            element.style.getPropertyValue('display') !== 'none' ||
            element.style.getPropertyPriority('display') !== 'important'
          ) {
            element.style.setProperty('display', 'none', 'important');
          }
        }

        function hideWidgets(scope) {
          if (!pending) return;

          if (scope && scope.nodeType === 1 && scope.matches(selector)) {
            rememberAndHide(scope);
          }

          var root = scope && scope.querySelectorAll ? scope : document;
          root.querySelectorAll(selector).forEach(rememberAndHide);
        }

        function observeWidgets() {
          if (observer || !document.documentElement) return;

          observer = new MutationObserver(function (records) {
            if (!pending) return;

            records.forEach(function (record) {
              if (record.type === 'attributes') {
                hideWidgets(record.target);
                return;
              }

              record.addedNodes.forEach(hideWidgets);
            });
          });

          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['id', 'style'],
          });
        }

        function gatePumper() {
          pending = true;
          document.documentElement.setAttribute('data-salt-product-media', 'loading');
          observeWidgets();
          hideWidgets(document);
        }

        function releasePumper() {
          pending = false;
          document.documentElement.removeAttribute('data-salt-product-media');

          if (observer) {
            observer.disconnect();
            observer = null;
          }

          document.querySelectorAll(selector).forEach(function (element) {
            var original = originalDisplays.get(element);
            if (!original) return;

            if (original.value) {
              element.style.setProperty('display', original.value, original.priority);
            } else {
              element.style.removeProperty('display');
            }

            originalDisplays.delete(element);
          });

          window.setTimeout(function () {
            window.dispatchEvent(new Event('resize'));
          }, 0);
        }

        window.addEventListener('salt:product-media-loading', gatePumper);
        window.addEventListener('salt:product-media-ready', releasePumper);

        if (pending) gatePumper();
      })();
    </script>
    <script>
      (function () {
        // Keep the documented Shopify storefront event contract available when
        // the optional Shopify CDN module is delayed or blocked. The external
        // runtime below replaces these classes when it loads successfully.
        function createPromise() {
          var resolve;
          var reject;
          var promise = new Promise(function (resolvePromise, rejectPromise) {
            resolve = resolvePromise;
            reject = rejectPromise;
          });
          return { promise: promise, resolve: resolve, reject: reject };
        }

        function toShopifyGid(type, value) {
          var stringValue = String(value == null ? '' : value);
          return stringValue.indexOf('gid://shopify/') === 0
            ? stringValue
            : 'gid://shopify/' + type + '/' + stringValue;
        }

        class ShopifyStandardEvent extends Event {
          constructor(name, payload) {
            super(name, { bubbles: true, cancelable: true });
            Object.assign(this, payload || {});
          }
        }

        class ProductViewEvent extends ShopifyStandardEvent {
          constructor(payload) {
            var product = payload && payload.product;
            super('shopify:product:view', {
              ...(payload || {}),
              product: product
                ? {
                    ...product,
                    id: toShopifyGid('Product', product.id),
                    selectedVariant: product.selectedVariant
                      ? {
                          ...product.selectedVariant,
                          id: toShopifyGid('ProductVariant', product.selectedVariant.id),
                        }
                      : null,
                  }
                : product,
            });
          }
        }

        class CartLinesUpdateEvent extends ShopifyStandardEvent {
          constructor(payload) {
            var source = payload || {};
            var isAdd = source.action === 'add';
            super('shopify:cart:lines-update', {
              ...source,
              lines: Array.isArray(source.lines)
                ? source.lines.map(function (line) {
                    var key = isAdd ? 'merchandiseId' : 'id';
                    return {
                      ...line,
                      [key]: toShopifyGid(isAdd ? 'ProductVariant' : 'CartLine', line[key]),
                    };
                  })
                : [],
              promise: source.promise,
            });
          }

          static createPromise() {
            return createPromise();
          }
        }

        class CartErrorEvent extends ShopifyStandardEvent {
          constructor(payload) {
            super('shopify:cart:error', payload);
          }
        }

        function createViewEventElement() {
          return class ShopifyViewEventElement extends HTMLElement {
            connectedCallback() {
              var trigger = this.getAttribute('view-event-trigger') || 'connect';
              if (trigger === 'connect') setTimeout(() => this.dispatchViewEvent());
              if (trigger === 'intersect' && window.IntersectionObserver) {
                var observer = new IntersectionObserver((entries) => {
                  if (entries.some((entry) => entry.isIntersecting)) {
                    observer.disconnect();
                    this.dispatchViewEvent();
                  }
                }, { threshold: 0.5 });
                observer.observe(this);
              }
            }

            dispatchViewEvent() {
              if (this.dataset.eventDispatched === 'true') return;
              var payload = this.getAttribute('view-event-payload');
              if (!payload) return;
              try {
                var data = JSON.parse(payload);
                this.dataset.eventDispatched = 'true';
                if (data && data.product) {
                  data.context = data.context || 'page';
                  this.dispatchEvent(new ProductViewEvent(data));
                }
              } catch (error) {
                // Invalid optional analytics payloads must not affect rendering.
              }
            }
          };
        }

        var fallback = {
          ProductViewEvent: ProductViewEvent,
          CartLinesUpdateEvent: CartLinesUpdateEvent,
          CartErrorEvent: CartErrorEvent,
          createViewEventElement: createViewEventElement,
        };
        window.StandardEvents = {
          ...(window.StandardEvents || {}),
          ...fallback,
        };
        if (window.customElements && !window.customElements.get('s-view-event')) {
          window.customElements.define('s-view-event', window.StandardEvents.createViewEventElement());
        }
        window.dispatchEvent(new Event('future-light:standard-events-ready'));
      })();
    </script>
    <script type="module">
      (async function () {
        try {
          const standardEvents = await import('https://cdn.shopify.com/storefront/standard-events.js');
          window.StandardEvents = standardEvents;
          if (
            standardEvents.createViewEventElement &&
            window.customElements &&
            !window.customElements.get('s-view-event')
          ) {
            window.customElements.define('s-view-event', standardEvents.createViewEventElement());
          }
          window.dispatchEvent(new Event('future-light:standard-events-ready'));
        } catch (error) {
          // The synchronous fallback above already covers analytics safely.
        }
      })();
    </script>
    {% if salt_custom_canonical %}
      <script>
        (function () {
          var canonical = document.querySelector('link[rel="canonical"]');
          if (!canonical) return;
          canonical.setAttribute('href', {{ salt_seo_canonical | json }});
        })();
      </script>
    {% endif %}
    {% if request.page_type == 'product' %}
      <script>
        (function () {
          var match = window.location.pathname.match(/^\\/products?\\/([^\\/?#]+)\\/?$/);
          if (!match) return;

          var handle = decodeURIComponent(match[1]);
          var url = '/products/' + encodeURIComponent(handle) + '.js';
          var inlineProduct = {{ product | json }};
          window.__SALT_PRODUCT_PREFETCH__ = {
            handle: handle.toLowerCase(),
            raw: inlineProduct && inlineProduct.id ? inlineProduct : null,
            // Use the inline payload for the first paint, but always revalidate
            // the direct product endpoint so storefront prices cannot remain
            // stuck on an older document snapshot.
            payload: fetch(url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (response) {
              if (!response.ok) throw new Error('Product preload failed (' + response.status + ')');
              return response.json();
            }),
          };
        })();
      </script>
    {% endif %}
    {% if request.page_type == 'collection' and collection %}
      {% paginate collection.products by 250 %}
        <script>
          (function () {
            // Shopify renders this payload inside the uploaded theme. It is a
            // request-time snapshot, so React gets current manual ordering,
            // prices, availability, and newly added first-page products before
            // its modules execute and without a storefront API round-trip.
            var liveProducts = [
              {% for item in collection.products limit: 24 %}
                {
                  id: {{ item.id | json }},
                  title: {{ item.title | json }},
                  handle: {{ item.handle | json }},
                  body_html: null,
                  vendor: {{ item.vendor | json }},
                  product_type: {{ item.type | json }},
                  tags: {{ item.tags | json }},
                  created_at: {{ item.created_at | date: '%Y-%m-%dT%H:%M:%SZ' | json }},
                  published_at: {{ item.published_at | date: '%Y-%m-%dT%H:%M:%SZ' | json }},
                  updated_at: {{ item.updated_at | date: '%Y-%m-%dT%H:%M:%SZ' | json }},
                  variants: [
                    {% for variant in item.variants %}
                      {
                        id: {{ variant.id | json }},
                        title: {{ variant.title | json }},
                        price: {{ variant.price | json }},
                        compare_at_price: {% if variant.compare_at_price %}{{ variant.compare_at_price | json }}{% else %}null{% endif %},
                        available: {{ variant.available | json }},
                        sku: {{ variant.sku | json }},
                        requires_shipping: {{ variant.requires_shipping | json }}
                      }{% unless forloop.last %},{% endunless %}
                    {% endfor %}
                  ],
                  images: [
                    {% if item.featured_image %}
                      {
                        id: {{ item.featured_image.id | default: item.id | json }},
                        src: {{ item.featured_image | image_url: width: 900 | json }},
                        alt: {{ item.featured_image.alt | default: item.title | json }},
                        width: {{ item.featured_image.width | json }},
                        height: {{ item.featured_image.height | json }}
                      }
                    {% endif %}
                  ],
                  image: {% if item.featured_image %}{
                    id: {{ item.featured_image.id | default: item.id | json }},
                    src: {{ item.featured_image | image_url: width: 900 | json }},
                    alt: {{ item.featured_image.alt | default: item.title | json }},
                    width: {{ item.featured_image.width | json }},
                    height: {{ item.featured_image.height | json }}
                  }{% else %}null{% endif %}
                }{% unless forloop.last %},{% endunless %}
              {% endfor %}
            ];

            window.__SALT_COLLECTION_PREFETCH__ = {
              handle: {{ collection.handle | downcase | json }},
              generatedAt: {{ 'now' | date: '%Y-%m-%dT%H:%M:%SZ' | json }},
              complete: {% if paginate.pages == 1 %}true{% else %}false{% endif %},
              currentPage: {{ paginate.current_page | json }},
              total: {{ collection.products_count | json }},
              productIds: [
                {% for item in collection.products %}
                  {{ item.id | json }}{% unless forloop.last %},{% endunless %}
                {% endfor %}
              ],
              products: liveProducts
            };
          })();
        </script>
      {% endpaginate %}
    {% endif %}
    {% if ${JSON.stringify(routeAssets.entry || "")} != blank %}
      <script type="module" src="{{ ${JSON.stringify(routeAssets.entry || "")} | asset_url | split: '?' | first }}"></script>
    {% else %}
      <script type="module" src="{{ 'salt-app.js' | asset_url }}"></script>
    {% endif %}
  </head>
  <body>
    {{ content_for_layout }}
  </body>
</html>
`;

  const sectionLiquid = `{% if request.page_type == 'page' and page.handle %}
<script>
  (function () {
    var routeAliases = ${JSON.stringify(SHOPIFY_APP_ROUTE_PAGE_ALIASES)};
    var pageHandle = {{ page.handle | json }};
    var cleanPath = routeAliases[pageHandle];
    if (!cleanPath || window.location.pathname !== "/pages/" + pageHandle) return;
    window.history.replaceState(null, document.title, cleanPath + window.location.search + window.location.hash);
  })();
</script>
{% endif %}
{% if request.page_type == 'product' and product %}
<s-view-event
  view-event-trigger="connect"
  view-event-payload='{{ product | standard_event_data: "view", context: "page" | escape }}'
>
{% endif %}
<div
  id="root"
  data-shop-base-url="https://{{ request.host | escape }}"
  data-shop-domain="{{ shop.permanent_domain | escape }}"
  data-shop-name="{{ shop.name | escape }}"
  data-judgeme-shop-domain="{{ shop.permanent_domain | escape }}"
  data-judgeme-public-token="${judgemePublicToken}"
  data-currency="{{ cart.currency.iso_code | default: shop.currency | escape }}"
>
{% if request.page_type == 'product' and product %}
  {%- comment -%}
    Keep a request-time, no-JavaScript product surface inside the React root.
    React replaces this markup on a normal visit; crawlers and customers whose
    scripts are delayed still receive a real title, price, availability, and
    native Shopify cart form instead of an empty application shell.
  {%- endcomment -%}
  {% assign salt_fallback_variant = product.selected_or_first_available_variant %}
  <article class="salt-product-fallback" aria-label="{{ product.title | escape }}" style="max-width:72rem;margin:0 auto;padding:2rem 1.25rem;font-family:Arial,sans-serif;color:#101522">
    <nav aria-label="Breadcrumb" style="font-size:.8rem;margin-bottom:1.5rem">
      <a href="{{ routes.root_url }}" style="color:#1e4fb8">VS Store</a>
      <span aria-hidden="true"> / </span>
      <span>{{ product.title | escape }}</span>
    </nav>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2rem;align-items:start">
      {% if product.featured_image %}
        <img src="{{ product.featured_image | image_url: width: 900 | prepend: 'https:' }}" alt="{{ product.featured_image.alt | default: product.title | escape }}" width="900" height="900" loading="eager" style="width:100%;height:auto;border-radius:1rem" />
      {% endif %}
      <div>
        <p style="font-size:.75rem;letter-spacing:.12em;text-transform:uppercase;color:#5d6675">{{ product.vendor | default: shop.name | escape }}</p>
        <h1 style="font-size:clamp(1.75rem,4vw,3rem);line-height:1.05;margin:.5rem 0 1rem">{{ product.title | escape }}</h1>
        <p style="font-size:1.5rem;font-weight:700;margin:0 0 .75rem">{{ salt_fallback_variant.price | money }}</p>
        <p style="font-size:.95rem;color:#5d6675">{% if salt_fallback_variant.available %}In stock{% else %}Sold out{% endif %} · Configured Shopify estimate: 5–8 business days in the United States; final estimate at checkout</p>
        {% if product.description != blank %}
          <div style="margin:1.25rem 0;line-height:1.6">{{ product.description | strip_html | truncate: 600 | escape }}</div>
        {% endif %}
        <form method="post" action="{{ routes.cart_add_url }}" accept-charset="UTF-8" style="display:grid;gap:.75rem;max-width:28rem">
          <input type="hidden" name="form_type" value="product" />
          <input type="hidden" name="utf8" value="✓" />
          {% if product.has_only_default_variant %}
            <input type="hidden" name="id" value="{{ salt_fallback_variant.id }}" />
          {% else %}
            <label for="salt-fallback-variant" style="font-size:.85rem;font-weight:600">Choose an option</label>
            <select id="salt-fallback-variant" name="id" style="min-height:2.75rem;padding:.5rem;border:1px solid #c9ced8;border-radius:.65rem">
              {% for variant in product.variants %}
                <option value="{{ variant.id }}"{% unless variant.available %} disabled{% endunless %}{% if variant.id == salt_fallback_variant.id %} selected{% endif %}>{{ variant.title | escape }} — {{ variant.price | money }}{% unless variant.available %} — Sold out{% endunless %}</option>
              {% endfor %}
            </select>
          {% endif %}
          <label for="salt-fallback-quantity" style="font-size:.85rem;font-weight:600">Quantity</label>
          <input id="salt-fallback-quantity" type="number" name="quantity" min="1" value="1" style="min-height:2.75rem;padding:.5rem;border:1px solid #c9ced8;border-radius:.65rem" />
          <button type="submit"{% unless salt_fallback_variant.available %} disabled{% endunless %} style="min-height:3rem;border:0;border-radius:.75rem;background:#123f9c;color:#fff;font-weight:700;cursor:pointer">{% if salt_fallback_variant.available %}Add to cart{% else %}Sold out{% endif %}</button>
        </form>
        <p style="font-size:.8rem;color:#5d6675;margin-top:1rem">Secure Shopify checkout · 30-day returns</p>
      </div>
    </div>
  </article>
{% endif %}
{% unless request.page_type == 'policy' or request.page_type == 'product' %}
  {%- comment -%}
    Keep a small request-time shell visible while the React entry downloads.
    The app replaces this markup immediately after mounting, but without it
    Safari can show a completely blank viewport during a slow first load.
    Native Shopify policy templates and the product fallback intentionally
    keep their own server-rendered surfaces instead.
  {%- endcomment -%}
  <div
    class="salt-app-loading"
    role="status"
    aria-live="polite"
    style="display:grid;min-height:42vh;place-items:center;padding:3rem 1.25rem;background:#f6f9fc;color:#101522;font-family:Arial,sans-serif;text-align:center"
  >
    <div style="display:grid;justify-items:center;gap:.8rem;max-width:28rem">
      <div style="font-size:.75rem;letter-spacing:.22em;font-weight:700">VS STORE</div>
      <div style="width:2.5rem;height:2.5rem;border:3px solid #d9e1ec;border-top-color:#1e4fb8;border-radius:999px;animation:salt-app-loading-spin .9s linear infinite" aria-hidden="true"></div>
      <p style="margin:0;font-size:.95rem;color:#5d6675">Loading your live storefront…</p>
    </div>
  </div>
  <style>
    @keyframes salt-app-loading-spin {
      to { transform: rotate(360deg); }
    }
  </style>
{% endunless %}
</div>
{% render 'vs-judgeme-pdp-tabs' %}
<script>
  window.SALT_THEME_BUILD = ${JSON.stringify(themeBuildStamp)};
  window.SALT_FINANCE_API_ORIGIN = ${JSON.stringify(financeApiOrigin)};
  window.SALT_SHOPIFY_APP_KEY = ${JSON.stringify(shopifyAppKey)};
  window.SALT_THEME_ASSET_BASE = {{ 'salt-app.js' | asset_url | split: 'salt-app.js' | first | json }};
  window.SALT_THEME_ASSETS = {
    "/brand/salt-logo.png": {{ '${themeLogoAsset}' | asset_url | json }},
    "/brand-salt-logo.png": {{ '${themeLogoAsset}' | asset_url | json }},
  };
</script>
{% if request.page_type == 'product' and product %}
</s-view-event>
{% endif %}
`;

  const storeThemeLiquid = themeLiquid
    .replaceAll("SALT Online Store", themeBrandName)
    .replaceAll("SALT App Theme", `${themeBrandName} App Theme`)
    .replaceAll("SALT storefront", `${themeBrandName} storefront`);
  await writeFile(resolve(themeDir, "layout", "theme.liquid"), storeThemeLiquid);
  await writeFile(resolve(themeDir, "sections", "salt-app.liquid"), sectionLiquid);
  await writeFile(resolve(themeDir, "snippets", "vs-judgeme-pdp-tabs.liquid"), judgemePdpTabsLiquid);

  await writeFile(resolve(themeDir, "templates", "index.json"), templateJson());
  await writeFile(resolve(themeDir, "templates", "product.json"), templateJson());
  await writeFile(resolve(themeDir, "templates", "collection.json"), templateJson());
  await writeFile(resolve(themeDir, "templates", "list-collections.json"), templateJson());
  await writeFile(resolve(themeDir, "templates", "cart.json"), templateJson());
  await writeFile(resolve(themeDir, "templates", "page.json"), templateJson());
  await writeFile(resolve(themeDir, "templates", "blog.json"), templateJson());
  await writeFile(resolve(themeDir, "templates", "article.json"), templateJson());
  await writeFile(resolve(themeDir, "templates", "search.json"), templateJson());
  await writeFile(resolve(themeDir, "templates", "404.json"), templateJson());
  await writeFile(
    resolve(themeDir, "templates", "robots.txt.liquid"),
    `{% for group in robots.default_groups %}
{{- group.user_agent_name -}}
{% for rule in group.rules %}
{{- rule -}}
{% endfor %}
{%- if group.sitemap != blank -%}
{{ group.sitemap }}
{%- endif -%}
{% endfor %}

# Private SALT operations routes
User-agent: *
Disallow: /pages/finance
Disallow: /apps:finance
Disallow: /apps/finance
`,
  );

  await writeFile(
    resolve(themeDir, "config", "settings_schema.json"),
    JSON.stringify(
      [
        {
          name: `${themeBrandName} App Theme`,
          settings: [
            {
              type: "paragraph",
              content: `${themeBrandName} storefront presentation is managed in code.`,
            },
          ],
        },
      ],
      null,
      2,
    ),
  );
  await writeFile(
    resolve(themeDir, "config", "settings_data.json"),
    settingsData || JSON.stringify({ current: {} }, null, 2),
  );
  await writeFile(resolve(themeDir, "locales", "en.default.json"), JSON.stringify({}, null, 2));
}

async function copyAssets(entryJsPath, entryCssPath) {
  await cp(resolve(distDir, "assets"), themeAssetsDir, { recursive: true });

  const entryJs = basename(entryJsPath);
  const entryCss = basename(entryCssPath);

  const entryAssetPath = resolve(themeAssetsDir, entryJs);
  const entrySource = await readFile(entryAssetPath, "utf8");
  // Vite emits lazy-chunk preload paths relative to the web root ("assets/").
  // In Shopify, the entry is served from /cdn/shop/.../assets, so make those
  // paths relative to the entry file instead. This keeps lazy chunks on the
  // Shopify CDN instead of requesting non-existent /assets/* URLs.
  const themeAssetResolver = `const __saltThemeAsset=(path)=>{const rawBase=globalThis.SALT_THEME_ASSET_BASE||new URL("./",import.meta.url).href;const base=rawBase.startsWith("//")?window.location.protocol+rawBase:rawBase;const file=String(path);return new URL(file.startsWith("./")?file.slice(2):file,base).href};\n`;
  const themeEntrySource =
    themeAssetResolver +
    entrySource
      .replace(/(["'])assets\//g, "$1./")
      // The lazy route imports and their modulepreload maps are generated as
      // relative URLs. Shopify resolves these from the current storefront path
      // on product pages, so point both mechanisms at the theme CDN explicitly.
      .replace(/import\("\.\/([^"\n]+)"\)/g, 'import(__saltThemeAsset("$1"))')
      .replace(/=>i\.map\(i=>d\[i\]\)/g, "=>i.map(i=>__saltThemeAsset(d[i]))")
      // Vite's preload helper prefixes every dependency with "/". That works
      // when assets live at /assets, but makes Shopify request the storefront
      // root instead of the theme CDN. Dependencies above are now relative, so
      // keep them relative when the helper creates modulepreload links too.
      .replace(
        /(="modulepreload",[A-Za-z_$][\w$]*=function\((\w+)\)\{return)"\/"\+\2(\})/,
        "$1 $2$3",
      );
  const entryCacheKey = createHash("sha256").update(themeEntrySource).digest("hex").slice(0, 12);
  const themeEntryJs = `salt-entry-${entryCacheKey}.js`;
  const themeEntryAssetPath = resolve(themeAssetsDir, themeEntryJs);
  await writeFile(themeEntryAssetPath, themeEntrySource);
  await rm(entryAssetPath);

  // Some lazy chunks import the Vite entry directly. Point every one at the
  // processed, content-addressed entry so the theme has exactly one React
  // runtime and Shopify's CDN cannot retain a stale entry bundle.
  for (const asset of await readdir(themeAssetsDir)) {
    if (!asset.endsWith(".js") || asset === themeEntryJs) {
      continue;
    }

    const assetPath = resolve(themeAssetsDir, asset);
    const assetSource = await readFile(assetPath, "utf8");
    const needsVitePreloadResolver = assetSource.includes("__vite__mapDeps");
    const rewrittenAssetBody = assetSource
      // Vite's nested lazy chunks keep preload maps such as
      // "assets/index-*.css". Shopify serves the chunk from its asset folder,
      // so those must be relative to that chunk rather than nested under a
      // second `/assets/` path.
      .replace(/(["'])assets\//g, "$1./")
      .replaceAll(`./${entryJs}`, `./${themeEntryJs}`)
      // A prior theme build may already have rewritten a lazy chunk to an
      // older salt-entry file. Repoint every such import so React has exactly
      // one runtime across the app shell and route chunks.
      .replace(/\.\/salt-entry-[A-Za-z0-9_-]+\.js/g, `./${themeEntryJs}`);
    const rewrittenAssetSource = needsVitePreloadResolver
      ? `const __saltThemeAsset=(path)=>{const value=String(path);return new URL(value.startsWith("./")?value.slice(2):value,import.meta.url).href};\n${rewrittenAssetBody}`.replace(
          /=>i\.map\(i=>d\[i\]\)/g,
          "=>i.map(i=>__saltThemeAsset(d[i]))",
        )
      : rewrittenAssetBody;
    if (rewrittenAssetSource !== assetSource) {
      await writeFile(assetPath, rewrittenAssetSource);
    }
  }

  // Do not duplicate the Vite entry bundle under a second filename. Lazy
  // chunks import the original hashed entry, and copying it to salt-app.js
  // creates a second React runtime (which causes invalid-hook/removeChild
  // crashes). The stable Shopify asset is only a module loader.
  // Shopify can resolve a relative module import against the storefront URL
  // (for example, /products/) instead of the theme asset URL. Start the Vite
  // entry from the absolute theme asset base exposed by the Liquid section so
  // every lazy product-page chunk stays on the Shopify CDN.
  await writeFile(
    resolve(themeAssetsDir, "salt-app.js"),
    `const rawBase = globalThis.SALT_THEME_ASSET_BASE || new URL("./", import.meta.url).href;\nconst base = rawBase.startsWith("//") ? window.location.protocol + rawBase : rawBase;\nimport(new URL(${JSON.stringify(themeEntryJs)}, base).href);\n`,
  );
  await cp(resolve(distDir, "assets", entryCss), resolve(themeAssetsDir, "salt-app.css"));

  if (themeLogoAsset === "brand-salt-logo.png") {
    await copyAssetWithTrackedFallback(
      legacyBrandLogoPath,
      resolve(themeAssetsDir, themeLogoAsset),
      "public/brand/salt-logo.png",
    );
  } else {
    await copyAssetWithTrackedFallback(
      resolve(publicDir, "favicon.svg"),
      resolve(themeAssetsDir, themeLogoAsset),
      "public/favicon.svg",
    );
  }
  for (const asset of [
    "favicon.svg",
    "favicon.ico",
    "favicon-32x32.png",
    "favicon-16x16.png",
    "apple-touch-icon.png",
    "site.webmanifest",
    "android-chrome-192x192.png",
    "android-chrome-512x512.png",
    "future-light-meta-events.js",
    "shopify-meta-pixel-customer-events.js",
  ]) {
    const sourcePath = resolve(publicDir, asset);
    if (!existsSync(sourcePath)) continue;
    try {
      await copyAssetWithTrackedFallback(
        sourcePath,
        resolve(themeAssetsDir, asset),
        `public/${asset}`,
      );
    } catch {
      // Optional icons and analytics helpers should never block a release.
    }
  }

  const existingCatalogAssets = (await readdir(themeAssetsDir)).filter((asset) =>
    THEME_CATALOG_ASSET_PATTERN.test(asset),
  );
  await Promise.all(existingCatalogAssets.map((asset) => rm(resolve(themeAssetsDir, asset), { force: true })));

  return themeEntryJs;
}

async function main() {
  await ensureDistExists();
  const indexHtml = await readFile(resolve(distDir, "index.html"), "utf8");
  const { jsPath, cssPath } = parseEntryAssets(indexHtml);
  const settingsDataPath = resolve(themeDir, "config", "settings_data.json");
  const settingsData = existsSync(settingsDataPath)
    ? await readFile(settingsDataPath, "utf8")
    : null;
  const distAssets = await readdir(resolve(distDir, "assets"));
  const routeAssets = {
    home: distAssets.find((asset) => /^HomePage-[A-Za-z0-9_-]+\.js$/.test(asset)) || "",
    product: distAssets.find((asset) => /^ProductPage-[A-Za-z0-9_-]+\.js$/.test(asset)) || "",
  };

  await mkdir(themeDir, { recursive: true });
  await Promise.all(
    themeScaffoldEntries.map((entry) =>
      rm(resolve(themeDir, entry), { recursive: true, force: true }),
    ),
  );
  // Keep Shopify-admin app embeds and theme-editor state intact. The generated
  // app bundle owns the app assets, not config/settings_data.json.
  const themeEntryJs = await copyAssets(jsPath, cssPath);
  await writeThemeScaffold(
    settingsData,
    { ...routeAssets, entry: themeEntryJs },
  );

  process.stdout.write(`Shopify theme bundle generated at ${themeDir}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
