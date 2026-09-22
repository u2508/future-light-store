import type { ShopifyProductNode, ShopifyVariant } from "@/lib/shopify";
import { normalizeMetaCatalogId, trackAddToCart, trackViewItem } from "@/lib/marketingAnalytics";

type EventPayload = Record<string, unknown>;

type StandardEventConstructor<Payload extends EventPayload = EventPayload> = new (
  payload: Payload,
) => Event;

interface DeferredResult {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface ProductViewPayload extends EventPayload {
  context: "page" | "search" | "collection" | "dialog" | "recommendation";
  selectedOptions: Array<{ name: string; value: string }>;
  product: {
    id: string;
    title: string;
    handle: string;
    selectedVariant: {
      id: string;
      title: string;
      availableForSale: boolean;
      price: { amount: string; currencyCode: string };
      selectedOptions: Array<{ name: string; value: string }>;
    } | null;
  };
}

interface CartLinesUpdatePayload extends EventPayload {
  action: "add" | "remove" | "update";
  context: "product" | "cart" | "dialog" | "standard-action";
  lines: Array<{ merchandiseId: string; quantity: number }>;
  promise: Promise<unknown>;
  meta?: {
    productId: string;
    productTitle: string;
    unitPrice: string;
    currencyCode: string;
  };
}

interface CartLinesUpdateConstructor extends StandardEventConstructor<CartLinesUpdatePayload> {
  createPromise: () => DeferredResult;
}

// The standard-events runtime uses the same constructor shape for errors.
type CartErrorConstructor = StandardEventConstructor;

interface StandardEventsRuntime {
  ProductViewEvent?: StandardEventConstructor<ProductViewPayload>;
  CartLinesUpdateEvent?: CartLinesUpdateConstructor;
  CartErrorEvent?: CartErrorConstructor;
  createViewEventElement?: () => CustomElementConstructor;
}

declare global {
  interface Window {
    StandardEvents?: StandardEventsRuntime;
    Shopify?: {
      analytics?: {
        publish?: (name: string, data: Record<string, unknown>) => Promise<boolean> | boolean;
      };
    };
  }
}

export interface StandardCartSnapshot {
  id: string;
  totalQuantity: number;
  cost: {
    totalAmount: { amount: string; currencyCode: string };
  };
  lines: Array<Record<string, unknown>>;
  discountCodes?: Array<{ code: string; applicable: boolean }>;
}

export interface FutureLightCartAddPayload extends Record<string, unknown> {
  productId: string;
  productTitle: string;
  variantId: string;
  quantity: number;
  price: { amount: string; currencyCode: string };
}

function toShopifyGid(type: string, value: unknown): string {
  const stringValue = String(value ?? "");
  return stringValue.startsWith("gid://shopify/")
    ? stringValue
    : `gid://shopify/${type}/${stringValue}`;
}

function createFallbackStandardEvents(): StandardEventsRuntime {
  class ShopifyStandardEvent extends Event {
    constructor(name: string, payload: EventPayload = {}) {
      super(name, { bubbles: true, cancelable: true });
      Object.assign(this, payload);
    }
  }

  class ProductViewEvent extends ShopifyStandardEvent {
    constructor(payload: ProductViewPayload) {
      const product = payload.product;
      super("shopify:product:view", {
        ...payload,
        product: {
          ...product,
          id: toShopifyGid("Product", product.id),
          selectedVariant: product.selectedVariant
            ? {
                ...product.selectedVariant,
                id: toShopifyGid("ProductVariant", product.selectedVariant.id),
              }
            : null,
        },
      });
    }
  }

  class CartLinesUpdateEvent extends ShopifyStandardEvent {
    static createPromise(): DeferredResult {
      let resolve!: (value: unknown) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
    }

    constructor(payload: CartLinesUpdatePayload) {
      const key = payload.action === "add" ? "merchandiseId" : "id";
      const type = payload.action === "add" ? "ProductVariant" : "CartLine";
      super("shopify:cart:lines-update", {
        ...payload,
        lines: payload.lines.map((line) => ({
          ...line,
          [key]: toShopifyGid(type, (line as Record<string, unknown>)[key]),
        })),
      });
    }
  }

  class CartErrorEvent extends ShopifyStandardEvent {
    constructor(payload: EventPayload) {
      super("shopify:cart:error", payload);
    }
  }

  return { ProductViewEvent, CartLinesUpdateEvent, CartErrorEvent };
}

function getStandardEventsRuntime(): StandardEventsRuntime | null {
  if (typeof window === "undefined" || typeof Event === "undefined") return null;

  const current = window.StandardEvents ?? {};
  if (current.ProductViewEvent && current.CartLinesUpdateEvent) return current;

  const fallback = createFallbackStandardEvents();
  window.StandardEvents = { ...fallback, ...current };
  return window.StandardEvents;
}

function dispatchProductView(
  target: EventTarget,
  product: ShopifyProductNode,
  context: ProductViewPayload["context"],
  selectedVariant: ShopifyVariant | null = null,
): boolean {
  const EventClass = getStandardEventsRuntime()?.ProductViewEvent;
  if (!EventClass) return false;

  target.dispatchEvent(
    new EventClass({
      context,
      selectedOptions: selectedVariant?.selectedOptions ?? [],
      product: {
        id: product.id,
        title: product.title,
        handle: product.handle,
        selectedVariant: selectedVariant
          ? {
              id: selectedVariant.id,
              title: selectedVariant.title,
              availableForSale: selectedVariant.availableForSale,
              price: selectedVariant.price,
              selectedOptions: selectedVariant.selectedOptions ?? [],
            }
          : null,
      },
    }),
  );
  const analyticsVariant = selectedVariant ?? product.variants.edges[0]?.node ?? null;
  trackViewItem(
    {
      item_id: normalizeMetaCatalogId(analyticsVariant?.id || product.id),
      item_name: product.title,
      price: Number(analyticsVariant?.price.amount ?? product.priceRange.minVariantPrice.amount),
      item_variant: analyticsVariant?.title,
      item_brand: product.vendor || undefined,
      item_category: product.productType || undefined,
    },
    context,
  );
  return true;
}

/**
 * Dispatch a product view immediately when the Shopify event runtime is ready.
 * The cleanup function prevents a late loader callback after a card unmounts.
 */
export function dispatchProductViewWhenReady({
  target,
  product,
  context,
  selectedVariant,
}: {
  target: EventTarget;
  product: ShopifyProductNode;
  context: ProductViewPayload["context"];
  selectedVariant?: ShopifyVariant | null;
}): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (dispatchProductView(target, product, context, selectedVariant)) {
    return () => undefined;
  }

