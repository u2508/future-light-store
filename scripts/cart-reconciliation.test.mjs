import test from "node:test";
import assert from "node:assert/strict";
import { reconcileCartSnapshot } from "../src/lib/cart-reconciliation.mjs";

const localItems = [
  {
    variantId: "gid://shopify/ProductVariant/101",
    variantTitle: "Blue / Small",
    price: { amount: "10.00", currencyCode: "USD" },
    quantity: 1,
    selectedOptions: [{ name: "Color", value: "Blue" }],
    product: { node: { title: "Example product" } },
  },
  {
    variantId: "gid://shopify/ProductVariant/202",
    variantTitle: "Default Title",
    price: { amount: "5.00", currencyCode: "USD" },
    quantity: 1,
    selectedOptions: [],
    product: { node: { title: "Another product" } },
  },
];

function line(id, variantId, quantity, amount, title, selectedOptions = []) {
  return {
    node: {
      id: `gid://shopify/CartLine/${id}`,
      quantity,
      merchandise: {
        id: `gid://shopify/ProductVariant/${variantId}`,
        title,
        price: { amount, currencyCode: "USD" },
        selectedOptions,
      },
    },
  };
}

function cart(edges, totalQuantity = edges.reduce((sum, edge) => sum + edge.node.quantity, 0)) {
  return { id: "cart-1", totalQuantity, lines: { edges, pageInfo: { hasNextPage: false } } };
}

test("refreshes Shopify prices, quantity, option labels, and line IDs; removes lines no longer in Shopify", () => {
  const snapshot = cart([
    line("new-101", "101", 2, "12.50", "Blue / Small", [{ name: "Color", value: "Blue" }]),
  ]);
  const result = reconcileCartSnapshot(localItems, snapshot);

  assert.equal(result.status, "reconciled");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].lineId, "gid://shopify/CartLine/new-101");
  assert.equal(result.items[0].quantity, 2);
  assert.deepEqual(result.items[0].price, { amount: "12.50", currencyCode: "USD" });
  assert.deepEqual(result.items[0].selectedOptions, [{ name: "Color", value: "Blue" }]);
  assert.equal(result.items[0].product, localItems[0].product);
});

test("clears only an explicit empty or expired Shopify cart", () => {
  assert.deepEqual(reconcileCartSnapshot(localItems, null), { status: "empty" });
  assert.deepEqual(
    reconcileCartSnapshot(localItems, cart([], 0)),
    { status: "empty" },
  );
});

test("holds incomplete pagination and inconsistent quantity snapshots", () => {
  const incomplete = cart([line("101", "101", 1, "10.00", "Blue / Small")]);
  incomplete.lines.pageInfo.hasNextPage = true;
  assert.deepEqual(reconcileCartSnapshot(localItems, incomplete), { status: "hold" });
  assert.deepEqual(
    reconcileCartSnapshot(localItems, cart([line("101", "101", 2, "10.00", "Blue / Small")], 1)),
    { status: "hold" },
  );
});

test("holds unknown or duplicate remote variants instead of losing cart context", () => {
  const unknown = cart([line("303", "303", 1, "7.00", "New variant")]);
  assert.deepEqual(reconcileCartSnapshot(localItems, unknown), { status: "hold" });

  const duplicate = cart([
    line("a", "101", 1, "10.00", "Blue / Small"),
    line("b", "101", 1, "10.00", "Blue / Small"),
  ]);
  assert.deepEqual(reconcileCartSnapshot(localItems, duplicate), { status: "hold" });
});
