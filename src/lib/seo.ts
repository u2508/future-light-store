export const SITE_URL = (import.meta.env.VITE_SITE_URL || "https://vss-store.vercel.app").replace(
  /\/$/,
  "",
);
export const GOOGLE_SITE_VERIFICATION =
  import.meta.env.VITE_GOOGLE_SITE_VERIFICATION || "T5OO6im9_fwXtSjarVqkZvx-JHYudcUe_B6jhJH-BeY";

export function canonicalUrl(path = "/") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${normalizedPath}`;
}
