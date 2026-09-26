export function productMediaPaginationIssues(product) {
  const issues = [];
  const assertComplete = (connection, label) => {
    const hasNextPage = connection?.pageInfo?.hasNextPage;
    if (typeof hasNextPage !== "boolean") issues.push(`${label}:pagination-unverified`);
    else if (hasNextPage) issues.push(`${label}:has-next-page`);
  };

  assertComplete(product?.media, "product-media");
  assertComplete(product?.variants, "product-variants");
  for (const variant of product?.variants?.nodes || []) {
    assertComplete(variant?.media, `variant-media:${variant?.id || "unknown"}`);
  }
  return issues;
}

export function assertCompleteProductMediaPagination(product) {
  const issues = productMediaPaginationIssues(product);
  if (issues.length) {
    throw new Error(
      `Incomplete media or variant pagination for ${product?.handle || product?.id || "unknown product"}: ${issues.slice(0, 8).join(", ")}`,
    );
  }
  return product;
}
