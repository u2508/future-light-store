import { createFileRoute, Link } from "@tanstack/react-router";
import { useWishlistStore } from "@/stores/wishlistStore";
import { ProductCard } from "@/components/vs/ProductCard";

export const Route = createFileRoute("/wishlist")({
  head: () => ({
    meta: [
      { title: "Wishlist — VS Store" },
      { name: "description", content: "Everything you've saved at VS Store, ready when you are." },
      { property: "og:title", content: "Wishlist — VS Store" },
      { property: "og:description", content: "Everything you've saved at VS Store." },
    ],
  }),
  component: WishlistPage,
});

function WishlistPage() {
  const items = useWishlistStore((s) => s.items);
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">Wishlist</h1>
      {items.length === 0 ? (
        <div className="vs-card mt-6 p-12 text-center">
          <p className="font-display text-lg font-semibold">Nothing saved yet</p>
          <Link to="/shop" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
            Find something you love →
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => (
            <ProductCard key={p.node.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
