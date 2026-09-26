import { createHash } from "node:crypto";

/** Normalize an identifier only in a field whose contract is explicitly Product. */
export function canonicalProductGid(value) {
  const id = String(value ?? "").trim();
  if (/^\d+$/.test(id)) return `gid://shopify/Product/${id}`;
  return /^gid:\/\/shopify\/Product\/\d+$/.test(id) ? id : null;
}

export function sameProductGid(left, right) {
  const a = canonicalProductGid(left);
  const b = canonicalProductGid(right);
  return Boolean(a && b && a === b);
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function isSha256Hex(value) {
  return /^[a-f0-9]{64}$/i.test(String(value ?? "").trim());
}

export function isShopifyGidOfType(value, type) {
  const escapedType = String(type ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^gid://shopify/${escapedType}/\\d+$`).test(String(value ?? "").trim());
}
