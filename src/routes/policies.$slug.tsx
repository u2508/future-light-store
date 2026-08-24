import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight, Mail, Phone } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { POLICIES } from "@/lib/policies";
import { canonicalUrl } from "@/lib/seo";
import { STORE_CONTACT } from "@/lib/store-contact";

export const Route = createFileRoute("/policies/$slug")({
  head: ({ params }) => {
    const policy = POLICIES[params.slug];
    const title = policy?.title ?? "Policy";
    return {
      meta: [
        { title: `${title} — VS Store` },
        {
          name: "description",
          content: `${title} for VS Store orders, delivery and customer data.`,
        },
        { property: "og:title", content: `${title} — VS Store` },
        { property: "og:description", content: `${title} for VS Store orders and customers.` },
      ],
      links: [{ rel: "canonical", href: canonicalUrl(`/policies/${params.slug}`) }],
    };
  },
  component: PolicyPage,
});

function PolicyPage() {
  const { slug } = Route.useParams();
  const policy = POLICIES[slug];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:py-14">
      <div className="rounded-[2rem] vs-hero-gradient p-7 text-primary-foreground shadow-[var(--shadow-lift)] sm:p-10">
        <Link
          to="/policies"
          className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] opacity-80 transition-opacity hover:opacity-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Policies &amp; support
        </Link>
        <p className="mt-10 text-xs font-semibold uppercase tracking-[0.28em] opacity-70">
          VS Store / Customer information
        </p>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold sm:text-5xl">
          {policy?.title ?? "Policy not found"}
        </h1>
        {policy && (
          <p className="mt-4 max-w-2xl text-sm leading-7 opacity-85">{policy.description}</p>
        )}
        {policy?.updated && (
          <p className="mt-4 text-xs uppercase tracking-[0.16em] opacity-65">
            Last updated: {policy.updated}
          </p>
        )}
      </div>

      {policy ? (
        <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="self-start lg:sticky lg:top-28">
            <div className="rounded-[1.5rem] border border-border/70 bg-card p-5 shadow-[var(--shadow-card)]">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                On this page
              </p>
              <nav className="mt-4 space-y-1" aria-label="Policy sections">
                {policy.sections.map((section) => (
                  <a
                    key={section.heading}
                    href={`#${sectionId(section.heading)}`}
                    className="block rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {section.heading}
                  </a>
                ))}
              </nav>
              <Link
                to="/policies/$slug"
                params={{ slug: "contact" }}
                className="mt-5 flex items-center justify-between border-t border-border/70 pt-5 text-sm font-semibold text-primary"
              >
                Contact support
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </aside>

          <article className="vs-section-shell rounded-[2rem] p-6 sm:p-10">
            <div className="max-w-3xl space-y-10 text-sm leading-7 text-muted-foreground">
              {policy.sections.map((section) => (
                <section
                  key={section.heading}
                  id={sectionId(section.heading)}
                  className="scroll-mt-28"
                >
                  <h2 className="font-display text-xl font-semibold text-foreground sm:text-2xl">
                    {section.heading}
                  </h2>
                  <div className="mt-3 space-y-4">
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <div className="mt-10 flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/35 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-foreground">Need help with an order?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Our support details are always available.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`mailto:${STORE_CONTACT.email}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  Email
                </a>
                <a
                  href={`tel:${STORE_CONTACT.phoneHref}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  Call
                </a>
              </div>
            </div>
          </article>
        </div>
      ) : (
        <p className="mt-8 text-sm leading-relaxed text-muted-foreground">
          This policy isn&apos;t available.
        </p>
      )}
    </div>
  );
}

function sectionId(heading: string) {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
