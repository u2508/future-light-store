const DEFAULT_SHOP_BASE = "";
const DEFAULT_SHOPIFY_CLI_CLIENT_ID = "7e9cb568cfd431c538f36d1ad3f2b4f6";

const shopBase = process.env.SALT_SHOP_URL || DEFAULT_SHOP_BASE;
const shopDomain = new URL(shopBase).hostname;
const refreshToken = process.env.SHOPIFY_ADMIN_REFRESH_TOKEN?.trim();
const clientId = process.env.SHOPIFY_CLI_CLIENT_ID || DEFAULT_SHOPIFY_CLI_CLIENT_ID;

if (!refreshToken) {
  throw new Error("SHOPIFY_ADMIN_REFRESH_TOKEN is not configured");
}

const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }),
});

const responseText = await response.text();
let payload;

try {
  payload = JSON.parse(responseText);
} catch {
  throw new Error(`Shopify token refresh returned invalid JSON (${response.status})`);
}

if (!response.ok || !payload.access_token || !payload.refresh_token) {
  const errorDetail = payload.error_description || payload.error || `HTTP ${response.status}`;
  throw new Error(`Shopify token refresh failed: ${errorDetail}`);
}

process.stdout.write(
  JSON.stringify({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in ?? null,
  }),
);
