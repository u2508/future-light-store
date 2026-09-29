import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  getMarketingConsentSnapshot,
  reopenMarketingPreferences,
  saveMarketingConsent,
  subscribeMarketingConsent,
} from "@/lib/marketingAnalytics";
import type {
  MarketingConsentPreferences,
  MarketingConsentSnapshot,
} from "@/lib/marketingConsent.mjs";
import { SHOPIFY_POLICY_SLUGS } from "@/lib/policies";
import { STORE_CONTACT } from "@/lib/store-contact";

const COLUMNS = [
  {
    title: "Company",
    links: [
      { label: "Home", to: "/" as const },
      { label: "About us", to: "/about" as const },
      {
        label: "Contact us",
        to: "/policies/$slug" as const,
        params: { slug: SHOPIFY_POLICY_SLUGS.contact },
      },
      { label: "Track order", to: "/track-order" as const },
      { label: "Help centre", to: "/help" as const },
    ],
  },
  {
    title: "Explore",
    links: [
      { label: "Shop all", to: "/shop" as const },
      { label: "Collections", to: "/collections" as const },
      {
        label: "New Arrivals",
        to: "/collections/$handle" as const,
        params: { handle: "new-arrivals" },
      },
      {
        label: "Curated Picks",
        to: "/collections/$handle" as const,
        params: { handle: "best-sellers" },
      },
      {
        label: "Premium Picks",
        to: "/collections/$handle" as const,
        params: { handle: "premium-picks" },
      },
    ],
  },
  {
    title: "Policies",
    links: [
      {
        label: "Shipping",
        to: "/policies/$slug" as const,
        params: { slug: SHOPIFY_POLICY_SLUGS.shipping },
      },
      {
        label: "Returns",
        to: "/policies/$slug" as const,
        params: { slug: SHOPIFY_POLICY_SLUGS.returns },
      },
      {
        label: "Privacy",
        to: "/policies/$slug" as const,
        params: { slug: SHOPIFY_POLICY_SLUGS.privacy },
      },
      {
        label: "Terms",
        to: "/policies/$slug" as const,
        params: { slug: SHOPIFY_POLICY_SLUGS.terms },
      },
      {
        label: "Legal notice",
        to: "/policies/$slug" as const,
        params: { slug: SHOPIFY_POLICY_SLUGS["legal-notice"] },
      },
    ],
  },
];

