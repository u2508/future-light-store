import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Heart, LogOut, Menu, Search, User } from "lucide-react";
import { toast } from "sonner";
import { VsLogo } from "@/components/vs/VsLogo";
import { PredictiveSearch } from "@/components/vs/PredictiveSearch";
import { CartDrawer } from "@/components/vs/CartDrawer";
import { SiteMenu } from "@/components/vs/SiteMenu";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useWishlistStore } from "@/stores/wishlistStore";
import { useAuth } from "@/hooks/useAuth";

const HEADER_NAV_ITEMS = [
  { label: "Shop all", to: "/shop" as const },
  { label: "Collections", to: "/collections" as const },
  {
    label: "New arrivals",
    to: "/collections/$handle" as const,
    params: { handle: "new-arrivals" },
  },
  {
    label: "Best sellers",
    to: "/collections/$handle" as const,
    params: { handle: "best-sellers" },
  },
  {
    label: "Premium picks",
    to: "/collections/$handle" as const,
    params: { handle: "premium-picks" },
  },
  { label: "Track order", to: "/track-order" as const },
  { label: "Support", to: "/help" as const },
  {
    label: "Contact us",
    to: "/policies/$slug" as const,
    params: { slug: "contact" },
  },
] as const;

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

  const iconButton =
    "grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95 backdrop-blur-xl">
      <div className="hidden bg-[#101116] text-white/75 sm:block">
        <div className="vs-wide-shell flex items-center justify-between py-2 text-[10px] tracking-[0.12em]">
          <span>Unexpected finds. Everyday upgrades.</span>
          <span>Tracked delivery · Secure checkout</span>
        </div>
      </div>
      <div className="vs-wide-shell py-3 sm:py-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <Sheet open={mobileNav} onOpenChange={setMobileNav}>
            <SheetTrigger asChild>
              <button type="button" aria-label="Open menu" className={iconButton}>
                <Menu className="h-4 w-4" />
              </button>
            </SheetTrigger>
            <SiteMenu email={user?.email ?? null} onNavigate={() => setMobileNav(false)} />
          </Sheet>
          <VsLogo />
          <div className="mx-auto hidden w-full max-w-3xl px-4 lg:block">
            <PredictiveSearch />
          </div>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <Sheet open={mobileSearch} onOpenChange={setMobileSearch}>
              <SheetTrigger asChild>
                <button type="button" aria-label="Search" className={iconButton + " lg:hidden"}>
                  <Search className="h-4 w-4" />
                </button>
              </SheetTrigger>
              <SheetContent side="top" className="h-[100dvh] overflow-y-auto pt-16">
                <SheetTitle>Find your next favourite</SheetTitle>
                <SheetDescription className="mb-5">
                  Search products and everyday essentials.
                </SheetDescription>
                <PredictiveSearch autoFocus onNavigate={() => setMobileSearch(false)} />
              </SheetContent>
            </Sheet>
            {loading ? (
              <div
                role="status"
                aria-label="Checking account session"
                className="hidden h-11 w-11 rounded-full bg-muted sm:block"
              />
            ) : (
              <>
                <Link
                  to={user ? "/account" : "/auth"}
                  aria-label={user ? "Your account" : "Sign in to account"}
                  className={iconButton + " hidden sm:grid"}
                >
                  <User className="h-4 w-4" />
                </Link>
                {user && (
                  <button
                    type="button"
                    aria-label="Sign out of account"
                    disabled={signingOut}
                    onClick={handleSignOut}
                    className={iconButton + " hidden sm:grid"}
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                )}
              </>
            )}
            <Link
              to="/wishlist"
              aria-label={`Wishlist, ${wishlistCount} items`}
              className={iconButton + " relative hidden sm:grid"}
            >
              <Heart className="h-4 w-4" />
              {wishlistCount > 0 && (
                <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] text-white">
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
            <Link to="/auth" className="underline">
              Try again
            </Link>
          </div>
        )}
      </div>
      <nav
        aria-label="Main navigation"
        className="hidden overflow-hidden border-t border-border/60 lg:block"
      >
        <div className="vs-wide-shell overflow-x-auto">
          <div className="flex w-full min-w-max gap-8 lg:min-w-0 lg:justify-between lg:gap-4">
            {HEADER_NAV_ITEMS.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                params={(item as { params?: Record<string, string> }).params as never}
                className="min-h-12 shrink-0 border-b-2 border-transparent px-1 py-3 text-center text-sm font-medium tracking-[-0.01em] text-muted-foreground transition-colors hover:text-foreground sm:text-base lg:text-lg"
                activeProps={{ className: "border-foreground text-foreground" }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>
    </header>
  );
}
