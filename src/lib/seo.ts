export const SITE_URL = (import.meta.env.VITE_SITE_URL || "https://vss-store.vercel.app").replace(/\/$/, "");

export function canonicalUrl(path = "/") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${normalizedPath}`;
}
