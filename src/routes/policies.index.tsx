import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Mail, Phone, ShieldCheck } from "lucide-react";
import { POLICIES } from "@/lib/policies";
import { canonicalUrl } from "@/lib/seo";
import { STORE_CONTACT } from "@/lib/store-contact";

const POLICY_LINKS = [
  {
    slug: "shipping" as const,
    label: "Shipping policy",
    detail: "Processing, delivery estimates and tracking.",
  },
  {
    slug: "returns" as const,
    label: "Return and refund policy",
    detail: "Eligibility, approvals and refunds.",
  },
  {
    slug: "privacy" as const,
    label: "Privacy policy",
    detail: "How store and order information is used.",
  },
  {
    slug: "terms" as const,
    label: "Terms of service",
    detail: "The terms for browsing and shopping with VS Store.",
  },
  {
    slug: "contact" as const,
    label: "Contact information",
    detail: "Verified support and business details.",
  },
  {
    slug: "legal-notice" as const,
    label: "Legal notice",
    detail: "Store operator and platform information.",
  },
];

export const Route = createFileRoute("/policies/")({
  head: () => ({
    meta: [
      { title: "Policies & support — VS Store" },
      {
        name: "description",
        content: "VS Store shipping, returns, privacy, terms and contact information.",
      },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/policies") }],
  }),
  component: PoliciesIndexPage,
});

function PoliciesIndexPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:py-14">
      <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[2rem] vs-hero-gradient p-7 text-primary-foreground shadow-[var(--shadow-lift)] sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] opacity-70">
            VS Store / Support
          </p>
          <h1 className="mt-5 max-w-xl font-display text-3xl font-bold sm:text-5xl">
            Clear policies for a clearer checkout.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 opacity-85">
            Find the information behind delivery, returns, privacy, payments and customer support in
            one place.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.16em]">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Store information
            </span>
          </div>
        </div>
        <div className="vs-premium-panel rounded-[2rem] p-7 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            Need support?
          </p>
          <h2 className="mt-4 font-display text-2xl font-bold">We&apos;re here to help.</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            For order questions, include your order number and checkout email. Never send passwords,
            one-time codes or full card details by email.
          </p>
          <div className="mt-6 space-y-3 text-sm">
            <a
              href={`mailto:${STORE_CONTACT.email}`}
              className="flex items-center gap-3 text-foreground transition-colors hover:text-primary"
            >
              <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
              <span className="break-all">{STORE_CONTACT.email}</span>
            </a>
            <a
              href={`tel:${STORE_CONTACT.phoneHref}`}
              className="flex items-center gap-3 text-foreground transition-colors hover:text-primary"
            >
              <Phone className="h-4 w-4 text-primary" aria-hidden="true" />
              {STORE_CONTACT.phoneDisplay}
            </a>
          </div>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="policy-library">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              Policy library
            </p>
            <h2 id="policy-library" className="mt-2 font-display text-2xl font-bold sm:text-3xl">
              Store information, organised.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">
            Select a policy to read the full details.
          </p>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {POLICY_LINKS.map((item) => (
            <Link
              key={item.slug}
              to="/policies/$slug"
              params={{ slug: item.slug }}
              className="group rounded-[1.5rem] border border-border/70 bg-card p-5 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[var(--shadow-lift)]"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-sm font-semibold text-primary">
                  {String(POLICY_LINKS.indexOf(item) + 1).padStart(2, "0")}
                </span>
                <ArrowUpRight
                  className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary"
                  aria-hidden="true"
                />
              </div>
              <h3 className="mt-5 font-display text-lg font-semibold">{item.label}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
