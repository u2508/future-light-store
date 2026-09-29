import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCollectionAnswer,
  buildHomepageAnswer,
  buildHomepageMetaDescription,
  formatProductPriceRange,
  resolveCollectionProducts,
} from "./future-light-seo-page-content.mjs";

test("homepage answer uses the catalog snapshot and confirmed shipping promise", () => {
  const answer = buildHomepageAnswer({
    productCount: 2989,
    collectionCount: 100,
    catalogDate: "2026-09-26",
    shippingSummary:
      "Free standard US shipping; allow 1–2 processing days and 5–8 business days after dispatch.",
  });

  assert.match(answer, /2,989 product listings across 100 collections/);
  assert.match(answer, /snapshot dated 2026-09-26/);
  assert.match(answer, /Shopify checkout confirms the final total and delivery details/);
  assert.match(answer, /5–8 business days after dispatch/);
});

test("collection answer includes a dated, catalog-backed item count", () => {
  const answer = buildCollectionAnswer({
    title: "Home & Decor",
    productCount: 151,
    catalogDate: "2026-09-26",
  });

  assert.match(answer, /Home & Decor collection at VS Store contains 151 product listings/);
  assert.match(answer, /snapshot dated 2026-09-26/);
  assert.match(
    answer,
    /compare listing photos, product-specific details, variant options and prices/,
  );
});

test("homepage meta description uses factual catalog counts and stays concise", () => {
  const description = buildHomepageMetaDescription({ productCount: 2989, collectionCount: 113 });

  assert.match(description, /2,989 products across 113 VS Store collections/);
  assert.match(description, /5–8 business days after dispatch plus 1–2 processing days/);
  assert.ok(description.length <= 160);
});

test("product price range comes from the listed variant prices only", () => {
  assert.equal(
    formatProductPriceRange({ variants: [{ price: "29.99" }, { price: "34" }] }),
    "$29.99–$34.00",
  );
  assert.equal(formatProductPriceRange({ variants: [{ price: "29.99" }] }), "$29.99");
  assert.equal(formatProductPriceRange({ variants: [] }), "");
});

test("collection membership resolves only products present in the live product manifest", () => {
  const productsById = new Map([
    ["101", { id: 101, handle: "first" }],
    ["202", { id: 202, handle: "second" }],
  ]);

  assert.deepEqual(resolveCollectionProducts([101, "missing", 202], productsById), [
    { id: 101, handle: "first" },
    { id: 202, handle: "second" },
  ]);
  assert.deepEqual(resolveCollectionProducts(null, productsById), []);
});
