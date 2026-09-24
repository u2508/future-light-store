# Judge.me reviews on the headless product page

The React product page now has a **Details / Reviews** tab pair. The Reviews tab renders the
Judge.me platform-independent legacy widget container. It does not create ratings, review counts,
testimonials, or buyer claims.

Judge.me's current documentation says external/headless widgets require the Awesome plan, the
Platform-independent widgets setting enabled in Judge.me Settings > Advanced, and the store-specific
script copied from that settings page. The new Review Widget version is not supported by this
headless mode; the legacy widget must be enabled. The supplied Liquid snippet is for Shopify-rendered
pages and is not by itself the complete React/headless integration.

## Required storefront configuration

The app intentionally has no guessed Judge.me loader URL or store identifier. Before deployment,
the storefront operator must enable the official headless widget in Judge.me, then obtain the exact
HTTPS loader URL from its store-generated script and inject this public configuration before the app
entry script runs:

```html
<script>
  window.__VS_STORE_JUDGEME__ = {
    widgetScriptUrl: "<exact HTTPS loader URL on cdn.judge.me supplied by Judge.me>",
    shopReviewsCount: 0
  };
</script>
```

Set `shopReviewsCount` to the actual public store-review count only if it is verified; otherwise
leave it at `0`. The URL must be HTTPS on `cdn.judge.me` and must not contain embedded
username/password credentials. Use only the trusted Judge.me URL generated for this store. The app
does not accept or expose a private API token. If Judge.me's generated storefront script includes
additional required bootstrap settings, add only the documented public configuration after
verifying the exact script; never substitute a Shopify Admin credential or Judge.me private token.

When the config is absent or invalid, or the product ID is not a Shopify Product GID, the tab fails
closed with a neutral message. A loader network error also produces a neutral message. The widget
uses Judge.me's documented `jdgm-outside-widget` class for the legacy headless widget. It never
claims that a product has no reviews merely because configuration or loading is unavailable.

## Headless/legacy data boundary

The current Storefront product query does not request `judgeme.widget` or
`judgeme.review_widget_data`, so the optional legacy HTML and preloaded JSON branches from the
Liquid snippet are not emitted. The standard widget loader is expected to fetch and render its own
current review data. Do not inject legacy HTML with `dangerouslySetInnerHTML`. If this Judge.me
account requires those metafields for rendering, first verify that the fields are Storefront-visible
and their exact value shapes, then add a typed, sanitized integration and tests.

## Local checks

```sh
node --test scripts/judgeme-review-config.test.mjs
npm run build:dev
```

`build:dev` is used for local frontend compilation because the normal `build` lifecycle performs
Shopify data synchronization before compilation.
