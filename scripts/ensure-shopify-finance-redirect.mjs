const shopBase = process.env.SALT_SHOP_URL;
if (!shopBase) throw new Error("SALT_SHOP_URL is required for Future Light Store redirects.");
const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const accessToken =
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SALT_SHOPIFY_ADMIN_ACCESS_TOKEN || "";
const graphqlUrl = `${new URL(shopBase).origin}/admin/api/${apiVersion}/graphql.json`;
const targetPath = "/pages/finance";
const sourcePaths = ["/apps:finance", "/apps/finance"];

if (!accessToken) {
  throw new Error("SHOPIFY_ADMIN_ACCESS_TOKEN is required to configure the finance route.");
}

async function graphql(query, variables = {}) {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(JSON.stringify(payload.errors || payload));
  }

  return payload.data;
}

for (const sourcePath of sourcePaths) {
  try {
    const created = await graphql(
      `#graphql
        mutation CreateFinanceRedirect($urlRedirect: UrlRedirectInput!) {
          urlRedirectCreate(urlRedirect: $urlRedirect) {
            urlRedirect {
              id
              path
              target
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      { urlRedirect: { path: sourcePath, target: targetPath } },
    );

    const result = created.urlRedirectCreate;
    if (result.userErrors.length) {
      const message = result.userErrors.map((error) => error.message).join("; ");
      if (/already|taken|duplicate/i.test(message)) {
        console.log(`Finance redirect already exists: ${sourcePath}`);
        continue;
      }
      throw new Error(message);
    }

    console.log(`Created finance redirect: ${result.urlRedirect.path} -> ${result.urlRedirect.target}`);
  } catch (error) {
    console.warn(`Finance redirect was not created for ${sourcePath}: ${error.message}`);
    console.warn(`Use ${targetPath} until Shopify redirect permission is granted.`);
  }
}
