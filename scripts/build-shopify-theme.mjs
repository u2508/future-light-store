#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

const rootDir = process.cwd();
const distDir = resolve(rootDir, "dist");
const publicDir = resolve(rootDir, "public");
const defaultThemeDir = resolve(
  process.env.SALT_SHOPIFY_THEME_DIR ||
    process.env.SHOPIFY_THEME_DIR ||
    resolve(rootDir, "..", "future-light-store-shopify"),
);
const financeApiOrigin = (process.env.VITE_FINANCE_API_ORIGIN || "")
  .trim()
  .replace(/\/+$/, "");
const shopifyAppKey = (process.env.VITE_SHOPIFY_APP_KEY || "").trim();
const themeBrandName = (process.env.SALT_THEME_BRAND_NAME || "Future Light Store").trim();
const judgemePublicToken = (process.env.SALT_JUDGEME_PUBLIC_TOKEN || "").trim();
const legacyBrandLogoPath = resolve(publicDir, "brand", "salt-logo.png");
const themeLogoAsset = existsSync(legacyBrandLogoPath) ? "brand-salt-logo.png" : "future-light-logo.svg";
const themeIconAsset = existsSync(resolve(publicDir, "favicon.svg")) ? "favicon.svg" : "favicon.ico";

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
const themeDataAssets = [
  { source: "products.json", asset: "data-products.json", themePath: "/data/products.json" },
  {
    source: "home-featured-products.json",
    asset: "data-home-featured-products.json",
    themePath: "/data/home-featured-products.json",
  },
  {
    source: "home-collection-products.json",
    asset: "data-home-collection-products.json",
    themePath: "/data/home-collection-products.json",
  },
  {
    source: "recently-ordered-products.json",
    asset: "data-recently-ordered-products.json",
    themePath: "/data/recently-ordered-products.json",
  },
  { source: "product-search.json", asset: "data-product-search.json", themePath: "/data/product-search.json" },
  { source: "collections.json", asset: "data-collections.json", themePath: "/data/collections.json" },
  {
    source: "collection-products.json",
    asset: "data-collection-products.json",
    themePath: "/data/collection-products.json",
  },
  { source: "about.json", asset: "data-about.json", themePath: "/data/about.json" },
  { source: "blog-posts.json", asset: "data-blog-posts.json", themePath: "/data/blog-posts.json" },
  { source: "shop.json", asset: "data-shop.json", themePath: "/data/shop.json" },
];
const PRODUCT_SHARD_SOURCE_PATTERN = /^products-\d{4}\.json$/;
const PRODUCT_SEARCH_SHARD_SOURCE_PATTERN = /^product-search-\d{4}\.json$/;

function serializeInlineJson(value) {
  return JSON.stringify(value ?? null).replace(/</g, "\\u003c");
}

function buildThemeAssetMapEntries() {
  return themeDataAssets
    .map(
      ({ themePath, asset }) =>
        `    ${JSON.stringify(themePath)}: {{ '${asset}' | asset_url | json }}`,
    )
    .join(",\n");
}

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

