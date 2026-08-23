import { Link } from "@tanstack/react-router";
import { Grid2X2, House, Search, ShoppingBag, UserRound } from "lucide-react";

const ITEMS = [
  { label: "Home", to: "/" as const, icon: House },
  { label: "Shop", to: "/shop" as const, icon: ShoppingBag },
  { label: "Collections", to: "/collections" as const, icon: Grid2X2 },
  { label: "Search", to: "/search" as const, icon: Search },
  { label: "Account", to: "/account" as const, icon: UserRound },
];

export function MobileAppNav() {
  return (
    <nav
      aria-label="Mobile app navigation"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex items-center justify-around rounded-[1.35rem] border border-border/80 bg-background/90 p-1.5 shadow-[0_16px_45px_rgba(15,23,42,0.16)] backdrop-blur-xl lg:hidden"
    >
      {ITEMS.map(({ label, to, icon: Icon }) => (
        <Link
          key={label}
          to={to}
          activeOptions={{ exact: to === "/" }}
          activeProps={{ className: "bg-primary text-primary-foreground shadow-sm" }}
          className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={label}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          <span className="max-w-full truncate">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
