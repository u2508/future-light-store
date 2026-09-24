import test from "node:test";
import assert from "node:assert/strict";
import {
  BEST_SELLERS_LIMIT,
  NEW_ARRIVALS_LIMIT,
  buildMerchandisingCollectionMembership,
} from "../src/lib/merchandising-collection-rules.js";

function product(id, overrides = {}) {
  return {
    id: `gid://shopify/Product/${id}`,
    handle: `product-${id}`,
    status: "ACTIVE",
    updated_at: `2026-09-${String((id % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("New Arrivals returns at most 500 active products ordered by updated time", () => {
  const products = Array.from({ length: 502 }, (_, index) => product(index + 1, {
    updated_at: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
  }));
  products.push(product(9000, { status: "ARCHIVED", updated_at: "2030-01-01T00:00:00Z" }));

  const membership = buildMerchandisingCollectionMembership(products);
  assert.equal(NEW_ARRIVALS_LIMIT, 500);
  assert.equal(membership["new-arrivals"].length, 500);
  assert.equal(membership["new-arrivals"][0].handle, "product-502");
  assert.equal(membership["new-arrivals"].some((entry) => entry.status !== "ACTIVE"), false);
});

test("Best Sellers excludes catalog floor-fill rows without positive sales evidence", () => {
  const catalog = [product(1), product(2), product(3)];
  const membership = buildMerchandisingCollectionMembership(catalog, {
    source: "shopify-admin-orders-with-deterministic-catalog-floor-fill",
    products: [
      { handle: "product-1", orderCount: 2, quantitySold: 3 },
      { handle: "product-2" },
      { handle: "product-3", orderCount: 0, quantitySold: 0 },
    ],
  });

  assert.deepEqual(membership["best-sellers"].map((entry) => entry.handle), ["product-1"]);
});

test("Best Sellers is capped at 250 verified sellers and is never padded with new products", () => {
  const catalog = Array.from({ length: 300 }, (_, index) => product(index + 1));
  const orderFeed = {
    products: Array.from({ length: 275 }, (_, index) => ({
      handle: `product-${index + 1}`,
      orderCount: index + 1,
      quantitySold: index + 1,
    })),
  };
  const membership = buildMerchandisingCollectionMembership(catalog, orderFeed);

  assert.equal(BEST_SELLERS_LIMIT, 250);
  assert.equal(membership["best-sellers"].length, 250);
  assert.equal(membership["best-sellers"].every((entry) => Number(entry.id.split("/").at(-1)) <= 275), true);
});

test("timestamp aliases and stable IDs make New Arrivals deterministic", () => {
  const products = [
    product(12, { updated_at: undefined, updatedAt: "2026-09-20T12:00:00Z" }),
    product(13, { updated_at: undefined, updatedAt: "2026-09-20T12:00:00Z" }),
    product(11, { updated_at: "2026-09-19T12:00:00Z" }),
  ];
  const membership = buildMerchandisingCollectionMembership(products);
  assert.deepEqual(membership["new-arrivals"].map((entry) => entry.handle), ["product-13", "product-12", "product-11"]);
});
