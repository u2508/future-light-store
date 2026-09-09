import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { storefrontApiRequest, type ShopifyProduct } from "@/lib/shopify";
import {
  beginProductCartAddEvent,
  dispatchFutureLightCartAdd,
  normalizeCartForStandardEvent,
} from "@/lib/shopifyStandardEvents";

export interface CartItem {
  lineId: string | null;
  product: ShopifyProduct;
  variantId: string;
  variantTitle: string;
  price: { amount: string; currencyCode: string };
  quantity: number;
  selectedOptions: Array<{ name: string; value: string }>;
}

const CART_QUERY = `
  query cart($id: ID!) {
    cart(id: $id) { id totalQuantity }
  }
`;

const CART_CREATE_MUTATION = `
  mutation cartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
        totalQuantity
        cost { totalAmount { amount currencyCode } }
        discountCodes { code applicable }
        lines(first: 100) {
          edges {
            node {
              id
              quantity
              cost { totalAmount { amount currencyCode } }
              merchandise {
                ... on ProductVariant {
                  id
                  title
                  availableForSale
                  price { amount currencyCode }
                  selectedOptions { name value }
                }
              }
            }
          }
        }
      }
      userErrors { field message }
      warnings { code message }
    }
  }
`;

const CART_LINES_ADD_MUTATION = `
  mutation cartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart {
        id
        totalQuantity
        cost { totalAmount { amount currencyCode } }
        discountCodes { code applicable }
        lines(first: 100) {
          edges {
            node {
              id
              quantity
              cost { totalAmount { amount currencyCode } }
              merchandise {
                ... on ProductVariant {
                  id
                  title
                  availableForSale
                  price { amount currencyCode }
                  selectedOptions { name value }
                }
              }
            }
          }
        }
      }
      userErrors { field message }
      warnings { code message }
    }
  }
`;

const CART_LINES_UPDATE_MUTATION = `
  mutation cartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) {
      cart {
        id
        totalQuantity
        cost { totalAmount { amount currencyCode } }
        discountCodes { code applicable }
        lines(first: 100) {
          edges {
            node {
              id
              quantity
              cost { totalAmount { amount currencyCode } }
              merchandise {
                ... on ProductVariant {
                  id
                  title
                  availableForSale
                  price { amount currencyCode }
                  selectedOptions { name value }
                }
              }
            }
          }
        }
      }
      userErrors { field message }
      warnings { code message }
    }
  }
`;

const CART_LINES_REMOVE_MUTATION = `
  mutation cartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
      cart { id }
      userErrors { field message }
      warnings { code message }
    }
  }
`;

function formatCheckoutUrl(checkoutUrl: string): string {
  try {
    const url = new URL(checkoutUrl);
    url.searchParams.set("channel", "online_store");
    return url.toString();
  } catch {
    return checkoutUrl;
  }
}

type UserErrors = Array<{ field: string[] | null; message: string }>;
type CartWarnings = Array<{ code: string; message: string }>;

export interface CartAddResult {
  success: boolean;
  message?: string;
}

function getCartFailureMessage(warnings: CartWarnings = [], userErrors: UserErrors = []): string {
  return warnings[0]?.message ?? userErrors[0]?.message ?? "This item is currently unavailable.";
}

function hasAcceptedCartLine(
  cart:
    | {
        totalQuantity?: number;
        lines?: {
          edges?: Array<{
            node?: { quantity?: number; merchandise?: { id?: string } };
          }>;
        };
      }
    | null
    | undefined,
  variantId: string,
  requestedQuantity: number,
): boolean {
  const line = cart?.lines?.edges?.find((edge) => edge.node?.merchandise?.id === variantId);
  return Boolean(
    line?.node &&
    Number(line.node.quantity) >= requestedQuantity &&
    Number(cart?.totalQuantity) >= requestedQuantity,
  );
}

function isCartNotFoundError(userErrors: UserErrors): boolean {
  return userErrors.some(
    (e) =>
      e.message.toLowerCase().includes("cart not found") ||
      e.message.toLowerCase().includes("does not exist"),
  );
}

async function createShopifyCart(item: CartItem) {
  const data = await storefrontApiRequest(CART_CREATE_MUTATION, {
    input: { lines: [{ quantity: item.quantity, merchandiseId: item.variantId }] },
  });
  const payload = data?.data?.cartCreate;
  const userErrors: UserErrors = payload?.userErrors ?? [];
  const warnings: CartWarnings = payload?.warnings ?? [];
  const cart = payload?.cart;
  const lineId = cart?.lines?.edges?.find(
    (edge: { node?: { merchandise?: { id?: string } } }) =>
      edge.node?.merchandise?.id === item.variantId,
  )?.node?.id;
  if (
    userErrors.length > 0 ||
    !cart?.checkoutUrl ||
    !lineId ||
    !hasAcceptedCartLine(cart, item.variantId, item.quantity)
  ) {
    console.warn("Cart creation did not accept the requested item", { userErrors, warnings });
    return {
      success: false as const,
      message: getCartFailureMessage(warnings, userErrors),
    };
  }
  return {
    success: true as const,
    cartId: cart.id as string,
    checkoutUrl: formatCheckoutUrl(cart.checkoutUrl),
    lineId: lineId as string,
    cart,
  };
}

