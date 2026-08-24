import { createFileRoute } from "@tanstack/react-router";
import { POLICIES } from "@/lib/policies";
import { canonicalUrl } from "@/lib/seo";

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
    <div className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
        VS Store
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold">
        {policy?.title ?? "Policy not found"}
      </h1>
      {policy ? (
        <>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{policy.description}</p>
          {policy.updated && (
            <p className="mt-2 text-xs text-muted-foreground">Last updated: {policy.updated}</p>
          )}
          <div className="mt-8 space-y-8 text-sm leading-7 text-muted-foreground">
            {policy.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="font-display text-lg font-semibold text-foreground">
                  {section.heading}
                </h2>
                <div className="mt-2 space-y-3">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          This policy isn't available.
        </p>
      )}
    </div>
  );
}
