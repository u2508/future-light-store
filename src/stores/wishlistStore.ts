import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ShopifyProduct } from "@/lib/shopify";

interface WishlistStore {
  items: ShopifyProduct[];
  toggle: (product: ShopifyProduct) => boolean;
  remove: (handle: string) => void;
  has: (handle: string) => boolean;
  clear: () => void;
}

export const useWishlistStore = create<WishlistStore>()(
  persist(
    (set, get) => ({
      items: [],
      toggle: (product) => {
        const exists = get().items.some((i) => i.node.handle === product.node.handle);
        if (exists) {
          set({ items: get().items.filter((i) => i.node.handle !== product.node.handle) });
          return false;
        }
        set({ items: [product, ...get().items] });
        return true;
      },
      remove: (handle) => set({ items: get().items.filter((i) => i.node.handle !== handle) }),
      has: (handle) => get().items.some((i) => i.node.handle === handle),
      clear: () => set({ items: [] }),
    }),
    { name: "vs-wishlist", storage: createJSONStorage(() => localStorage) },
  ),
);

interface RecentStore {
  handles: string[];
  push: (handle: string) => void;
}

export const useRecentStore = create<RecentStore>()(
  persist(
    (set, get) => ({
      handles: [],
      push: (handle) => set({ handles: [handle, ...get().handles.filter((h) => h !== handle)].slice(0, 12) }),
    }),
    { name: "vs-recently-viewed", storage: createJSONStorage(() => localStorage) },
  ),
);
