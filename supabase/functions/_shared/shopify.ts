export const SHOP_DOMAIN = Deno.env.get("SHOPIFY_SHOP_DOMAIN") ?? "vs-store-us.myshopify.com";
export const ADMIN_API_VERSION = Deno.env.get("SHOPIFY_API_VERSION") ?? "2026-07";
export const ADMIN_GRAPHQL_URL = `https://${SHOP_DOMAIN}/admin/api/${ADMIN_API_VERSION}/graphql.json`;

type TokenCache = { accessToken: string; expiresAt: number };

let tokenCache: TokenCache | null = null;
let tokenRequest: Promise<string> | null = null;

async function requestClientCredentialsToken(): Promise<string> {
  const clientId = Deno.env.get("SHOPIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET");
  }

  const response = await fetch(`https://${SHOP_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(`Shopify Admin token exchange failed (${response.status})`);
  }

  const expiresIn = Number(payload.expires_in ?? 86_399);
  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(expiresIn - 300, 60) * 1000,
  };
  return payload.access_token;
}

export async function adminToken(): Promise<string> {
  // Dev Dashboard apps issue short-lived tokens. Prefer the refreshable
  // client-credentials flow whenever its server-only secrets are configured.
  if (Deno.env.get("SHOPIFY_CLIENT_ID") && Deno.env.get("SHOPIFY_CLIENT_SECRET")) {
    if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.accessToken;
    if (!tokenRequest) {
      tokenRequest = requestClientCredentialsToken().finally(() => {
        tokenRequest = null;
      });
    }
    return tokenRequest;
  }

  // Temporary compatibility path for an explicitly configured static token.
  const staticToken =
    Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN") ?? Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (!staticToken) throw new Error("Missing Shopify Admin credentials");
  return staticToken;
}

export async function adminGraphql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(ADMIN_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": await adminToken(),
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify Admin API ${res.status}: ${text.slice(0, 500)}`);

  const json = JSON.parse(text);
  if (json.errors && !json.data) {
    throw new Error(
      `Shopify Admin API error: ${json.errors.map((e: { message: string }) => e.message).join(", ")}`,
    );
  }
  return json.data as T;
}

export const ORDER_FIELDS = `
  id
  name
  email
  createdAt
  processedAt
  cancelledAt
  cancelReason
  displayFinancialStatus
  displayFulfillmentStatus
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  currentSubtotalPriceSet { shopMoney { amount } }
  currentTotalTaxSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  currentTotalDiscountsSet { shopMoney { amount } }
  totalRefundedSet { shopMoney { amount currencyCode } }
  refunds { id createdAt note totalRefundedSet { shopMoney { amount currencyCode } } }
  disputes { id status initiatedAs }
  shippingAddress { city province country }
  lineItems(first: 50) {
    nodes {
      title
      quantity
      sku
      originalTotalSet { shopMoney { amount } }
      discountedTotalSet { shopMoney { amount } }
      image { url }
      variant { id title inventoryItem { unitCost { amount } } }
    }
  }
  fulfillments(first: 10) {
    status
    createdAt
    updatedAt
    trackingInfo { number url company }
  }
`;

export interface AdminOrder {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  processedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  currentSubtotalPriceSet: { shopMoney: { amount: string } };
  currentTotalTaxSet: { shopMoney: { amount: string } };
  totalShippingPriceSet: { shopMoney: { amount: string } };
  currentTotalDiscountsSet: { shopMoney: { amount: string } };
  totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } };
  refunds: Array<{
    id: string;
    createdAt: string;
    note: string | null;
    totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } };
  }>;
  disputes: Array<{ id: string; status: string | null; initiatedAs: string | null }>;
  shippingAddress: { city: string | null; province: string | null; country: string | null } | null;
  lineItems: {
    nodes: Array<{
      title: string;
      quantity: number;
      sku: string | null;
      originalTotalSet: { shopMoney: { amount: string } };
      discountedTotalSet: { shopMoney: { amount: string } };
      image: { url: string } | null;
      variant: {
        id: string;
        title: string;
        inventoryItem?: { unitCost?: { amount: string } | null };
      } | null;
    }>;
  };
  fulfillments: Array<{
    status: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    trackingInfo: Array<{ number: string | null; url: string | null; company: string | null }>;
  }>;
}

export const num = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

export function orderRow(o: AdminOrder) {
  return {
    id: o.id,
    order_number: o.name?.replace("#", "") ?? null,
    name: o.name,
    email: o.email,
    currency: o.currentTotalPriceSet?.shopMoney?.currencyCode ?? "USD",
    processed_at: o.processedAt ?? o.createdAt,
    total_price: num(o.currentTotalPriceSet?.shopMoney?.amount),
    subtotal_price: num(o.currentSubtotalPriceSet?.shopMoney?.amount),
    total_tax: num(o.currentTotalTaxSet?.shopMoney?.amount),
    total_shipping: num(o.totalShippingPriceSet?.shopMoney?.amount),
    total_discounts: num(o.currentTotalDiscountsSet?.shopMoney?.amount),
    total_refunded: num(o.totalRefundedSet?.shopMoney?.amount),
    financial_status: o.displayFinancialStatus,
    fulfillment_status: o.displayFulfillmentStatus,
    cancelled_at: o.cancelledAt,
    line_items: o.lineItems?.nodes ?? [],
    fulfillments: o.fulfillments ?? [],
    raw: o as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  };
}
