import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useIsStaff } from "@/hooks/useAuth";
import { toast } from "sonner";

export const SHOPIFY_ACCOUNT_URL = "https://shopify.com/106570088529/account";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Account — VS Store" },
      { name: "description", content: "Manage your VS Store profile, orders, tracking and saved items." },
      { property: "og:title", content: "Account — VS Store" },
      { property: "og:description", content: "Manage your VS Store profile, orders and saved items." },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { user, loading } = useAuth();
  const isStaff = useIsStaff(user);

  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="font-display text-3xl font-bold">Account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your VS profile keeps your bag and wishlist in sync. Orders, addresses and payment methods live in your
        secure Shopify customer account.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <a
          href={SHOPIFY_ACCOUNT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary"
        >
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            Shopify customer account <ExternalLink className="h-4 w-4" />
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with your email code to see orders, invoices, addresses and returns.
          </p>
        </a>

        <Link to="/track-order" className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary">
          <h2 className="font-display text-lg font-semibold">Track an order</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Live fulfilment and tracking status using your order number and email.
          </p>
        </Link>

        <Link to="/wishlist" className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary">
          <h2 className="font-display text-lg font-semibold">Wishlist</h2>
          <p className="mt-1 text-sm text-muted-foreground">Items you've saved for later.</p>
        </Link>

        <Link to="/cart" className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary">
          <h2 className="font-display text-lg font-semibold">Your bag</h2>
          <p className="mt-1 text-sm text-muted-foreground">Review your bag and continue to secure checkout.</p>
        </Link>
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card p-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Checking session…</p>
        ) : user ? (
          <>
            <p className="text-sm">
              Signed in as <span className="font-semibold">{user.email}</span>
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {isStaff && (
                <Link to="/admin/finance" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                  Open finance workspace
                </Link>
              )}
              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                  toast.success("Signed out");
                }}
                className="rounded-xl border border-border px-4 py-2 text-sm font-semibold"
              >
                Sign out
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Sign in to a VS profile to sync your bag across devices, or continue as a guest.
            </p>
            <Link to="/auth" className="mt-4 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              Sign in to VS
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
