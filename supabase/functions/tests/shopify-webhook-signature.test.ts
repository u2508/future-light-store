import { assert, assertFalse } from "jsr:@std/assert@1";
import {
  shopifyWebhookSignatureHeader,
  verifyShopifyWebhookRequest,
} from "../_shared/shopify-webhook-signature.ts";

const body = JSON.stringify({ id: 123, financial_status: "paid" });
const secret = "test-shopify-webhook-secret";

async function hmacSignature(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

Deno.test("accepts a Shopify HMAC signature for the raw body", async () => {
  assert(await verifyShopifyWebhookRequest(body, await hmacSignature(body), secret));
});

Deno.test("rejects altered bodies, missing signatures, and missing secrets", async () => {
  const signature = await hmacSignature(body);
  assertFalse(await verifyShopifyWebhookRequest(`${body} `, signature, secret));
  assertFalse(await verifyShopifyWebhookRequest(body, null, secret));
  assertFalse(await verifyShopifyWebhookRequest(body, signature, ""));
});

Deno.test("reads Shopify's case-insensitive HMAC header", () => {
  const headers = new Headers({ "X-Shopify-Hmac-Sha256": "signature" });
  assert(shopifyWebhookSignatureHeader(headers) === "signature");
});
