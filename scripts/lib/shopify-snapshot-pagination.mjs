function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function validatePageInfo(pageInfo, connectionName, productId) {
  if (typeof pageInfo?.hasNextPage !== "boolean") {
    throw new Error(
      `Shopify ${connectionName} connection for ${productId} is missing pagination evidence.`,
    );
  }
  if (
    pageInfo.hasNextPage &&
    (typeof pageInfo.endCursor !== "string" || pageInfo.endCursor.length === 0)
  ) {
    throw new Error(
      `Shopify ${connectionName} connection for ${productId} hasNextPage without an end cursor.`,
    );
  }
}

/** Read every page of one Shopify connection without mixing its cursor with another connection. */
export async function readCompleteShopifyConnection({
  initialConnection,
  readPage,
  connectionName,
  productId,
}) {
  if (!initialConnection || !Array.isArray(initialConnection.nodes)) {
    throw new Error(
      `Shopify snapshot is missing the ${connectionName} connection for ${productId}.`,
    );
  }
  if (typeof readPage !== "function") {
    throw new Error(`Shopify snapshot requires a page reader for ${connectionName}.`);
  }

  const nodes = [...initialConnection.nodes];
  const seenIds = new Set();
  for (const node of nodes) {
    if (typeof node?.id === "string") {
      if (seenIds.has(node.id))
        throw new Error(`Duplicate ${connectionName} node ${node.id} for ${productId}.`);
      seenIds.add(node.id);
    }
  }

  let pageInfo = initialConnection.pageInfo;
  validatePageInfo(pageInfo, connectionName, productId);
  let pageCount = 1;
  while (pageInfo.hasNextPage) {
    const cursor = pageInfo.endCursor;
    const nextConnection = await readPage(cursor);
    if (!nextConnection || !Array.isArray(nextConnection.nodes)) {
      throw new Error(`Shopify returned no ${connectionName} continuation for ${productId}.`);
    }
    const nextNodes = asArray(nextConnection.nodes);
    if (nextNodes.length === 0) {
      throw new Error(
        `Shopify returned an empty ${connectionName} continuation while more pages were reported for ${productId}.`,
      );
    }
    for (const node of nextNodes) {
      if (typeof node?.id === "string") {
        if (seenIds.has(node.id))
          throw new Error(`Duplicate ${connectionName} node ${node.id} for ${productId}.`);
        seenIds.add(node.id);
      }
    }
    nodes.push(...nextNodes);
    pageCount += 1;
    if (pageCount > 1000)
      throw new Error(`Shopify ${connectionName} pagination exceeded 1000 pages for ${productId}.`);
    pageInfo = nextConnection.pageInfo;
    validatePageInfo(pageInfo, connectionName, productId);
  }

  return {
    nodes,
    pageInfo: { ...pageInfo, hasNextPage: false },
    pageCount,
  };
}
