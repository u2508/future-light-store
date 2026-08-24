import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Mail, PackageCheck, RotateCcw, ShieldCheck } from "lucide-react";
import { canonicalUrl } from "@/lib/seo";
import { FAQS } from "@/lib/seo-content";
import { STORE_CONTACT } from "@/lib/store-contact";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help centre — VS Store" },
      {
        name: "description",
        content: "Answers on delivery, returns, payments and order tracking at VS Store.",
      },
      { property: "og:title", content: "Help centre — VS Store" },
      {
        property: "og:description",
        content: "Answers on delivery, returns, payments and order tracking.",
      },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/help") }],
  }),
  component: HelpPage,
});

function HelpPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQS.map((faq) => ({
              "@type": "Question",
              name: faq.question,
              acceptedAnswer: { "@type": "Answer", text: faq.answer },
            })),
          }),
        }}
      />
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[2rem] vs-hero-gradient p-7 text-primary-foreground shadow-[var(--shadow-lift)] sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] opacity-75">
            VS Store / Support
          </p>
          <h1 className="mt-4 font-display text-3xl font-bold sm:text-5xl">
            Help, without the runaround.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 opacity-85">
            Answers on delivery, returns, payments and order tracking—plus a direct path to the
            right next step.
          </p>
          <div className="mt-7 flex flex-wrap gap-2">
            <Link
              to="/track-order"
              className="inline-flex items-center gap-2 rounded-full bg-primary-foreground px-4 py-2.5 text-sm font-semibold text-foreground"
            >
              Track an order <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              to="/policies"
              className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/25 bg-primary-foreground/10 px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Read policies
            </Link>
          </div>
        </div>
        <div className="vs-premium-panel rounded-[2rem] p-7 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Quick support
          </p>
          <div className="mt-5 space-y-4 text-sm">
            <a
              href={`mailto:${STORE_CONTACT.email}`}
              className="flex items-start gap-3 transition-colors hover:text-primary"
            >
              <Mail className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />
              <span>
                <span className="block font-semibold">Email support</span>
                <span className="mt-1 block break-all text-muted-foreground">
                  {STORE_CONTACT.email}
                </span>
              </span>
            </a>
            <div className="border-t border-border/70 pt-4 text-muted-foreground">
              <p className="flex items-center gap-3">
                <PackageCheck className="h-4 w-4 text-primary" /> Tracking is sent after dispatch.
              </p>
              <p className="mt-3 flex items-center gap-3">
                <RotateCcw className="h-4 w-4 text-primary" /> Eligible returns can be requested
                within 30 days.
              </p>
              <p className="mt-3 flex items-center gap-3">
                <ShieldCheck className="h-4 w-4 text-primary" /> Checkout is handled securely by
                Shopify.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-8 space-y-3">
        {FAQS.map((faq) => (
          <details
            key={faq.question}
            className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]"
          >
            <summary className="cursor-pointer font-medium">{faq.question}</summary>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{faq.answer}</p>
          </details>
        ))}
      </div>
      <Link
        to="/track-order"
        className="mt-6 inline-block text-sm font-semibold text-primary hover:underline"
      >
        Track an order →
      </Link>
    </div>
  );
}