async function writeThemeScaffold(settingsData = null, routeAssets = {}, homeFeaturedProductsPayload = null) {
  await mkdir(resolve(themeDir, "layout"), { recursive: true });
  await mkdir(resolve(themeDir, "sections"), { recursive: true });
  await mkdir(resolve(themeDir, "templates"), { recursive: true });
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
    {% assign salt_seo_description = page_description | default: shop.description | default: 'Shop curated cookware, gifts, apparel, and everyday essentials from SALT Online Store.' %}
    {% assign salt_seo_robots = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1' %}
    {% assign salt_seo_canonical = canonical_url | split: '?' | first %}
    {% assign salt_custom_canonical = false %}
    {% capture salt_content_for_header %}{{ content_for_header }}{% endcapture %}

    {% if salt_route == '/' %}
      {% assign salt_seo_title = 'SALT Online Store | Curated essentials and giftable finds' %}
      {% assign salt_seo_description = 'Shop practical, giftable finds across cookware, home, beauty, apparel, gadgets, and everyday essentials.' %}
      {% assign salt_seo_canonical = 'https://' | append: request.host | append: '/' %}
      {% assign salt_custom_canonical = true %}
    {% elsif salt_route == '/pages/finance' or salt_route == '/apps:finance' or salt_route == '/apps/finance' %}
      {% assign salt_seo_title = 'SALT Finance | Private Operations' %}
      {% assign salt_seo_description = 'Private SALT operations workspace.' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
    {% elsif salt_route == '/shop' %}
      {% assign salt_seo_title = 'Shop All Products | SALT Online Store' %}
      {% assign salt_seo_description = 'Browse the live SALT catalog of cookware, gifts, apparel, beauty, gadgets, and everyday essentials.' %}
      {% assign salt_seo_canonical = 'https://' | append: request.host | append: '/shop' %}
      {% assign salt_custom_canonical = true %}
    {% elsif salt_route == '/search' %}
      {% assign salt_seo_title = 'Search SALT Online Store' %}
      {% assign salt_seo_description = 'Search the live SALT catalog for products, collections, and everyday essentials.' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
      {% assign salt_seo_canonical = 'https://' | append: request.host | append: '/search' %}
      {% assign salt_custom_canonical = true %}
    {% elsif salt_route contains '/collections/' %}
      {% assign salt_seo_canonical = 'https://' | append: request.host | append: salt_route %}
      {% assign salt_custom_canonical = true %}
    {% elsif salt_route == '/cart' or salt_route == '/wishlist' or salt_route == '/recently-viewed' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
    {% elsif salt_route == '/pages/wishlist' %}
      {% assign salt_seo_title = 'Wishlist | SALT Online Store' %}
      {% assign salt_seo_description = 'Save SALT products for later and keep track of items you love.' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
    {% elsif salt_route == '/pages/resources' %}
      {% assign salt_seo_title = 'Resource Hub | SALT Online Store' %}
      {% assign salt_seo_description = 'Practical guides that help shoppers discover the right SALT products, collections, and everyday solutions.' %}
    {% elsif salt_route == '/pages/faq' %}
      {% assign salt_seo_title = 'FAQ | SALT Online Store' %}
      {% assign salt_seo_description = 'Quick answers about SALT ordering, shipping, returns, and product support.' %}
    {% elsif salt_route == '/pages/contact-us' %}
      {% assign salt_seo_title = 'Contact Support | SALT Online Store' %}
      {% assign salt_seo_description = 'Reach the SALT support team for delivery questions, product advice, returns, or order help.' %}
    {% elsif salt_route == '/pages/about-us' %}
      {% assign salt_seo_title = 'About SALT Online Store' %}
      {% assign salt_seo_description = 'Learn how SALT makes practical products easy to discover, save, and buy.' %}
    {% elsif salt_route == '/pages/blog' %}
      {% assign salt_seo_title = 'SALT Journal | SALT Online Store' %}
      {% assign salt_seo_description = 'Fresh stories, product education, and practical ideas from SALT.' %}
    {% elsif salt_route == '/pages/affiliate-program' %}
      {% assign salt_seo_title = 'Affiliate Program | SALT Online Store' %}
      {% assign salt_seo_description = 'Learn how to partner with SALT and share useful products with your audience.' %}
    {% elsif salt_route == '/pages/mission-vision' %}
      {% assign salt_seo_title = 'Mission & Vision | SALT Online Store' %}
      {% assign salt_seo_description = 'Learn what SALT is building and how we make everyday shopping easier.' %}
    {% elsif salt_route == '/pages/wholesale-inquiries' %}
      {% assign salt_seo_title = 'Wholesale Inquiries | SALT Online Store' %}
      {% assign salt_seo_description = 'Contact SALT about wholesale, gifting, and business purchasing opportunities.' %}
    {% elsif salt_route == '/pages/terms-conditions' %}
      {% assign salt_seo_title = 'Terms & Conditions | SALT Online Store' %}
      {% assign salt_seo_description = 'Review the terms that apply when using the SALT Online Store.' %}
    {% elsif salt_route == '/pages/track-order' %}
      {% assign salt_seo_title = 'Track Order | SALT Online Store' %}
      {% assign salt_seo_description = 'Use the secure order portal to review your order status and delivery details.' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
    {% elsif salt_route == '/pages/recently-viewed' %}
      {% assign salt_seo_title = 'Recently Viewed | SALT Online Store' %}
      {% assign salt_seo_description = 'Pick up where you left off with products viewed on this device.' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
    {% elsif request.page_type == '404' %}
      {% assign salt_seo_robots = 'noindex,follow' %}
    {% endif %}

    {% if request.page_type == 'product' and product %}
      {%- comment -%}
        Shopify's native SEO fields belong to the product, but the selected
        variant is available during Liquid rendering. Include its identity in
        the request-time metadata so a backpack/bottle/lunch-box variant does
        not inherit an unrelated product-only title or description.
      {%- endcomment -%}
      {% assign salt_selected_variant = product.selected_or_first_available_variant %}
      {% assign salt_variant_label = salt_selected_variant.title | default: '' | strip %}
      {% unless salt_variant_label == blank or salt_variant_label == 'Default Title' %}
        {% assign salt_seo_title = product.title | append: ' - ' | append: salt_variant_label | append: ' | SALT Online Store' %}
        {% assign salt_variant_description = product.description | strip_html | strip_newlines | truncate: 115 %}
        {% assign salt_seo_description = salt_variant_description | append: ' Selected option: ' | append: salt_variant_label | append: '.' %}
      {% endunless %}
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
    {% if salt_custom_canonical %}
      <link rel="canonical" href="{{ salt_seo_canonical | escape }}">
    {% endif %}
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
        // Meta's remote structured-signal rules currently mistake Shopify's
        // Apple Pay JSON blob for a currency code and crawl the full app shell.
        // Hide only those two selectors from Meta's own call stack; Shopify and
        // every storefront feature continue to receive the native DOM results.
        var blockedMetaSelectors = new Set(['#apple-pay-shop-capabilities', '.site-shell']);
        var nativeQuerySelector = Document.prototype.querySelector;
        var nativeQuerySelectorAll = Document.prototype.querySelectorAll;
        var nativeSendBeacon = Navigator.prototype.sendBeacon;
        var nativeFetch = window.fetch;

        // Shopify intentionally starts an Apple Private Access Token flow with
        // a 401 challenge. WebDriver browsers cannot complete Apple device
        // attestation, so keep the production Safari flow untouched while
        // making automated storefront checks deterministic and error-free.
        if (navigator.webdriver && typeof nativeFetch === 'function') {
          window.fetch = function (input, init) {
            var rawUrl = typeof input === 'string' ? input : input && input.url;

            try {
              var requestUrl = new URL(String(rawUrl || ''), window.location.href);
              if (
                requestUrl.origin === window.location.origin &&
                requestUrl.pathname === '/sf_private_access_tokens'
              ) {
                window.__SALT_AUTOMATION_PAT_BYPASS__ = true;
                return Promise.resolve(new Response(null, { status: 204 }));
              }
            } catch (error) {
              // Preserve native fetch behavior for malformed or unsupported inputs.
            }

            return nativeFetch.call(this, input, init);
          };
        }

        function isMetaCrawlerCall() {
          return /(?:connect\\.facebook\\.net|fbevents)/i.test(String(new Error().stack || ''));
        }

        Document.prototype.querySelector = function (selector) {
          if (blockedMetaSelectors.has(String(selector)) && isMetaCrawlerCall()) return null;
          return nativeQuerySelector.call(this, selector);
        };

        Document.prototype.querySelectorAll = function (selector) {
          if (blockedMetaSelectors.has(String(selector)) && isMetaCrawlerCall()) {
            return document.createDocumentFragment().querySelectorAll('*');
          }
          return nativeQuerySelectorAll.call(this, selector);
        };

        // Meta can exhaust WebKit's shared 64 KB keepalive queue when Shopify
        // pixels initialize together. Deliver only Meta's tracking endpoint
        // through a normal non-blocking fetch so events still reach Facebook
        // without producing a storefront Beacon API error.
        if (typeof nativeSendBeacon === 'function') {
          Navigator.prototype.sendBeacon = function (url, data) {
            var target = String(url || '');

            if (/^https:\\/\\/(?:www\\.)?facebook\\.com\\/tr\\//i.test(target)) {
              try {
                window.fetch(target, {
                  method: 'POST',
                  body: data == null ? undefined : data,
                  mode: 'no-cors',
                  credentials: 'omit',
                  keepalive: false,
                }).catch(function () {});
                return true;
              } catch (error) {
                return nativeSendBeacon.call(this, url, data);
              }
            }

            return nativeSendBeacon.call(this, url, data);
          };
        }
      })();
    </script>
    {% if salt_custom_canonical %}
      {% assign salt_native_canonical_tag = '<link rel="canonical" href="' | append: canonical_url | append: '">' %}
      {{ salt_content_for_header | remove: salt_native_canonical_tag }}
    {% else %}
      {{ salt_content_for_header }}
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
    {% if request.page_type == 'index' %}
      <script>
        (function () {
          window.__SALT_HOME_PREFETCH__ = ${serializeInlineJson(homeFeaturedProductsPayload)};
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

const sectionLiquid = `<div
  id="root"
  data-shop-base-url="https://{{ request.host | escape }}"
  data-shop-domain="{{ shop.permanent_domain | escape }}"
  data-shop-name="{{ shop.name | escape }}"
  data-judgeme-shop-domain="{{ shop.permanent_domain | escape }}"
  data-judgeme-public-token="${judgemePublicToken}"
  data-currency="{{ cart.currency.iso_code | default: shop.currency | escape }}"
></div>
<script>
  window.SALT_THEME_BUILD = ${JSON.stringify(themeBuildStamp)};
  window.SALT_FINANCE_API_ORIGIN = ${JSON.stringify(financeApiOrigin)};
  window.SALT_SHOPIFY_APP_KEY = ${JSON.stringify(shopifyAppKey)};
  window.SALT_THEME_ASSET_BASE = {{ 'salt-app.js' | asset_url | split: 'salt-app.js' | first | json }};
  window.SALT_THEME_ASSETS = {
    "/brand/salt-logo.png": {{ '${themeLogoAsset}' | asset_url | json }},
    "/brand-salt-logo.png": {{ '${themeLogoAsset}' | asset_url | json }},
${buildThemeAssetMapEntries()}
  };
</script>
`;

  const storeThemeLiquid = themeLiquid
    .replaceAll("SALT Online Store", themeBrandName)
    .replaceAll("SALT App Theme", `${themeBrandName} App Theme`)
    .replaceAll("SALT storefront", `${themeBrandName} storefront`);
  await writeFile(resolve(themeDir, "layout", "theme.liquid"), storeThemeLiquid);
  await writeFile(resolve(themeDir, "sections", "salt-app.liquid"), sectionLiquid);

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
  const themeEntrySource = themeAssetResolver + entrySource
    .replace(/(["'])assets\//g, "$1./")
    // The lazy route imports and their modulepreload maps are generated as
    // relative URLs. Shopify resolves these from the current storefront path
    // on product pages, so point both mechanisms at the theme CDN explicitly.
    .replace(/import\("\.\/([^"\n]+)"\)/g, 'import(__saltThemeAsset("$1"))')
    .replace(/=>i\.map\(i=>d\[i\]\)/g, '=>i.map(i=>__saltThemeAsset(d[i]))')
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
      ? `const __saltThemeAsset=(path)=>{const value=String(path);return new URL(value.startsWith("./")?value.slice(2):value,import.meta.url).href};\n${rewrittenAssetBody}`
          .replace(/=>i\.map\(i=>d\[i\]\)/g, "=>i.map(i=>__saltThemeAsset(d[i]))")
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
    await cp(legacyBrandLogoPath, resolve(themeAssetsDir, themeLogoAsset));
  } else {
    await cp(resolve(publicDir, "favicon.svg"), resolve(themeAssetsDir, themeLogoAsset));
  }
  for (const asset of ["favicon.svg", "favicon.ico", "favicon-32x32.png", "favicon-16x16.png", "apple-touch-icon.png", "site.webmanifest", "android-chrome-192x192.png", "android-chrome-512x512.png", "shopify-meta-pixel-customer-events.js"]) {
    if (!existsSync(resolve(publicDir, asset))) continue;
    await cp(resolve(publicDir, asset), resolve(themeAssetsDir, asset));
  }

  const existingProductShardAssets = (await readdir(themeAssetsDir)).filter((asset) =>
    /^data-products-\d{4}\.json$/.test(asset),
  );
  const existingProductSearchShardAssets = (await readdir(themeAssetsDir)).filter((asset) =>
    /^data-product-search-\d{4}\.json$/.test(asset),
  );
  await Promise.all(
    [...existingProductShardAssets, ...existingProductSearchShardAssets].map((asset) =>
      rm(resolve(themeAssetsDir, asset), { force: true }),
    ),
  );

  for (const asset of themeDataAssets) {
    await cp(resolve(publicDir, "data", asset.source), resolve(themeAssetsDir, asset.asset));
  }

  return themeEntryJs;
}

async function main() {
  await ensureDistExists();
  const indexHtml = await readFile(resolve(distDir, "index.html"), "utf8");
  const { jsPath, cssPath } = parseEntryAssets(indexHtml);
  const settingsDataPath = resolve(themeDir, "config", "settings_data.json");
  const settingsData = existsSync(settingsDataPath) ? await readFile(settingsDataPath, "utf8") : null;
  const homeFeaturedProductsPath = resolve(publicDir, "data", "home-featured-products.json");
  const homeFeaturedProductsPayload = existsSync(homeFeaturedProductsPath)
    ? JSON.parse(await readFile(homeFeaturedProductsPath, "utf8"))
    : null;
  const distAssets = await readdir(resolve(distDir, "assets"));
  const routeAssets = {
    home: distAssets.find((asset) => /^HomePage-[A-Za-z0-9_-]+\.js$/.test(asset)) || "",
    product: distAssets.find((asset) => /^ProductPage-[A-Za-z0-9_-]+\.js$/.test(asset)) || "",
  };

  const productShardSources = (await readdir(resolve(publicDir, "data")))
    .filter((source) => PRODUCT_SHARD_SOURCE_PATTERN.test(source))
    .sort();
  for (const source of productShardSources) {
    themeDataAssets.push({
      source,
      asset: `data-${source}`,
      themePath: `/data/${source}`,
    });
  }

  const productSearchShardSources = (await readdir(resolve(publicDir, "data")))
    .filter((source) => PRODUCT_SEARCH_SHARD_SOURCE_PATTERN.test(source))
    .sort();
  for (const source of productSearchShardSources) {
    themeDataAssets.push({
      source,
      asset: `data-${source}`,
      themePath: `/data/${source}`,
    });
  }

  await mkdir(themeDir, { recursive: true });
  await Promise.all(
    themeScaffoldEntries.map((entry) =>
      rm(resolve(themeDir, entry), { recursive: true, force: true }),
    ),
  );
  // Keep Shopify-admin app embeds and theme-editor state intact. The generated
  // app bundle owns the app assets, not config/settings_data.json.
  const themeEntryJs = await copyAssets(jsPath, cssPath);
  await writeThemeScaffold(settingsData, { ...routeAssets, entry: themeEntryJs }, homeFeaturedProductsPayload);

  process.stdout.write(`Shopify theme bundle generated at ${themeDir}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
