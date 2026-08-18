import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Heart, LogOut, MapPin, Menu, Search, User, X } from "lucide-react";
import { toast } from "sonner";
import { VsLogo } from "@/components/vs/VsLogo";
import { PredictiveSearch } from "@/components/vs/PredictiveSearch";
import { CartDrawer } from "@/components/vs/CartDrawer";
import { useWishlistStore } from "@/stores/wishlistStore";
import { useAuth } from "@/hooks/useAuth";
import { FEATURED_COLLECTION_LINKS } from "@/lib/seo-content";

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
  const { user, loading, error, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const wishlistCount = useWishlistStore((s) => s.items.length);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      toast.success("Signed out");
    } catch {
      toast.error("You were signed out locally, but the server could not be reached.");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-2xl">
      <div className="border-b border-border/60 bg-surface/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
          <span>Premium curation, tracked fulfilment, secure checkout</span>
          <span className="hidden sm:inline-flex">Fast support from our help centre</span>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileNav((v) => !v)}
            aria-label="Open menu"
            className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card shadow-sm transition-colors hover:border-primary"
          >
            {mobileNav ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          <VsLogo />

          <div className="mx-auto hidden w-full max-w-3xl lg:block">
            <PredictiveSearch />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setMobileSearch(true)}
              aria-label="Search"
              className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card shadow-sm transition-colors hover:border-primary lg:hidden"
            >
              <Search className="h-4 w-4" />
            </button>

            {loading ? (
              <div
                role="status"
                aria-label="Checking account session"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card md:w-40"
              >
                <span className="h-3 w-20 animate-pulse rounded-full bg-muted" />
              </div>
            ) : (
              <>
                <Link
                  to={user ? "/account" : "/auth"}
                  aria-label={user ? `Account for ${user.email ?? "signed-in user"}` : "Sign in to account"}
                  className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-left text-xs leading-tight shadow-sm transition-colors hover:border-primary md:px-4"
                >
                  <User className="h-4 w-4 shrink-0" />
                  <span className="hidden max-w-[10rem] truncate sm:block">
                    {user ? (
                      <>
                        <span className="block truncate font-semibold">{user.email ?? "Signed-in account"}</span>
                        <span className="block text-muted-foreground">Profile &amp; Orders</span>
                      </>
                    ) : (
                      <>
                        <span className="block text-muted-foreground">Hello, sign in</span>
                        <span className="block font-semibold">Account &amp; Orders</span>
                      </>
                    )}
                  </span>
                </Link>
                {user && (
                  <button
                    type="button"
                    aria-label="Sign out of account"
                    title="Sign out"
                    disabled={signingOut}
                    onClick={handleSignOut}
                    className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card shadow-sm transition-colors hover:border-primary disabled:cursor-wait disabled:opacity-60"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                )}
              </>
            )}

            <Link
              to="/wishlist"
              aria-label={`Wishlist, ${wishlistCount} items`}
              className="relative grid h-11 w-11 place-items-center rounded-full border border-border bg-card shadow-sm transition-colors hover:border-signal"
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
        {error && (
          <div role="alert" className="pt-2 text-xs text-destructive">
            {error}{" "}
            <Link to="/auth" className="font-semibold underline">
              Try again
            </Link>
          </div>
        )}
      </div>

      <nav className="border-t border-border/70 bg-surface/75">
        <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-4 py-3 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              search={item.search as never}
              className="whitespace-nowrap rounded-full border border-transparent px-3.5 py-1.5 font-medium text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground"
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
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-foreground/35" onClick={() => setMobileNav(false)} />
          <aside className="absolute left-0 top-0 h-full w-[86%] max-w-md overflow-y-auto border-r border-border bg-card shadow-[var(--shadow-lift)]">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Menu</p>
                <p className="mt-1 font-display text-lg font-semibold">Collections & navigation</p>
              </div>
              <button
                onClick={() => setMobileNav(false)}
                aria-label="Close menu"
                className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-6 p-5">
              <section>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Collections</p>
                <div className="mt-3 grid gap-2">
                  {FEATURED_COLLECTION_LINKS.map((collection) => (
                    <Link
                      key={collection.handle}
                      to="/collections/$handle"
                      params={{ handle: collection.handle }}
                      onClick={() => setMobileNav(false)}
                      className="rounded-2xl border border-border bg-surface/60 px-4 py-3 transition-colors hover:border-primary hover:bg-accent"
                    >
                      <p className="text-sm font-semibold">{collection.title}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{collection.description}</p>
                    </Link>
                  ))}
                </div>
              </section>

              <section>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Browse</p>
                <div className="mt-3 grid gap-1">
                  {NAV.map((item) => (
                    <Link
                      key={item.label}
                      to={item.to}
                      search={item.search as never}
                      onClick={() => setMobileNav(false)}
                      className="rounded-xl px-3 py-3 text-sm font-medium hover:bg-muted"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </section>
            </div>
          </aside>
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
