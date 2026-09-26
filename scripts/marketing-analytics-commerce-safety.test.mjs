import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getMarketingAttributionAttributes,
  trackAddToCart,
  trackBeginCheckout,
  trackMarketingEvent,
} from "../src/lib/marketingAnalytics.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
});

function installWindow(overrides = {}) {
  const events = [];
  const value = {
    dataLayer: [],
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
    sessionStorage: { getItem: () => null },
    ...overrides,
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value,
  });
  return { value, events };
}

test("a throwing analytics destination cannot interrupt a marketing event or checkout flow", () => {
  let metaCalls = 0;
  const { value: browser, events } = installWindow({
    gtag: () => {
      throw new Error("Google tag unavailable");
    },
    fbq: () => {
      metaCalls += 1;
    },
  });

  assert.doesNotThrow(() =>
    trackBeginCheckout({
      currency: "USD",
      value: 29.99,
      items: [{ item_id: "123456789", item_name: "Sample product", quantity: 1 }],
    }),
  );
  assert.equal(metaCalls, 1, "Meta should still receive the event after Google fails");
  assert.equal(events.length, typeof CustomEvent === "function" ? 1 : 0);
  assert.equal(browser.dataLayer.length, 1);
});

test("a throwing Meta pixel cannot interrupt AddToCart or first-party event delivery", () => {
  let googleCalls = 0;
  const { value: browser, events } = installWindow({
    gtag: () => {
      googleCalls += 1;
    },
    fbq: () => {
      throw new Error("Meta pixel unavailable");
    },
  });

  assert.doesNotThrow(() =>
    trackAddToCart({
      currency: "USD",
      quantity: 1,
      item: { item_id: "123456789", item_name: "Sample product", price: 29.99 },
    }),
  );
  assert.equal(googleCalls, 1, "Google should still receive the event after Meta fails");
  assert.equal(events.length, typeof CustomEvent === "function" ? 1 : 0);
  assert.equal(browser.dataLayer[0]?.event, "add_to_cart");
});

test("unavailable browser storage cannot prevent Shopify cart attribution setup", () => {
  installWindow({ sessionStorage: { getItem: () => null } });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: Object.defineProperty({}, "cookie", {
      configurable: true,
      get() {
        throw new Error("Cookie access denied");
      },
    }),
  });

  assert.deepEqual(getMarketingAttributionAttributes(), []);
});

test("one destination cannot prevent another or the first-party custom event", () => {
  let metaCalls = 0;
  const { events } = installWindow({
    gtag: () => {
      throw new Error("Google tag unavailable");
    },
    fbq: () => {
      metaCalls += 1;
      throw new Error("Meta transport unavailable");
    },
  });

  assert.doesNotThrow(() => trackMarketingEvent("view_item", { value: 1, currency: "USD" }));
  assert.equal(metaCalls, 1);
  assert.equal(events.length, typeof CustomEvent === "function" ? 1 : 0);
});
