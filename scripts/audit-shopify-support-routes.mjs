import { createShopifyAdminGraphQLClient, asArray } from "./shopify-admin-graphql-client.mjs";

const client = createShopifyAdminGraphQLClient({
  rootDir: process.cwd(),
  agentName: "support-route-audit",
});

const pageHandles = ["about-us", "contact-us", "resources", "faq", "wishlist"];
const redirects = ["/about", "/contact", "/resources", "/faq", "/wishlist"];

const pagesData = await client.run(
  `#graphql
    query SupportRoutePages($query: String!) {
      pages(first: 100, query: $query) {
        nodes { id title handle isPublished }
      }
    }
  `,
  { query: pageHandles.map((handle) => `handle:${handle}`).join(" OR ") },
  { operation: "audit support route pages" },
);

const redirectsData = await client.run(
  `#graphql
    query SupportRouteRedirects($query: String!) {
      urlRedirects(first: 250, query: $query) {
        nodes { id path target }
      }
    }
  `,
  { query: redirects.map((path) => `path:${path}`).join(" OR ") },
  { operation: "audit support route redirects" },
);

console.log(JSON.stringify({
  pages: asArray(pagesData?.pages?.nodes),
  redirects: asArray(redirectsData?.urlRedirects?.nodes),
}, null, 2));
