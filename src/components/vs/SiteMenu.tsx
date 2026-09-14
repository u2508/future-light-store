import { Link } from "@tanstack/react-router";
import { ArrowUpRight, User, Heart, Package, LifeBuoy } from "lucide-react";
import { SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { collectionThumbnail } from "@/lib/collection-artwork";

const CATEGORIES = [
  ["portable-gadgets", "Tech & everyday carry"],
  ["home-decor", "Home & living"],
  ["beauty-makeup-essentials", "Beauty & self-care"],
  ["womens-fashion", "Women's style"],
  ["mens-fashion", "Men's style"],
  ["travel-outdoor", "Travel & outdoors"],
  ["pet-essentials", "For your pets"],
  ["kids-toys-games", "Kids & play"],
  ["gifts", "Gifts worth giving"],
  ["kitchen-gadgets", "Kitchen discoveries"],
] as const;

const FEATURED_EDITS = [
  ["new-arrivals", "New arrivals"],
  ["best-sellers", "Best sellers"],
  ["premium-picks", "Premium picks"],
] as const;

export function SiteMenu({ email, onNavigate }: { email?: string | null; onNavigate: () => void }) {
  return (
    <SheetContent
      side="left"
      className="flex h-[100dvh] w-[min(90vw,400px)] flex-col gap-0 overflow-hidden border-r-0 p-0 sm:max-w-[400px] [&>button]:right-5 [&>button]:top-5 [&>button]:grid [&>button]:h-11 [&>button]:w-11 [&>button]:place-items-center [&>button]:rounded-full [&>button]:bg-white/10 [&>button]:text-white"
    >
      <div className="shrink-0 bg-[#101116] px-6 pb-6 pt-7 text-white">
        <SheetTitle className="pr-12 text-2xl text-white">A world of good finds.</SheetTitle>
        <SheetDescription className="mt-2 pr-10 text-xs text-white/65">
          Pick a world. Find something unexpected.
        </SheetDescription>
        <Link
          to={email ? "/account" : "/auth"}
          onClick={onNavigate}
          className="mt-6 flex min-h-11 items-center gap-3 rounded-xl bg-white/8 px-3 py-2 text-sm"
        >
          <User className="h-5 w-5 shrink-0" />
          <span className="truncate">{email || "Sign in to your account"}</span>
          <ArrowUpRight className="ml-auto h-4 w-4 shrink-0" />
        </Link>
      </div>
      <div
        data-menu-scroll
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background px-5 py-5"
      >
        <nav aria-label="Featured edits" className="mb-6">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Featured edits
          </p>
          <div className="grid grid-cols-3 gap-2">
            {FEATURED_EDITS.map(([handle, title]) => (
              <Link
                key={handle}
                to="/collections/$handle"
                params={{ handle }}
                onClick={onNavigate}
                className="flex min-h-[84px] flex-col justify-between rounded-xl border border-border/70 bg-[#eef4ff] p-3 text-xs font-semibold transition-colors hover:bg-[#e3edff]"
              >
                <span>{title}</span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </nav>
        <nav aria-label="Shop by category">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Explore the collections
            </p>
            <Link
              to="/collections"
              onClick={onNavigate}
              className="py-2 text-xs underline underline-offset-4"
            >
              View all
            </Link>
          </div>
          {CATEGORIES.map(([handle, title]) => (
            <Link
              key={handle}
              to="/collections/$handle"
              params={{ handle }}
              onClick={onNavigate}
              className="group mb-2 flex min-h-16 items-center gap-3 rounded-xl border border-border/70 bg-card p-2 transition-colors hover:bg-muted"
            >
              <div className="h-12 w-14 shrink-0 overflow-hidden rounded-lg bg-[#15161c]">
                {collectionThumbnail(handle) && (
                  <img
                    src={collectionThumbnail(handle)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover object-right"
                  />
                )}
              </div>
              <span className="text-sm font-medium">{title}</span>
              <ArrowUpRight className="ml-auto mr-2 h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </nav>
      </div>
      <div className="shrink-0 border-t border-border bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
          <Link
            to="/wishlist"
            onClick={onNavigate}
            className="flex min-h-12 flex-col items-center justify-center gap-1"
          >
            <Heart className="h-4 w-4" />
            Saved
          </Link>
          <Link
            to="/track-order"
            onClick={onNavigate}
            className="flex min-h-12 flex-col items-center justify-center gap-1"
          >
            <Package className="h-4 w-4" />
            Track order
          </Link>
          <Link
            to="/help"
            onClick={onNavigate}
            className="flex min-h-12 flex-col items-center justify-center gap-1"
          >
            <LifeBuoy className="h-4 w-4" />
            Help centre
          </Link>
        </div>
      </div>
    </SheetContent>
  );
}
