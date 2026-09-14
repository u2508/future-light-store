import { createHash } from "node:crypto";

import { contentImageUrl } from "./vs-store-social-copy.mjs";
import { isOfferStillActive } from "./vs-store-social-state.mjs";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hashScore(value) {
  const digest = createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
  return Number.parseInt(digest, 16) / 0xffffffffffff;
}

function isPublishedProduct(product) {
  return (
    normalizeText(product?.status).toUpperCase() === "ACTIVE" &&
    Boolean(product?.publishedAt || product?.published_at)
  );
}

function inventoryTotal(product) {
  const direct = Number(product?.totalInventory);
  if (Number.isFinite(direct)) return direct;
  const variants = asArray(product?.variants?.nodes).length
    ? asArray(product?.variants?.nodes)
    : asArray(product?.variants);
  const quantities = variants
    .map((variant) => variant?.inventoryQuantity ?? variant?.inventory_quantity)
    .map(Number)
    .filter(Number.isFinite);
  return quantities.length ? quantities.reduce((total, quantity) => total + quantity, 0) : null;
}

function hasAvailableInventory(product) {
  const total = inventoryTotal(product);
  return total === null || total > 0;
}

function productImage(product) {
  return (
    product?.featuredImage?.url ||
    product?.image?.src ||
    asArray(product?.images?.nodes)[0]?.url ||
    asArray(product?.images)[0]?.src ||
    ""
  );
}

function collectionImage(collection) {
  return (
    collection?.image?.url ||
    collection?.image?.src ||
    asArray(collection?.products?.nodes)[0]?.featuredImage?.url ||
    asArray(collection?.products?.nodes)[0]?.image?.src ||
    ""
  );
}

function historyHandles(state, kind, maxAgeDays = 45) {
  const threshold = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return new Set(
    asArray(state?.history)
      .filter(
        (entry) =>
          entry?.kind === kind &&
          Date.parse(String(entry?.publishedAt || entry?.selectedAt || "")) >= threshold,
      )
      .map((entry) => normalizeText(entry?.handle).toLowerCase())
      .filter(Boolean),
  );
}

function candidateScore(entry, runKey, index) {
  const updatedAt = Date.parse(
    String(
      entry?.updatedAt || entry?.updated_at || entry?.publishedAt || entry?.published_at || "",
    ),
  );
  const recency = Number.isFinite(updatedAt)
    ? Math.min(
        1,
        Math.max(
          0,
          (updatedAt - Date.now() + 45 * 24 * 60 * 60 * 1000) / (45 * 24 * 60 * 60 * 1000),
        ),
      )
    : 0.25;
  const inventory = inventoryTotal(entry);
  const inventoryScore = Number.isFinite(inventory)
    ? Math.min(1, Math.max(0, inventory / 100))
    : 0.25;
  const imageScore = contentImageUrl({ kind: entry?.kind, product: entry, collection: entry })
    ? 1
    : 0;
  return (
    imageScore * 10 +
    recency * 2 +
    inventoryScore +
    hashScore(`${runKey}:${entry?.handle || entry?.id || index}`)
  );
}

function chooseCandidate(entries, { kind, runKey, state }) {
  const recent = historyHandles(state, kind);
  const available = entries.filter((entry) => {
    const handle = normalizeText(entry?.handle).toLowerCase();
    return handle && !recent.has(handle);
  });
  const pool = available.length ? available : entries;
  return (
    [...pool]
      .map((entry, index) => ({ entry, score: candidateScore({ ...entry, kind }, runKey, index) }))
      .sort((left, right) => right.score - left.score)[0]?.entry || null
  );
}

export function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const result = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return {
    year: Number(result.year),
    month: Number(result.month),
    day: Number(result.day),
    hour: Number(result.hour),
    minute: Number(result.minute),
    second: Number(result.second),
    weekday: result.weekday,
  };
}

export function zonedDateTimeToUtc({ year, month, day, hour, minute = 0, second = 0 }, timeZone) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = getZonedParts(new Date(guess), timeZone);
    const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    guess += desiredUtc - actualUtc;
  }
  return new Date(guess);
}

export function buildRunKey(now, timeZone) {
  const parts = getZonedParts(now, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function selectDailyContent({ catalog, state, now = new Date(), timeZone }) {
  const runKey = buildRunKey(now, timeZone);
  const products = asArray(catalog?.products).filter(
    (product) =>
      isPublishedProduct(product) && hasAvailableInventory(product) && productImage(product),
  );
  const collections = asArray(catalog?.collections).filter(
    (collection) => collection?.handle && collectionImage(collection),
  );
  const lane = Number(state?.nextRotation || 0) % 3;
  const lanes = [
    { kind: "product", entry: chooseCandidate(products, { kind: "product", runKey, state }) },
    {
      kind: "collection",
      entry: chooseCandidate(collections, { kind: "collection", runKey, state }),
    },
    { kind: "banner", entry: null },
  ];
  const selected = lanes
    .slice(lane)
    .concat(lanes.slice(0, lane))
    .find((candidate) => candidate.kind === "banner" || candidate.entry);
  if (!selected) return { kind: "banner", runKey, selectedAt: now.toISOString(), rotation: lane };
  return {
    kind: selected.kind,
    runKey,
    rotation: lane,
    selectedAt: now.toISOString(),
    handle: selected.entry?.handle || null,
    id: selected.entry?.id || null,
    product: selected.kind === "product" ? selected.entry : null,
    collection: selected.kind === "collection" ? selected.entry : null,
    imageUrl:
      selected.kind === "product"
        ? productImage(selected.entry)
        : selected.kind === "collection"
          ? collectionImage(selected.entry)
          : null,
  };
}

export function shouldAttemptOffer({
  content,
  state,
  now = new Date(),
  timeZone,
  offerWeekday,
  offerWindowDays = 7,
}) {
  if (!content || content.kind === "banner") return false;
  if (isOfferStillActive(state?.lastOffer, now.getTime(), offerWindowDays)) return false;
  const parts = getZonedParts(now, timeZone);
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return weekdayMap[parts.weekday] === offerWeekday;
}

export function buildOfferCode(runKey, targetId) {
  const suffix = createHash("sha256")
    .update(`${runKey}:${targetId}`)
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
  return `VSWELCOME${runKey.replace(/-/g, "").slice(4)}${suffix}`.slice(0, 32);
}

export function nextOfferEndsAt(now, days = 7) {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export function advanceRotation(state) {
  return (Number(state?.nextRotation || 0) + 1) % 3;
}