  const retry = () => dispatchProductView(target, product, context, selectedVariant);
  window.addEventListener("future-light:standard-events-ready", retry, { once: true });
  return () => window.removeEventListener("future-light:standard-events-ready", retry);
}

export function normalizeCartForStandardEvent(
  value: unknown,
  fallbackCurrencyCode = "USD",
): StandardCartSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const sourceId = source["id"];
  if (typeof sourceId !== "string" || !sourceId) return null;

  const cost = source["cost"] as Record<string, unknown> | undefined;
  const totalAmount = cost?.["totalAmount"] as Record<string, unknown> | undefined;
  const linesConnection = source["lines"] as Record<string, unknown> | undefined;
  const edges = Array.isArray(linesConnection?.["edges"]) ? linesConnection["edges"] : [];
  const lines = edges
    .map((edge) =>
      edge && typeof edge === "object" ? (edge as Record<string, unknown>)["node"] : null,
    )
    .filter((line): line is Record<string, unknown> => Boolean(line && typeof line === "object"));
  const totalQuantity = Number(
    source["totalQuantity"] ?? lines.reduce((sum, line) => sum + Number(line["quantity"] ?? 0), 0),
  );

  return {
    id: sourceId,
    totalQuantity: Number.isFinite(totalQuantity) ? totalQuantity : 0,
    cost: {
      totalAmount: {
        amount: String(totalAmount?.["amount"] ?? "0"),
        currencyCode: String(totalAmount?.["currencyCode"] ?? fallbackCurrencyCode),
      },
    },
    lines,
    discountCodes: Array.isArray(source["discountCodes"])
      ? (source["discountCodes"] as Array<{ code: string; applicable: boolean }>)
      : [],
  };
}

export function beginProductCartAddEvent({
  variantId,
  quantity,
  productId,
  productTitle,
  price,
  target = typeof document === "undefined" ? null : document,
}: {
  variantId: string;
  quantity: number;
  productId?: string;
  productTitle?: string;
  price?: { amount: string; currencyCode: string };
  target?: EventTarget | null;
}): {
  resolve: (cart: StandardCartSnapshot | null, userErrors?: Array<Record<string, unknown>>) => void;
  reject: (error: unknown) => void;
} | null {
  const EventClass = getStandardEventsRuntime()?.CartLinesUpdateEvent;
  if (!EventClass || !target || !variantId || quantity <= 0) return null;

  const deferred = EventClass.createPromise();
  const eventPayload: CartLinesUpdatePayload = {
    action: "add",
    context: "product",
    lines: [{ merchandiseId: variantId, quantity }],
    promise: deferred.promise,
  };
  if (productId && productTitle && price) {
    eventPayload.meta = {
      productId,
      productTitle,
      unitPrice: price.amount,
      currencyCode: price.currencyCode,
    };
  }
  target.dispatchEvent(new EventClass(eventPayload));

  return {
    resolve: (cart, userErrors = []) => {
      deferred.resolve({ cart, userErrors, warnings: [] });
    },
    reject: (error) => {
      const CartErrorEvent = getStandardEventsRuntime()?.CartErrorEvent;
      if (CartErrorEvent) {
        target.dispatchEvent(
          new CartErrorEvent({
            error: error instanceof Error ? error.message : String(error),
            code: "SERVICE_UNAVAILABLE",
          }),
        );
      }
      deferred.reject(error);
    },
  };
}

/**
 * Emits a private, post-success signal for integrations that cannot observe
 * the custom Storefront API cart mutation directly (for example Meta's
 * Shopify pixel). The Shopify standard cart event remains emitted separately
 * for storefront integrations.
 */
export function dispatchFutureLightCartAdd(
  payload: FutureLightCartAddPayload,
  target: EventTarget | null = typeof window === "undefined" ? null : window,
): void {
  if (!target || typeof CustomEvent === "undefined") return;
  trackAddToCart({
    item: {
      item_id: normalizeMetaCatalogId(payload.variantId),
      item_name: payload.productTitle,
      price: Number(payload.price.amount),
      item_variant: payload.variantId,
    },
    quantity: payload.quantity,
    currency: payload.price.currencyCode,
  });
  target.dispatchEvent(new CustomEvent("future-light:cart-add-success", { detail: payload }));

  if (typeof window !== "undefined" && window.Shopify?.analytics?.publish) {
    try {
      const result = window.Shopify.analytics.publish("future_light_store:cart_add", payload);
      void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Custom event publication must never make a successful cart add fail.
    }
  }
}
