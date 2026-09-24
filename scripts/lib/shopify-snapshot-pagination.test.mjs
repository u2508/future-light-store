import assert from "node:assert/strict";
import test from "node:test";
import { readCompleteShopifyConnection } from "./shopify-snapshot-pagination.mjs";

test("reads each continuation with its own cursor and returns complete coverage", async () => {
  const cursors = [];
  const result = await readCompleteShopifyConnection({
    connectionName: "variants",
    productId: "gid://shopify/Product/1",
    initialConnection: {
      nodes: [{ id: "v1" }],
      pageInfo: { hasNextPage: true, endCursor: "variant-cursor-1" },
    },
    readPage: async (cursor) => {
      cursors.push(cursor);
      return {
        nodes: [{ id: "v2" }],
        pageInfo: { hasNextPage: false, endCursor: "variant-cursor-2" },
      };
    },
  });

  assert.deepEqual(cursors, ["variant-cursor-1"]);
  assert.deepEqual(
    result.nodes.map(({ id }) => id),
    ["v1", "v2"],
  );
  assert.equal(result.pageInfo.hasNextPage, false);
  assert.equal(result.pageCount, 2);
});

test("does not request another page for a completed connection", async () => {
  let requested = false;
  const result = await readCompleteShopifyConnection({
    connectionName: "media",
    productId: "gid://shopify/Product/1",
    initialConnection: { nodes: [{ id: "m1" }], pageInfo: { hasNextPage: false, endCursor: null } },
    readPage: async () => {
      requested = true;
    },
  });

  assert.equal(requested, false);
  assert.deepEqual(result.nodes, [{ id: "m1" }]);
});

test("fails closed for missing cursor, missing continuation, and empty continuation", async () => {
  const base = {
    connectionName: "metafields",
    productId: "gid://shopify/Product/1",
    initialConnection: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "cursor-1" } },
  };
  await assert.rejects(
    readCompleteShopifyConnection({
      ...base,
      initialConnection: { nodes: [], pageInfo: { hasNextPage: true } },
      readPage: async () => null,
    }),
    /hasNextPage without an end cursor/,
  );
  await assert.rejects(
    readCompleteShopifyConnection({
      ...base,
      initialConnection: { nodes: [] },
      readPage: async () => null,
    }),
    /missing pagination evidence/,
  );
  await assert.rejects(
    readCompleteShopifyConnection({ ...base, readPage: async () => null }),
    /returned no metafields continuation/,
  );
  await assert.rejects(
    readCompleteShopifyConnection({
      ...base,
      readPage: async () => ({ nodes: [], pageInfo: { hasNextPage: false } }),
    }),
    /empty metafields continuation/,
  );
  await assert.rejects(
    readCompleteShopifyConnection({
      ...base,
      readPage: async () => ({ nodes: [{ id: "m2" }] }),
    }),
    /missing pagination evidence/,
  );
});

test("rejects duplicate identities rather than silently dropping snapshot nodes", async () => {
  await assert.rejects(
    readCompleteShopifyConnection({
      connectionName: "media",
      productId: "gid://shopify/Product/1",
      initialConnection: {
        nodes: [{ id: "m1" }],
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
      },
      readPage: async () => ({ nodes: [{ id: "m1" }], pageInfo: { hasNextPage: false } }),
    }),
    /Duplicate media node m1/,
  );
});
