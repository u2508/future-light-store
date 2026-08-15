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
    <footer className="mt-20 border-t border-border bg-surface">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-4">
        <div className="space-y-3">
          <VsLogo />
          <p className="max-w-xs text-sm text-muted-foreground">
            A future-facing marketplace: precise search, honest pricing, and fulfilment you can track end to end.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{col.title}</h3>
            <ul className="space-y-2 text-sm">
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
      <div className="border-t border-border px-4 py-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} VS Store. All rights reserved.</p>
          <p>Prices in USD · Reporting timezone America/New_York</p>
        </div>
      </div>
    </footer>
  );
}
