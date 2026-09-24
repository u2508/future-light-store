const HMAC_HEADER = "x-shopify-hmac-sha256";

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function verifyShopifyWebhookRequest(
  rawBody: string,
  providedSignature: string | null,
  sharedSecret: string | null | undefined,
) {
  if (!providedSignature || !sharedSecret) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sharedSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return constantTimeEqual(base64(new Uint8Array(digest)), providedSignature.trim());
}

export function shopifyWebhookSignatureHeader(headers: Headers) {
  return headers.get(HMAC_HEADER);
}
