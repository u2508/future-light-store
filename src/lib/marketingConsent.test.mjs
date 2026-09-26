import assert from "node:assert/strict";
import test from "node:test";

import {
  canProcessMarketingPurpose,
  deniedMarketingConsent,
  MARKETING_CONSENT_VERSION,
  normalizeMarketingPreferences,
  parseStoredMarketingConsent,
  persistStandaloneMarketingConsent,
  serializeMarketingConsent,
} from "./marketingConsent.mjs";

test("standalone consent is denied until an explicit, valid decision is stored", () => {
  assert.equal(parseStoredMarketingConsent(null), null);
  assert.equal(parseStoredMarketingConsent("not-json"), null);
  assert.equal(
    parseStoredMarketingConsent(
      JSON.stringify({
        version: MARKETING_CONSENT_VERSION,
        analytics: true,
        advertising: true,
      }),
    ),
    null,
  );
  assert.deepEqual(deniedMarketingConsent(), {
    analytics: false,
    advertising: false,
    explicit: false,
    source: "standalone",
    ready: true,
  });
});

test("analytics and advertising choices remain independent", () => {
  const analyticsOnly = normalizeMarketingPreferences({ analytics: true, advertising: false });
  const advertisingOnly = normalizeMarketingPreferences({ analytics: false, advertising: true });
  assert.deepEqual(analyticsOnly, { analytics: true, advertising: false });
  assert.deepEqual(advertisingOnly, { analytics: false, advertising: true });
});

test("serialized rejection is an explicit decision but grants no processing", () => {
  const saved = parseStoredMarketingConsent(
    serializeMarketingConsent({ analytics: false, advertising: false }),
  );
  assert.equal(saved?.explicit, true);
  assert.equal(canProcessMarketingPurpose(saved, "analytics"), false);
  assert.equal(canProcessMarketingPurpose(saved, "advertising"), false);
});

test("standalone consent persistence reports blocked storage without granting a default", () => {
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value) };
  assert.equal(
    persistStandaloneMarketingConsent(storage, { analytics: true, advertising: false }),
    true,
  );
  assert.equal(parseStoredMarketingConsent(values.values().next().value)?.analytics, true);
  assert.equal(
    persistStandaloneMarketingConsent(
      {
        setItem: () => {
          throw new Error("storage disabled");
        },
      },
      { analytics: true, advertising: true },
    ),
    false,
  );
  assert.equal(persistStandaloneMarketingConsent(undefined, { analytics: true }), false);
});

test("only the explicitly accepted standalone purpose is allowed", () => {
  const analyticsOnly = parseStoredMarketingConsent(
    serializeMarketingConsent({ analytics: true, advertising: false }),
  );
  assert.equal(canProcessMarketingPurpose(analyticsOnly, "analytics"), true);
  assert.equal(canProcessMarketingPurpose(analyticsOnly, "advertising"), false);

  const advertisingOnly = parseStoredMarketingConsent(
    serializeMarketingConsent({ analytics: false, advertising: true }),
  );
  assert.equal(canProcessMarketingPurpose(advertisingOnly, "analytics"), false);
  assert.equal(canProcessMarketingPurpose(advertisingOnly, "advertising"), true);
});

test("Shopify permission snapshots defer to API-derived allowed flags", () => {
  const shopifyConsent = {
    analytics: true,
    advertising: false,
    explicit: false,
    source: "shopify",
    ready: true,
  };
  assert.equal(canProcessMarketingPurpose(shopifyConsent, "analytics"), true);
  assert.equal(canProcessMarketingPurpose(shopifyConsent, "advertising"), false);
  assert.equal(canProcessMarketingPurpose({ ...shopifyConsent, ready: false }, "analytics"), false);
});
