import { Link } from "@tanstack/react-router";
import { VsLogo } from "@/components/vs/VsLogo";

const COLUMNS = [
  {
    title: "Shop",
    links: [
      { label: "All products", to: "/shop" as const },
      { label: "Offers", to: "/offers" as const },
      { label: "Wishlist", to: "/wishlist" as const },
      { label: "Bag", to: "/cart" as const },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", to: "/account" as const },
      { label: "Orders", to: "/orders" as const },
      { label: "Track order", to: "/track-order" as const },
      { label: "Help centre", to: "/help" as const },
    ],
  },
  {
    title: "Policies",
    links: [
      { label: "Shipping", to: "/policies/$slug" as const, params: { slug: "shipping" } },
      { label: "Returns", to: "/policies/$slug" as const, params: { slug: "returns" } },
      { label: "Privacy", to: "/policies/$slug" as const, params: { slug: "privacy" } },
      { label: "Terms", to: "/policies/$slug" as const, params: { slug: "terms" } },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-20 border-t border-border/70 bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="rounded-[2rem] border border-border/70 vs-section-shell px-6 py-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">VS Store</p>
              <p className="max-w-2xl text-sm text-muted-foreground">
                A future-facing marketplace: precise search, honest pricing, and fulfilment you can track end to end.
              </p>
            </div>
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
              Premium retail, built for clarity
            </p>
          </div>
        </div>
      </div>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-4">
        <div className="space-y-4">
          <VsLogo />
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">{col.title}</h3>
            <ul className="space-y-3 text-sm">
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link
                    to={link.to}
                    params={(link as { params?: Record<string, string> }).params as never}
                    className="text-muted-foreground transition-colors hover:text-primary"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border/70 px-4 py-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} VS Store. All rights reserved.</p>
          <p>Prices in USD · Reporting timezone America/New_York</p>
        </div>
      </div>
    </footer>
  );
}
