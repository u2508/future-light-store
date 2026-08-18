import { createFileRoute, Link } from "@tanstack/react-router";
import { canonicalUrl } from "@/lib/seo";
import { FAQS } from "@/lib/seo-content";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help centre — VS Store" },
      { name: "description", content: "Answers on delivery, returns, payments and order tracking at VS Store." },
      { property: "og:title", content: "Help centre — VS Store" },
      { property: "og:description", content: "Answers on delivery, returns, payments and order tracking." },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/help") }],
  }),
  component: HelpPage,
});

function HelpPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
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
      <div className="vs-section-shell rounded-[2rem] p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">Support</p>
        <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Help centre</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          Answers on delivery, returns, payments and order tracking at VS Store.
        </p>
      </div>
      <div className="mt-6 space-y-3">
        {FAQS.map((faq) => (
          <details key={faq.question} className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <summary className="cursor-pointer font-medium">{faq.question}</summary>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{faq.answer}</p>
          </details>
        ))}
      </div>
      <Link to="/track-order" className="mt-6 inline-block text-sm font-semibold text-primary hover:underline">
        Track an order →
      </Link>
    </div>
  );
}
