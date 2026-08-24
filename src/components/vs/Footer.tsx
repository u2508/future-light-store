import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  Mail,
  MessageCircle,
  PackageCheck,
  Phone,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { VsLogo } from "@/components/vs/VsLogo";
import { STORE_CONTACT } from "@/lib/store-contact";

const COLUMNS = [
  {
    title: "Company",
    links: [
      { label: "Home", to: "/" as const },
      { label: "About us", to: "/about" as const },
      { label: "Contact us", to: "/policies/$slug" as const, params: { slug: "contact" } },
      { label: "Track order", to: "/track-order" as const },
      { label: "Help centre", to: "/help" as const },
    ],
  },
  {
    title: "Explore",
    links: [
      { label: "Shop all", to: "/shop" as const },
      { label: "Collections", to: "/collections" as const },
      { label: "New arrivals", to: "/shop" as const, search: { sort: "newest" } },
      { label: "Offers", to: "/offers" as const },
    ],
  },
  {
    title: "Policies",
    links: [
      { label: "Shipping", to: "/policies/$slug" as const, params: { slug: "shipping" } },
      { label: "Returns", to: "/policies/$slug" as const, params: { slug: "returns" } },
      { label: "Privacy", to: "/policies/$slug" as const, params: { slug: "privacy" } },
      { label: "Terms", to: "/policies/$slug" as const, params: { slug: "terms" } },
      { label: "Legal notice", to: "/policies/$slug" as const, params: { slug: "legal-notice" } },
      { label: "All policies", to: "/policies" as const },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-20 border-t border-foreground/10 bg-foreground text-background">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-14 sm:py-16 lg:grid-cols-[1.15fr_repeat(3,minmax(0,0.8fr))_1.55fr]">
        <div className="space-y-6">
          <VsLogo inverse />
          <p className="max-w-xs text-sm leading-7 text-background/70">
            A future-facing marketplace with precise discovery, honest pricing and fulfilment you
            can follow from checkout to delivery.
          </p>
          <div className="flex items-center gap-2" aria-label="VS Store contact shortcuts">
            <a
              href={`mailto:${STORE_CONTACT.email}`}
              aria-label="Email VS Store"
              className="grid h-10 w-10 place-items-center rounded-full border border-background/15 text-background/75 transition-colors hover:border-background/40 hover:text-background"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href={`tel:${STORE_CONTACT.phoneHref}`}
              aria-label="Call VS Store"
              className="grid h-10 w-10 place-items-center rounded-full border border-background/15 text-background/75 transition-colors hover:border-background/40 hover:text-background"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
            </a>
            <Link
              to="/help"
              aria-label="Open VS Store help centre"
              className="grid h-10 w-10 place-items-center rounded-full border border-background/15 text-background/75 transition-colors hover:border-background/40 hover:text-background"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h3 className="mb-5 text-xs font-semibold uppercase tracking-[0.28em] text-background/55">
              {col.title}
            </h3>
            <ul className="space-y-3.5 text-sm">
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link
                    to={link.to}
                    params={(link as { params?: Record<string, string> }).params as never}
                    search={(link as { search?: Record<string, string> }).search as never}
                    className="text-background/75 transition-colors hover:text-background"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="rounded-[2rem] border border-background/15 bg-background/5 p-6 sm:p-7">
          <h3 className="text-xs font-semibold uppercase tracking-[0.28em] text-background/55">
            Contact
          </h3>
          <ul className="mt-5 space-y-3.5 text-sm">
            <li className="flex gap-3">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-background/45" aria-hidden="true" />
              <a
                href={`mailto:${STORE_CONTACT.email}`}
                className="whitespace-nowrap text-xs text-background/80 transition-colors hover:text-background sm:text-sm"
              >
                {STORE_CONTACT.email}
              </a>
            </li>
            <li className="flex gap-3">
              <Phone className="mt-0.5 h-4 w-4 shrink-0 text-background/45" aria-hidden="true" />
              <a
                href={`tel:${STORE_CONTACT.phoneHref}`}
                className="text-background/80 transition-colors hover:text-background"
              >
                {STORE_CONTACT.phoneDisplay}
              </a>
            </li>
            <li className="flex gap-3">
              <ArrowUpRight
                className="mt-0.5 h-4 w-4 shrink-0 text-background/45"
                aria-hidden="true"
              />
              <span className="text-background/80">{STORE_CONTACT.address}</span>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-background/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-7">
          <div className="flex flex-wrap gap-2">
            <TrustBadge
              icon={<span className="h-2 w-2 rounded-full bg-primary" />}
              label="Live store"
            />
            <TrustBadge icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Secure checkout" />
            <TrustBadge icon={<PackageCheck className="h-3.5 w-3.5" />} label="Tracked shipping" />
            <TrustBadge icon={<RotateCcw className="h-3.5 w-3.5" />} label="Easy returns" />
          </div>
          <div className="flex flex-col gap-4 text-xs text-background/55 md:flex-row md:items-center md:justify-between">
            <p>© {new Date().getFullYear()} VS Store. All rights reserved.</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2 uppercase tracking-[0.18em]">
              <Link to="/policies" className="transition-colors hover:text-background">
                Policies
              </Link>
              <Link
                to="/policies/$slug"
                params={{ slug: "contact" }}
                className="transition-colors hover:text-background"
              >
                Contact us
              </Link>
              <span>Powered by Shopify</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

function TrustBadge({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-background/15 bg-background/5 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-background/70">
      <span className="text-background/75">{icon}</span>
      {label}
    </span>
  );
}
