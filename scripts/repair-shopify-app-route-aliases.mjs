import { asArray, createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";

const client = createShopifyAdminGraphQLClient({
  rootDir: process.cwd(),
  agentName: "app-route-alias-repair",
});

const aliases = [
  ["vs-store-about", "VS Store About", "/about"],
  ["vs-store-offers", "VS Store Offers", "/offers"],
  ["vs-store-auth", "VS Store Auth", "/auth"],
  ["vs-store-wishlist", "VS Store Wishlist", "/wishlist"],
  ["vs-store-orders", "VS Store Orders", "/orders"],
  ["vs-store-track-order", "VS Store Track Order", "/track-order"],
  ["vs-store-help", "VS Store Help", "/help"],
  ["vs-store-policies", "VS Store Policies", "/policies"],
  ["vs-store-policy-shipping", "VS Store Policy Shipping", "/policies/shipping"],
  ["vs-store-policy-returns", "VS Store Policy Returns", "/policies/returns"],
  ["vs-store-policy-privacy", "VS Store Policy Privacy", "/policies/privacy"],
  ["vs-store-policy-terms", "VS Store Policy Terms", "/policies/terms"],
  ["vs-store-policy-contact", "VS Store Policy Contact", "/policies/contact"],
];

const pagesResponse = await client.run(
  `#graphql
    query AppRoutePages {
      pages(first: 250) {
        nodes { id handle title isPublished }
      }
    }
  `,
  {},
  { operation: "read Shopify app route pages before repair" },
);
const pages = new Map(asArray(pagesResponse?.pages?.nodes).map((page) => [page.handle, page]));

for (const [handle, title] of aliases) {
  const existing = pages.get(handle);
  if (existing?.isPublished) {
    console.log(`Shopify app page already published: /pages/${handle}`);
    continue;
  }
  if (existing) {
    throw new Error(`Shopify page handle /pages/${handle} exists but is not published; refusing to change it implicitly.`);
  }

  const result = await client.run(
    `#graphql
      mutation CreateAppRoutePage($page: PageCreateInput!) {
        pageCreate(page: $page) {
          page { id handle title isPublished }
          userErrors { field message }
        }
      }
    `,
    {
      page: {
        handle,
        title: `VS Store ${title}`,
        body: "",
        isPublished: true,
      },
    },
    { allowMutations: true, operation: `create Shopify app page /pages/${handle}` },
  );
  const errors = asArray(result?.pageCreate?.userErrors);
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
  console.log(`Created Shopify app page: /pages/${result.pageCreate.page.handle}`);
}

const redirectsResponse = await client.run(
  `#graphql
    query AppRouteRedirects {
      urlRedirects(first: 250) {
        nodes { id path target }
      }
    }
  `,
  {},
  { operation: "read Shopify app route redirects before repair" },
);
const redirects = new Map(
  asArray(redirectsResponse?.urlRedirects?.nodes).map((redirect) => [redirect.path, redirect]),
);

for (const [handle, , sourcePath] of aliases) {
  const targetPath = `/pages/${handle}`;
  const existing = redirects.get(sourcePath);
  if (existing?.target === targetPath) {
    console.log(`Shopify app redirect already configured: ${sourcePath} -> ${targetPath}`);
    continue;
  }
  if (existing) {
    throw new Error(
      `Shopify redirect ${sourcePath} already targets ${existing.target}; refusing to overwrite it.`,
    );
  }

  const result = await client.run(
    `#graphql
      mutation CreateAppRouteRedirect($redirect: UrlRedirectInput!) {
        urlRedirectCreate(urlRedirect: $redirect) {
          urlRedirect { id path target }
          userErrors { field message }
        }
      }
    `,
    { redirect: { path: sourcePath, target: targetPath } },
    { allowMutations: true, operation: `create Shopify app redirect ${sourcePath}` },
  );
  const errors = asArray(result?.urlRedirectCreate?.userErrors);
  if (errors.length && !errors.some((error) => /already|taken|duplicate/i.test(error.message))) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
  console.log(`Created Shopify app redirect: ${sourcePath} -> ${targetPath}`);
}

const verification = await client.run(
  `#graphql
    query VerifyAppRouteAliases {
      pages(first: 250) { nodes { handle title isPublished } }
      urlRedirects(first: 250) { nodes { path target } }
    }
  `,
  {},
  { operation: "verify Shopify app route aliases" },
);

const verifiedPages = new Map(asArray(verification?.pages?.nodes).map((page) => [page.handle, page]));
const verifiedRedirects = new Map(
  asArray(verification?.urlRedirects?.nodes).map((redirect) => [redirect.path, redirect]),
);
for (const [handle, , sourcePath] of aliases) {
  if (!verifiedPages.get(handle)?.isPublished) {
    throw new Error(`Verification failed: /pages/${handle} is not published.`);
  }
  const targetPath = `/pages/${handle}`;
  if (verifiedRedirects.get(sourcePath)?.target !== targetPath) {
    throw new Error(`Verification failed: ${sourcePath} does not redirect to ${targetPath}.`);
  }
}

console.log(
  JSON.stringify(
    {
      pages: aliases.map(([handle]) => `/pages/${handle}`),
      redirects: aliases.map(([, , sourcePath], index) => ({
        source: sourcePath,
        target: `/pages/${aliases[index][0]}`,
      })),
    },
    null,
    2,
  ),
);
