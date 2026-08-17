import { createShopifyAdminGraphQLClient, asArray } from "./shopify-admin-graphql-client.mjs";

const client = createShopifyAdminGraphQLClient({
  rootDir: process.cwd(),
  agentName: "support-route-repair",
});

const pageDefinitions = [
  {
    handle: "resources",
    title: "Resource Hub",
    body: "<p>Practical guides that help shoppers discover the right SALT products, collections, and everyday solutions.</p>",
  },
  {
    handle: "faq",
    title: "FAQ",
    body: "<p>Quick answers about SALT ordering, shipping, returns, and product support.</p>",
  },
  {
    handle: "blog",
    title: "SALT Journal",
    body: "<p>Fresh stories, product education, and practical ideas from SALT.</p>",
  },
  {
    handle: "affiliate-program",
    title: "Affiliate Program",
    body: "<p>Learn how to partner with SALT and share useful products with your audience.</p>",
  },
  {
    handle: "mission-vision",
    title: "Mission & Vision",
    body: "<p>Learn what SALT is building and how we make everyday shopping easier.</p>",
  },
  {
    handle: "wholesale-inquiries",
    title: "Wholesale Inquiries",
    body: "<p>Contact SALT about wholesale, gifting, and business purchasing opportunities.</p>",
  },
  {
    handle: "terms-conditions",
    title: "Terms & Conditions",
    body: "<p>Review the terms that apply when using the Future Light Store.</p>",
  },
  {
    handle: "track-order",
    title: "Track Order",
    body: "<p>Use the secure order portal to review your order status and delivery details.</p>",
  },
  {
    handle: "recently-viewed",
    title: "Recently Viewed",
    body: "<p>Pick up where you left off with products viewed on this device.</p>",
  },
];

const redirects = [
  ["/about", "/pages/about-us"],
  ["/contact", "/pages/contact-us"],
  ["/resources", "/pages/resources"],
  ["/faq", "/pages/faq"],
  ["/wishlist", "/pages/wishlist"],
  ["/pages/contact", "/pages/contact-us"],
  ["/blog", "/pages/blog"],
  ["/affiliate-program", "/pages/affiliate-program"],
  ["/mission-vision", "/pages/mission-vision"],
  ["/wholesale-inquiries", "/pages/wholesale-inquiries"],
  ["/terms-conditions", "/pages/terms-conditions"],
  ["/track-order", "/pages/track-order"],
  ["/recently-viewed", "/pages/recently-viewed"],
  ["/shipping-policy", "/policies/shipping-policy"],
  ["/refund-policy", "/policies/refund-policy"],
  ["/privacy-policy", "/policies/privacy-policy"],
];

const existingPagesData = await client.run(
  `#graphql
    query SupportPages {
      pages(first: 100) { nodes { id handle title isPublished } }
    }
  `,
  {},
  { operation: "read support route pages before repair" },
);
const existingPages = new Map(asArray(existingPagesData?.pages?.nodes).map((page) => [page.handle, page]));

for (const definition of pageDefinitions) {
  if (existingPages.has(definition.handle)) {
    console.log(`Shopify page already exists: /pages/${definition.handle}`);
    continue;
  }

  const result = await client.run(
    `#graphql
      mutation CreateSupportPage($page: PageCreateInput!) {
        pageCreate(page: $page) {
          page { id handle title isPublished }
          userErrors { field message }
        }
      }
    `,
    { page: { handle: definition.handle, title: definition.title, body: definition.body, isPublished: true } },
    { allowMutations: true, operation: `create /pages/${definition.handle}` },
  );
  const errors = asArray(result?.pageCreate?.userErrors);
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
  console.log(`Created Shopify page: /pages/${result.pageCreate.page.handle}`);
}

const existingRedirectsData = await client.run(
  `#graphql
    query SupportRedirects {
      urlRedirects(first: 250) { nodes { path target } }
    }
  `,
  {},
  { operation: "read support redirects before repair" },
);
const existingRedirects = new Set(
  asArray(existingRedirectsData?.urlRedirects?.nodes).map((redirect) => `${redirect.path}=>${redirect.target}`),
);

for (const [path, target] of redirects) {
  if (existingRedirects.has(`${path}=>${target}`)) {
    console.log(`Shopify redirect already exists: ${path} -> ${target}`);
    continue;
  }

  const result = await client.run(
    `#graphql
      mutation CreateSupportRedirect($redirect: UrlRedirectInput!) {
        urlRedirectCreate(urlRedirect: $redirect) {
          urlRedirect { path target }
          userErrors { field message }
        }
      }
    `,
    { redirect: { path, target } },
    { allowMutations: true, operation: `create redirect ${path} -> ${target}` },
  );
  const errors = asArray(result?.urlRedirectCreate?.userErrors);
  if (errors.length && !errors.some((error) => /already|taken|duplicate/i.test(error.message))) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
  console.log(`Created Shopify redirect: ${path} -> ${target}`);
}

const verification = await client.run(
  `#graphql
    query VerifySupportPages {
      pages(first: 100) { nodes { handle title isPublished } }
    }
  `,
  {},
  { operation: "verify support route pages" },
);
console.log(JSON.stringify({
  pages: asArray(verification?.pages?.nodes).filter((page) => pageDefinitions.some((definition) => definition.handle === page.handle)),
}, null, 2));
