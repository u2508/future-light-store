import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Account — VS Store" },
      { name: "description", content: "Manage your VS Store profile, orders and saved items." },
      { property: "og:title", content: "Account — VS Store" },
      { property: "og:description", content: "Manage your VS Store profile, orders and saved items." },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="font-display text-3xl font-bold">Account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Accounts aren't enabled yet. You can still shop and check out as a guest.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link to="/shop" className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">
          Continue shopping
        </Link>
        <Link to="/track-order" className="rounded-xl border border-border px-5 py-3 text-sm font-semibold">
          Track an order
        </Link>
      </div>
    </div>
  );
}
