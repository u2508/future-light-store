/** Collect every variant page and reject partial, looping, duplicate, or mis-sized results. */
export async function collectCompleteVariantEdges(initialConnection, fetchNextPage, expectedCount) {
  const edges = Array.isArray(initialConnection?.edges) ? [...initialConnection.edges] : null;
  if (!edges) throw new Error("Shopify product returned no variant connection");

  const expected = Number.isInteger(expectedCount) && expectedCount >= 0 ? expectedCount : null;
  if (expected !== null && edges.length > expected) {
    throw new Error("Shopify returned more variants than its verified count");
  }

  const seenIds = new Set();
  for (const edge of edges) {
    const id = edge?.node?.id;
    if (!id || seenIds.has(id)) throw new Error("Shopify returned an invalid or duplicate variant");
    seenIds.add(id);
  }

  let pageInfo = initialConnection?.pageInfo;
  const seenCursors = new Set();
  while (pageInfo?.hasNextPage === true) {
    const cursor = pageInfo.endCursor;
    if (!cursor || seenCursors.has(cursor)) {
      throw new Error("Shopify variant pagination did not advance");
    }
    seenCursors.add(cursor);

    const nextConnection = await fetchNextPage(cursor);
    const nextEdges = nextConnection?.edges;
    if (!Array.isArray(nextEdges) || nextEdges.length === 0) {
      throw new Error("Shopify returned an incomplete variant page");
    }
    for (const edge of nextEdges) {
      const id = edge?.node?.id;
      if (!id || seenIds.has(id)) throw new Error("Shopify returned an invalid or duplicate variant");
      seenIds.add(id);
      edges.push(edge);
    }
    if (expected !== null && edges.length > expected) {
      throw new Error("Shopify variant pages exceed the verified variant count");
    }

    pageInfo = nextConnection.pageInfo;
    if (!pageInfo || typeof pageInfo.hasNextPage !== "boolean") {
      throw new Error("Shopify returned incomplete variant pagination metadata");
    }
  }

  if (!pageInfo || pageInfo.hasNextPage !== false) {
    throw new Error("Shopify variant pagination is incomplete");
  }
  if (expected !== null && edges.length !== expected) {
    throw new Error("Shopify variant pages do not match the verified variant count");
  }
  return edges;
}
