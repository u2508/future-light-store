import test from "node:test";
import assert from "node:assert/strict";
import { collectCompleteVariantEdges } from "../src/lib/shopify-variant-pagination.mjs";

const edge = (id) => ({ node: { id } });

test("collects all cursor pages and validates the final variant count", async () => {
  const result = await collectCompleteVariantEdges(
    { edges: [edge("1"), edge("2")], pageInfo: { hasNextPage: true, endCursor: "cursor-1" } },
    async (cursor) => {
      assert.equal(cursor, "cursor-1");
      return {
        edges: [edge("3")],
        pageInfo: { hasNextPage: false, endCursor: "cursor-2" },
      };
    },
    3,
  );
  assert.deepEqual(result.map((item) => item.node.id), ["1", "2", "3"]);
});

test("accepts a complete first page without making another request", async () => {
  const result = await collectCompleteVariantEdges(
    { edges: [edge("1")], pageInfo: { hasNextPage: false, endCursor: "cursor-1" } },
    async () => assert.fail("complete variant connection should not fetch another page"),
    1,
  );
  assert.deepEqual(result, [edge("1")]);
});

test("fails closed on missing cursors, duplicate variants, and count mismatches", async () => {
  await assert.rejects(
    collectCompleteVariantEdges(
      { edges: [edge("1")], pageInfo: { hasNextPage: true, endCursor: null } },
      async () => ({ edges: [edge("2")], pageInfo: { hasNextPage: false, endCursor: null } }),
      2,
    ),
    /did not advance/,
  );
  await assert.rejects(
    collectCompleteVariantEdges(
      { edges: [edge("1")], pageInfo: { hasNextPage: true, endCursor: "c1" } },
      async () => ({ edges: [edge("1")], pageInfo: { hasNextPage: false, endCursor: "c2" } }),
      2,
    ),
    /duplicate variant/,
  );
  await assert.rejects(
    collectCompleteVariantEdges(
      { edges: [edge("1")], pageInfo: { hasNextPage: false, endCursor: "c1" } },
      async () => [],
      2,
    ),
    /do not match/,
  );
});
