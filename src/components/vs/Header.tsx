import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Heart, MapPin, Menu, Search, User, X } from "lucide-react";
import { VsLogo } from "@/components/vs/VsLogo";
import { PredictiveSearch } from "@/components/vs/PredictiveSearch";
import { CartDrawer } from "@/components/vs/CartDrawer";
import { useWishlistStore } from "@/stores/wishlistStore";
import { useAuth } from "@/hooks/useAuth";

const NAV = [
  { label: "Shop all", to: "/shop" as const },
  { label: "Collections", to: "/collections" as const },
  { label: "New arrivals", to: "/shop" as const, search: { sort: "newest" } },
  { label: "Best sellers", to: "/shop" as const, search: { sort: "best-selling" } },
  { label: "Offers", to: "/offers" as const },
  { label: "Track order", to: "/track-order" as const },
  { label: "Support", to: "/help" as const },
];

export function Header() {
  const [mobileSearch, setMobileSearch] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const wishlistCount = useWishlistStore((s) => s.items.length);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <button
          onClick={() => setMobileNav((v) => !v)}
          aria-label="Open menu"
          className="grid h-10 w-10 place-items-center rounded-xl border border-border lg:hidden"
        >
          {mobileNav ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>

        <VsLogo />

        <div className="mx-auto hidden w-full max-w-2xl lg:block">
          <PredictiveSearch />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setMobileSearch(true)}
            aria-label="Search"
            className="grid h-10 w-10 place-items-center rounded-xl border border-border lg:hidden"
          >
            <Search className="h-4 w-4" />
          </button>

          <Link
            to="/account"
            className="hidden items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-xs leading-tight transition-colors hover:border-primary md:flex"
          >
            <User className="h-4 w-4" />
            <span>
              <span className="block text-muted-foreground">Hello, sign in</span>
              <span className="block font-semibold">Account &amp; Orders</span>
            </span>
          </Link>

          <Link
            to="/wishlist"
            aria-label={`Wishlist, ${wishlistCount} items`}
            className="relative grid h-10 w-10 place-items-center rounded-xl border border-border bg-card transition-colors hover:border-signal"
          >
            <Heart className="h-4 w-4" />
            {wishlistCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-signal px-1 text-[11px] font-bold text-signal-foreground">
                {wishlistCount}
              </span>
            )}
          </Link>

          <CartDrawer />
        </div>
      </div>

      <nav className="border-t border-border bg-surface/60">
        <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-4 py-2 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              search={item.search as never}
              className="whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 font-medium text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              {item.label}
            </Link>
          ))}
          <span className="ml-auto hidden items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground md:flex">
            <MapPin className="h-3.5 w-3.5" /> Deliver to New York, US
          </span>
        </div>
      </nav>

      {mobileNav && (
        <div className="border-t border-border bg-card px-4 py-3 lg:hidden">
          <div className="grid gap-1">
            {NAV.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                search={item.search as never}
                onClick={() => setMobileNav(false)}
                className="rounded-xl px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {mobileSearch && (
        <div className="fixed inset-0 z-50 bg-background p-4 lg:hidden">
          <div className="mb-4 flex items-center justify-between">
            <VsLogo />
            <button
              onClick={() => setMobileSearch(false)}
              aria-label="Close search"
              className="grid h-10 w-10 place-items-center rounded-xl border border-border"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <PredictiveSearch autoFocus onNavigate={() => setMobileSearch(false)} />
        </div>
      )}
    </header>
  );
}
