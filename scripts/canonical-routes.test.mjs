import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalUrl, SITE_URL } from "../src/lib/seo.ts";

const routeContracts = [
  {
    file: "src/routes/products.$handle.tsx",
    route: "/products/$handle",
    expectedExpression: "canonicalUrl(`/products/${params.handle}`)",
  },
  {
    file: "src/routes/collections.$handle.tsx",
    route: "/collections/$handle",
    expectedExpression: "canonicalUrl(`/collections/${params.handle}`)",
  },
  {
    file: "src/routes/collections.index.tsx",
    route: "/collections/",
    expectedExpression: 'canonicalUrl("/collections")',
  },
  {
    file: "src/routes/shop.tsx",
    route: "/shop",
    expectedExpression: 'canonicalUrl("/shop")',
  },
];

for (const contract of routeContracts) {
  const source = await readFile(new URL(`../${contract.file}`, import.meta.url), "utf8");
  const canonicalDeclarations = source.match(/rel:\s*["']canonical["']/g) ?? [];

  assert.equal(
    canonicalDeclarations.length,
    1,
    `${contract.route} must declare exactly one canonical link`,
  );
  assert.ok(
    source.includes(contract.expectedExpression),
    `${contract.route} must build its canonical from the clean route pathname`,
  );
}

const canonicalCases = [
  ["/shop?q=lamp&sort=price-desc#catalog", `${SITE_URL}/shop`],
  ["/collections/?utm_source=google#grid", `${SITE_URL}/collections`],
  ["/collections/home-decor?sort=best-selling", `${SITE_URL}/collections/home-decor`],
  ["/products/example-product?variant=123#details", `${SITE_URL}/products/example-product`],
  [
    "https://example.invalid/products/example-product?variant=123",
    `${SITE_URL}/products/example-product`,
  ],
];

for (const [input, expected] of canonicalCases) {
  const canonical = canonicalUrl(input);

  assert.equal(canonical, expected);
  assert.match(canonical, /^https:\/\//);
  assert.equal(new URL(canonical).search, "");
  assert.equal(new URL(canonical).hash, "");
}

console.log(
  `Canonical route audit passed for ${routeContracts.length} route patterns and ${canonicalCases.length} URL normalization cases.`,
);
