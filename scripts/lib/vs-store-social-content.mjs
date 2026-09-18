import { createHash } from "node:crypto";

import { contentImageUrl } from "./vs-store-social-copy.mjs";
import { isOfferStillActive } from "./vs-store-social-state.mjs";

export const WEEKDAY_INDEX = Object.freeze({
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
});

export const WEEKLY_SOCIAL_SCHEDULE = Object.freeze({
  Sun: Object.freeze({ slot: "sunday-collection", kind: "collection", variant: "showcase" }),
  Mon: Object.freeze({ slot: "monday-product", kind: "product", variant: "showcase" }),
  Tue: Object.freeze({ slot: "tuesday-promotion", kind: "banner", variant: "promotion-teaser" }),
  Wed: Object.freeze({ slot: "wednesday-product", kind: "product", variant: "showcase" }),
  Thu: Object.freeze({ slot: "thursday-collection", kind: "collection", variant: "showcase" }),
  Fri: Object.freeze({ slot: "friday-heartfelt", kind: "banner", variant: "heartfelt" }),
  Sat: Object.freeze({ slot: "saturday-collection", kind: "collection", variant: "showcase" }),
});

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
  const status = normalizeText(product?.status || product?.state).toUpperCase();
  return (!status || status === "ACTIVE") && Boolean(product?.publishedAt || product?.published_at);
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
  const variants = asArray(product?.variants?.nodes).length
    ? asArray(product?.variants?.nodes)
    : asArray(product?.variants);
  const availability = variants
    .map((variant) => variant?.available)
    .filter((value) => typeof value === "boolean");
  if (availability.length) return availability.some(Boolean);
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
    asArray(collection?.products?.nodes)[0]?.images?.[0]?.src ||
    ""
  );
}

function usageLedgerFor(state, kind) {
  const ledger = state?.usageLedger?.[kind];
  return ledger && typeof ledger === "object" ? ledger : {};
}

function localWeekKeyForEntry(entry, timeZone) {
  if (entry?.weekKey) return normalizeText(entry.weekKey);
  const timestamp = Date.parse(String(entry?.publishedAt || entry?.selectedAt || ""));
  return Number.isFinite(timestamp) ? getWeekKey(new Date(timestamp), timeZone) : null;
}

function usedThisWeek(state, kind, weekKey, timeZone) {
  return new Set(
    asArray(state?.history)
      .filter((entry) => entry?.kind === kind && localWeekKeyForEntry(entry, timeZone) === weekKey)
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

function chooseCandidate(entries, { kind, runKey, state, weekKey, timeZone }) {
  const ledger = usageLedgerFor(state, kind);
  const usedWeek = usedThisWeek(state, kind, weekKey, timeZone);
  const candidates = entries.filter((entry) => normalizeText(entry?.handle));
  const neverUsed = candidates.filter(
    (entry) => !Object.hasOwn(ledger, normalizeText(entry.handle).toLowerCase()),
  );
  const neverUsedThisWeek = neverUsed.filter(
    (entry) => !usedWeek.has(normalizeText(entry.handle).toLowerCase()),
  );
  const unusedPool = neverUsedThisWeek.length ? neverUsedThisWeek : neverUsed;
  const distinctThisWeek = candidates.filter(
    (entry) => !usedWeek.has(normalizeText(entry.handle).toLowerCase()),
  );
  const pool = unusedPool.length
    ? unusedPool
    : distinctThisWeek.length
      ? distinctThisWeek
      : candidates;
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

export function getWeekKey(now, timeZone) {
  const parts = getZonedParts(now, timeZone);
  const weekday = WEEKDAY_INDEX[parts.weekday];
  const monday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day - ((weekday + 6) % 7), 12, 0, 0),
  );
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
}

export function getDailySchedule(now, timeZone) {
  const parts = getZonedParts(now, timeZone);
  const schedule = WEEKLY_SOCIAL_SCHEDULE[parts.weekday] || WEEKLY_SOCIAL_SCHEDULE.Mon;
  return {
    ...schedule,
    weekday: WEEKDAY_INDEX[parts.weekday],
    weekdayName: parts.weekday,
    weekKey: getWeekKey(now, timeZone),
  };
}

export function getFridayOfferWindow(now, timeZone) {
  const parts = getZonedParts(now, timeZone);
  const weekday = WEEKDAY_INDEX[parts.weekday];
  const monday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day - ((weekday + 6) % 7), 12, 0, 0),
  );
  const friday = new Date(monday);
  friday.setUTCDate(friday.getUTCDate() + 4);
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  return {
    weekKey: getWeekKey(now, timeZone),
    startsAt: zonedDateTimeToUtc(
      {
        year: friday.getUTCFullYear(),
        month: friday.getUTCMonth() + 1,
        day: friday.getUTCDate(),
        hour: 0,
      },
      timeZone,
    ),
    endsAt: zonedDateTimeToUtc(
      {
        year: nextMonday.getUTCFullYear(),
        month: nextMonday.getUTCMonth() + 1,
        day: nextMonday.getUTCDate(),
        hour: 0,
      },
      timeZone,
    ),
  };
}

export function selectDailyContent({ catalog, state, now = new Date(), timeZone }) {
  const runKey = buildRunKey(now, timeZone);
  const schedule = getDailySchedule(now, timeZone);
  const products = asArray(catalog?.products).filter(
    (product) =>
      isPublishedProduct(product) && hasAvailableInventory(product) && productImage(product),
  );
  const collections = asArray(catalog?.collections).filter(
    (collection) => collection?.handle && collectionImage(collection),
  );
  const entry =
    schedule.kind === "product"
      ? chooseCandidate(products, {
          kind: "product",
          runKey,
          state,
          weekKey: schedule.weekKey,
          timeZone,
        })
      : schedule.kind === "collection"
        ? chooseCandidate(collections, {
            kind: "collection",
            runKey,
            state,
            weekKey: schedule.weekKey,
            timeZone,
          })
        : null;
  return {
    kind: schedule.kind,
    variant: schedule.variant,
    slot: schedule.slot,
    weekday: schedule.weekdayName,
    weekKey: schedule.weekKey,
    runKey,
    selectedAt: now.toISOString(),
    handle: entry?.handle || null,
    id: entry?.id || null,
    product: schedule.kind === "product" ? entry : null,
    collection: schedule.kind === "collection" ? entry : null,
    imageUrl:
      schedule.kind === "product"
        ? productImage(entry)
        : schedule.kind === "collection"
          ? collectionImage(entry)
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
  if (!content || content.variant !== "heartfelt") return false;
  if (isOfferStillActive(state?.lastOffer, now.getTime(), offerWindowDays)) return false;
  const parts = getZonedParts(now, timeZone);
  return WEEKDAY_INDEX[parts.weekday] === offerWeekday;
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