async function addLineToShopifyCart(cartId: string, item: CartItem) {
  const data = await storefrontApiRequest(CART_LINES_ADD_MUTATION, {
    cartId,
    lines: [{ quantity: item.quantity, merchandiseId: item.variantId }],
  });
  const payload = data?.data?.cartLinesAdd;
  const userErrors: UserErrors = payload?.userErrors ?? [];
  const warnings: CartWarnings = payload?.warnings ?? [];
  if (isCartNotFoundError(userErrors)) {
    return {
      success: false,
      cartNotFound: true,
      message: getCartFailureMessage(warnings, userErrors),
    };
  }
  if (userErrors.length > 0) {
    console.error("Add line failed:", userErrors);
    return { success: false, message: getCartFailureMessage(warnings, userErrors) };
  }
  const cart = payload?.cart;
  const lines = cart?.lines?.edges ?? [];
  const newLine = lines.find(
    (l: { node: { id: string; merchandise: { id: string } } }) =>
      l.node.merchandise.id === item.variantId,
  );
  if (!hasAcceptedCartLine(cart, item.variantId, item.quantity)) {
    console.warn("Shopify did not accept the requested cart line", { warnings });
    return { success: false, message: getCartFailureMessage(warnings) };
  }
  return {
    success: true,
    lineId: newLine?.node?.id as string | undefined,
    cart,
  };
}

async function updateShopifyCartLine(cartId: string, lineId: string, quantity: number) {
  const data = await storefrontApiRequest(CART_LINES_UPDATE_MUTATION, {
    cartId,
    lines: [{ id: lineId, quantity }],
  });
  const payload = data?.data?.cartLinesUpdate;
  const userErrors: UserErrors = payload?.userErrors ?? [];
  const warnings: CartWarnings = payload?.warnings ?? [];
  if (isCartNotFoundError(userErrors)) {
    return {
      success: false,
      cartNotFound: true,
      message: getCartFailureMessage(warnings, userErrors),
    };
  }
  if (userErrors.length > 0) {
    return { success: false, message: getCartFailureMessage(warnings, userErrors) };
  }
  const cart = payload?.cart;
  const line = cart?.lines?.edges?.find(
    (edge: { node?: { id?: string } }) => edge.node?.id === lineId,
  );
  if (!line?.node || Number(line.node.quantity) < quantity) {
    return { success: false, message: getCartFailureMessage(warnings) };
  }
  return { success: true, cart };
}

async function removeLineFromShopifyCart(cartId: string, lineId: string) {
  const data = await storefrontApiRequest(CART_LINES_REMOVE_MUTATION, {
    cartId,
    lineIds: [lineId],
  });
  const payload = data?.data?.cartLinesRemove;
  const userErrors: UserErrors = payload?.userErrors ?? [];
  const warnings: CartWarnings = payload?.warnings ?? [];
  if (isCartNotFoundError(userErrors)) return { success: false, cartNotFound: true };
  if (userErrors.length > 0) {
    return { success: false, message: getCartFailureMessage(warnings, userErrors) };
  }
  return { success: true };
}

interface CartStore {
  items: CartItem[];
  cartId: string | null;
  checkoutUrl: string | null;
  isLoading: boolean;
  isSyncing: boolean;
  addItem: (item: Omit<CartItem, "lineId">) => Promise<CartAddResult>;
  updateQuantity: (variantId: string, quantity: number) => Promise<void>;
  removeItem: (variantId: string) => Promise<void>;
  clearCart: () => void;
  syncCart: () => Promise<void>;
  getCheckoutUrl: () => string | null;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      cartId: null,
      checkoutUrl: null,
      isLoading: false,
      isSyncing: false,