export function Footer() {
  const [consent, setConsent] = useState<MarketingConsentSnapshot | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [analyticsChoice, setAnalyticsChoice] = useState(false);
  const [advertisingChoice, setAdvertisingChoice] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [consentNotice, setConsentNotice] = useState("");

  useEffect(() => {
    const unsubscribe = subscribeMarketingConsent(setConsent);
    setConsent(getMarketingConsentSnapshot());
    return unsubscribe;
  }, []);

  const savePreferences = async (preferences: MarketingConsentPreferences) => {
    setSavingConsent(true);
    setConsentNotice("");
    const result = await saveMarketingConsent(preferences);
    setSavingConsent(false);
    if (!result.saved) {
      setConsentNotice(
        "Your privacy settings could not be saved. Tracking remains off until they can be confirmed.",
      );
      return;
    }
    if (!result.persisted) {
      setAnalyticsChoice(preferences.analytics);
      setAdvertisingChoice(preferences.advertising);
      setConsentNotice(
        "Your choice is active for this visit only because browser storage is unavailable. After a reload, optional tracking will stay off until you choose again.",
      );
      setPreferencesOpen(true);
      return;
    }
    setPreferencesOpen(false);
  };

  const openPreferences = async () => {
    const current = consent ?? getMarketingConsentSnapshot();
    setConsentNotice("");
    if (current.source === "shopify") {
      const opened = await reopenMarketingPreferences();
      if (!opened) {
        setConsentNotice(
          "Cookie choices on this Shopify page are managed by Shopify. Its preferences panel is not available here.",
        );
      }
      return;
    }
    setAnalyticsChoice(current.analytics);
    setAdvertisingChoice(current.advertising);
    setPreferencesOpen(true);
  };

  const showStandaloneBanner = consent?.source === "standalone" && !consent.explicit;

  return (
    <>
      <footer className="mt-20 border-t border-foreground/10 bg-foreground text-background">
        <div className="vs-wide-shell grid gap-12 py-14 sm:py-16 lg:grid-cols-[1.15fr_repeat(3,minmax(0,0.8fr))_1.55fr]">
          <div className="space-y-6">
            <VsLogo inverse />
            <p className="max-w-xs text-sm leading-7 text-background/70">
              A future-facing marketplace with precise discovery, honest pricing and fulfilment you
              can follow from checkout to delivery.
            </p>
            <div className="flex items-center gap-2" aria-label="VS Associates contact shortcuts">
              <a
                href={`mailto:${STORE_CONTACT.email}`}
                aria-label="Email VS Associates"
                className="grid h-10 w-10 place-items-center rounded-full border border-background/15 text-background/75 transition-colors hover:border-background/40 hover:text-background"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
              </a>
              <a
                href={`tel:${STORE_CONTACT.phoneHref}`}
                aria-label="Call VS Associates"
                className="grid h-10 w-10 place-items-center rounded-full border border-background/15 text-background/75 transition-colors hover:border-background/40 hover:text-background"
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
              </a>
              <Link
                to="/help"
                aria-label="Open VS Associates help centre"
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
          <div className="vs-wide-shell flex flex-col gap-5 py-7 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              <TrustBadge icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Secure checkout" />
              <TrustBadge
                icon={<PackageCheck className="h-3.5 w-3.5" />}
                label="Tracked shipping"
              />
              <TrustBadge icon={<RotateCcw className="h-3.5 w-3.5" />} label="Easy returns" />
            </div>
            <div className="flex flex-col items-start gap-4 text-xs text-background/55 md:items-end">
              <p>© {new Date().getFullYear()} VS Associates. All rights reserved.</p>
              <PaymentMethods />
              <div className="flex flex-wrap gap-x-5 gap-y-2 uppercase tracking-[0.18em]">
                <Link
                  to="/policies/$slug"
                  params={{ slug: SHOPIFY_POLICY_SLUGS.shipping }}
                  className="transition-colors hover:text-background"
                >
                  Policies
                </Link>
                <Link
                  to="/policies/$slug"
                  params={{ slug: SHOPIFY_POLICY_SLUGS.contact }}
                  className="transition-colors hover:text-background"
                >
                  Contact us
                </Link>
                <button
                  type="button"
                  onClick={() => void openPreferences()}
                  className="transition-colors hover:text-background"
                >
                  Cookie preferences
                </button>
                <span>Powered by Shopify</span>
              </div>
              {consentNotice ? (
                <p role="status" aria-live="polite" className="max-w-lg text-left normal-case">
                  {consentNotice}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </footer>
      {showStandaloneBanner ? (
        <section
          aria-labelledby="vs-consent-banner-title"
          className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-4xl rounded-2xl border border-border bg-background p-5 text-foreground shadow-2xl sm:inset-x-6 sm:p-6"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <h2 id="vs-consent-banner-title" className="text-base font-semibold">
                Your privacy choices
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Optional analytics help us understand website usage. Advertising tools help measure
                and personalize promotions. Both stay off unless you choose them.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={savingConsent}
                onClick={() => void savePreferences({ analytics: false, advertising: false })}
              >
                Reject optional
              </Button>
              <Button type="button" variant="outline" onClick={() => void openPreferences()}>
                Customize
              </Button>
              <Button
                type="button"
                disabled={savingConsent}
                onClick={() => void savePreferences({ analytics: true, advertising: true })}
              >
                Accept all
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Cookie and tracking preferences</DialogTitle>
            <DialogDescription>
              Essential storage supports the shopping bag and checkout. Optional categories are
              independent and can be changed here at any time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="flex items-start justify-between gap-5 rounded-xl border p-4">
              <div className="space-y-1">
                <Label htmlFor="vs-analytics-consent" className="text-sm font-semibold">
                  Analytics
                </Label>
                <p className="text-sm leading-5 text-muted-foreground">
                  Allows the website to measure visits, searches, and shopping actions.
                </p>
              </div>
              <Switch
                id="vs-analytics-consent"
                checked={analyticsChoice}
                onCheckedChange={setAnalyticsChoice}
                aria-label="Allow analytics"
              />
            </div>
            <div className="flex items-start justify-between gap-5 rounded-xl border p-4">
              <div className="space-y-1">
                <Label htmlFor="vs-advertising-consent" className="text-sm font-semibold">
                  Advertising
                </Label>
                <p className="text-sm leading-5 text-muted-foreground">
                  Allows advertising pixels and campaign attribution. This choice is separate from
                  analytics.
                </p>
              </div>
              <Switch
                id="vs-advertising-consent"
                checked={advertisingChoice}
                onCheckedChange={setAdvertisingChoice}
                aria-label="Allow advertising and attribution"
              />
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Essential checkout and cart functions remain available when optional tracking is off.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={savingConsent}
              onClick={() => void savePreferences({ analytics: false, advertising: false })}
            >
              Reject optional
            </Button>
            <Button
              type="button"
              disabled={savingConsent}
              onClick={() =>
                void savePreferences({
                  analytics: analyticsChoice,
                  advertising: advertisingChoice,
                })
              }
            >
              {savingConsent ? "Saving…" : "Save choices"}
            </Button>
          </DialogFooter>
          {consentNotice ? (
            <p role="alert" className="text-sm text-destructive">
              {consentNotice}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
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

const PAYMENT_METHODS = [
  "Visa",
  "Mastercard",
  "Maestro",
  "American Express",
  "Diners Club",
  "RuPay",
] as const;

function PaymentMethods() {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Accepted payment methods">
      {PAYMENT_METHODS.map((method) => (
        <span
          key={method}
          role="img"
          aria-label={method}
          title={method}
          className="grid h-7 min-w-11 place-items-center rounded-md border border-background/15 bg-white px-1.5 text-[9px] font-black leading-none tracking-tight text-[#172554] shadow-sm"
        >
          {method === "Visa" && <span className="text-[13px] italic">VISA</span>}
          {method === "Mastercard" && (
            <span className="flex -space-x-1">
              <span className="h-3.5 w-3.5 rounded-full bg-[#eb001b]" />
              <span className="h-3.5 w-3.5 rounded-full bg-[#f79e1b]" />
            </span>
          )}
          {method === "Maestro" && (
            <span className="flex -space-x-1">
              <span className="h-3 w-3 rounded-full bg-[#ed1c2e]" />
              <span className="h-3 w-3 rounded-full bg-[#0099df]" />
            </span>
          )}
          {method === "American Express" && (
            <span className="rounded-sm bg-[#1476c6] px-1 py-0.5 text-[8px] leading-[0.85] text-white">
              AM
              <br />
              EX
            </span>
          )}
          {method === "Diners Club" && (
            <span className="grid h-4 w-4 place-items-center rounded-full border-2 border-[#1476c6] text-[8px] text-[#1476c6]">
              D
            </span>
          )}
          {method === "RuPay" && <span className="text-[10px] italic text-[#243b8f]">RuPay</span>}
        </span>
      ))}
    </div>
  );
}
