import type { ShopifyProduct, ShopifyCollection } from "@/lib/shopify";

const SYNONYMS: Record<string, string[]> = {
  tee: ["t-shirt", "tshirt", "shirt"],
  sneaker: ["shoe", "trainer", "runner"],
  bag: ["backpack", "tote", "pack"],
  jacket: ["coat", "outerwear"],
  bottle: ["flask", "tumbler"],
  light: ["lamp", "lantern", "torch"],
};

export function normalize(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function expand(term: string) {
  const out = new Set([term]);
  for (const [key, values] of Object.entries(SYNONYMS)) {
    if (key === term || values.includes(term)) {
      out.add(key);
      values.forEach((v) => out.add(v));
    }
  }
  return [...out];
}

/** Damerau-lite edit distance, capped for speed. */
export function editDistance(a: string, b: string) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }
  return prev[b.length] ?? 3;
}


function scoreText(haystack: string, terms: string[]) {
  const hay = normalize(haystack);
  let score = 0;
  for (const raw of terms) {
    let best = 0;
    for (const term of expand(raw)) {
      if (hay.startsWith(term)) best = Math.max(best, 10);
      else if (hay.includes(term)) best = Math.max(best, 7);
      else {
        const words = hay.split(/[\s/,-]+/);
        for (const word of words) {
          if (term.length > 3 && editDistance(word, term) <= 1) best = Math.max(best, 4);
        }
      }
    }
    score += best;
  }
  return score;
}

export interface ProductMatch {
  product: ShopifyProduct;
  score: number;
}

export function searchProducts(products: ShopifyProduct[], query: string): ProductMatch[] {
  const q = normalize(query);
  if (!q) return [];
  const terms = q.split(" ").filter(Boolean);
  return products
    .map((product) => {
      const n = product.node;
      const skus = n.variants.edges.map((v) => v.node.title).join(" ");
      const score =
        scoreText(n.title, terms) * 3 +
        scoreText(n.productType ?? "", terms) * 2 +
        scoreText(n.vendor ?? "", terms) * 2 +
        scoreText((n.tags ?? []).join(" "), terms) * 2 +
        scoreText(skus, terms) +
        scoreText(n.description ?? "", terms) * 0.5;
      return { product, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function searchCollections(collections: ShopifyCollection[], query: string) {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return [];
  return collections
    .map((c) => ({ collection: c, score: scoreText(c.title, terms) * 2 + scoreText(c.description ?? "", terms) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.collection);
}

export function suggestedCategories(products: ShopifyProduct[], query: string) {
  const terms = normalize(query).split(" ").filter(Boolean);
  const types = new Set<string>();
  products.forEach((p) => p.node.productType && types.add(p.node.productType));
  return [...types].filter((t) => (terms.length ? scoreText(t, terms) > 0 : true)).slice(0, 6);
}

export function highlight(text: string, query: string) {
  const terms = normalize(query).split(" ").filter((t) => t.length > 1);
  if (terms.length === 0) return [{ text, match: false }];
  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return text
    .split(pattern)
    .filter(Boolean)
    .map((chunk) => ({ text: chunk, match: terms.includes(normalize(chunk)) }));
}

const RECENT_KEY = "vs-recent-searches";

export function getRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function pushRecentSearch(term: string) {
  if (typeof window === "undefined" || !term.trim()) return;
  const next = [term.trim(), ...getRecentSearches().filter((t) => t !== term.trim())].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export const POPULAR_SEARCHES = ["new arrivals", "under 50", "best sellers", "travel", "everyday carry"];