      addItem: async (item) => {
        const { items, cartId, clearCart } = get();
        const existingItem = items.find((i) => i.variantId === item.variantId);
        let cartEvent: ReturnType<typeof beginProductCartAddEvent> = null;
        set({ isLoading: true });
        try {
          if (!cartId) {
            cartEvent = beginProductCartAddEvent({
              variantId: item.variantId,
              quantity: item.quantity,
              productId: item.product.node.id,
              productTitle: item.product.node.title,
              price: item.price,
            });
            const result = await createShopifyCart({ ...item, lineId: null });
            if (result.success) {
              set({
                cartId: result.cartId,
                checkoutUrl: result.checkoutUrl,
                items: [{ ...item, lineId: result.lineId }],
              });
              cartEvent?.resolve(
                normalizeCartForStandardEvent(result.cart, item.price.currencyCode),
              );
              dispatchFutureLightCartAdd({
                productId: item.product.node.id,
                productTitle: item.product.node.title,
                variantId: item.variantId,
                quantity: item.quantity,
                price: item.price,
              });
              return { success: true };
            }
            cartEvent?.resolve(null, [{ field: [], message: result.message }]);
            return result;
          } else if (existingItem) {
            const newQuantity = existingItem.quantity + item.quantity;
            if (!existingItem.lineId) {
              return { success: false, message: "This item is currently unavailable." };
            }
            cartEvent = beginProductCartAddEvent({
              variantId: item.variantId,
              quantity: item.quantity,
              productId: item.product.node.id,
              productTitle: item.product.node.title,
              price: item.price,
            });
            const result = await updateShopifyCartLine(cartId, existingItem.lineId, newQuantity);
            if (result.success) {
              const currentItems = get().items;
              set({
                items: currentItems.map((i) =>
                  i.variantId === item.variantId ? { ...i, quantity: newQuantity } : i,
                ),
              });
              cartEvent?.resolve(
                normalizeCartForStandardEvent(result.cart, item.price.currencyCode),
              );
              dispatchFutureLightCartAdd({
                productId: item.product.node.id,
                productTitle: item.product.node.title,
                variantId: item.variantId,
                quantity: item.quantity,
                price: item.price,
              });
              return { success: true };
            } else if (result.cartNotFound) {
              clearCart();
            }
            const message = result.message ?? "Cart line update failed";
            cartEvent?.resolve(null, [{ field: [], message }]);
            return { success: false, message };
          } else {
            cartEvent = beginProductCartAddEvent({
              variantId: item.variantId,
              quantity: item.quantity,
              productId: item.product.node.id,
              productTitle: item.product.node.title,
              price: item.price,
            });
            const result = await addLineToShopifyCart(cartId, { ...item, lineId: null });
            if (result.success) {
              const currentItems = get().items;
              set({ items: [...currentItems, { ...item, lineId: result.lineId ?? null }] });
              cartEvent?.resolve(
                normalizeCartForStandardEvent(result.cart, item.price.currencyCode),
              );
              dispatchFutureLightCartAdd({
                productId: item.product.node.id,
                productTitle: item.product.node.title,
                variantId: item.variantId,
                quantity: item.quantity,
                price: item.price,
              });
              return { success: true };
            } else if (result.cartNotFound) {
              clearCart();
            }
            const message = result.message ?? "Cart line add failed";
            cartEvent?.resolve(null, [{ field: [], message }]);
            return { success: false, message };
          }
        } catch (error) {
          console.error("Failed to add item:", error);
          cartEvent?.reject(error);
          return { success: false, message: "Couldn’t add this item right now." };
        } finally {
          set({ isLoading: false });
        }
      },

      updateQuantity: async (variantId, quantity) => {
        if (quantity <= 0) {
          await get().removeItem(variantId);
          return;
        }
        const { items, cartId, clearCart } = get();
        const item = items.find((i) => i.variantId === variantId);
        if (!item?.lineId || !cartId) return;
        set({ isLoading: true });
        try {
          const result = await updateShopifyCartLine(cartId, item.lineId, quantity);
          if (result.success) {
            const currentItems = get().items;
            set({
              items: currentItems.map((i) => (i.variantId === variantId ? { ...i, quantity } : i)),
            });
          } else if (result.cartNotFound) {
            clearCart();
          }
        } catch (error) {
          console.error("Failed to update quantity:", error);
        } finally {
          set({ isLoading: false });
        }
      },

      removeItem: async (variantId) => {
        const { items, cartId, clearCart } = get();
        const item = items.find((i) => i.variantId === variantId);
        if (!item?.lineId || !cartId) return;
        set({ isLoading: true });
        try {
          const result = await removeLineFromShopifyCart(cartId, item.lineId);
          if (result.success) {
            const newItems = get().items.filter((i) => i.variantId !== variantId);
            if (newItems.length === 0) clearCart();
            else set({ items: newItems });
          } else if (result.cartNotFound) {
            clearCart();
          }
        } catch (error) {
          console.error("Failed to remove item:", error);
        } finally {
          set({ isLoading: false });
        }
      },

      clearCart: () => set({ items: [], cartId: null, checkoutUrl: null }),
      getCheckoutUrl: () => get().checkoutUrl,

      syncCart: async () => {
        const { cartId, isSyncing, clearCart } = get();
        if (!cartId || isSyncing) return;
        set({ isSyncing: true });
        try {
          const data = await storefrontApiRequest(CART_QUERY, { id: cartId });
          // Keep the locally persisted bag intact when the proxy returns an
          // error, a partial payload, or a temporarily unavailable cart. A
          // missing response must never turn a visible bag into an empty one.
          if (!data?.data || !Object.prototype.hasOwnProperty.call(data.data, "cart")) return;
          const cart = data.data.cart;
          if (cart?.id === cartId && cart.totalQuantity === 0) clearCart();
        } catch (error) {
          console.error("Failed to sync cart:", error);
        } finally {
          set({ isSyncing: false });
        }
      },
    }),
    {
      name: "vs-cart",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        items: state.items,
        cartId: state.cartId,
        checkoutUrl: state.checkoutUrl,
      }),
    },
  ),
);
