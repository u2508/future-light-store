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
        { name: "description", content: `${title} for VS Store orders, delivery and customer data.` },
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
      <h1 className="font-display text-3xl font-bold">{policy?.title ?? "Policy not found"}</h1>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {(policy?.body ?? ["This policy isn't available."]).map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    </div>
  );
}
