import { useEffect, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ArrowUpRight, X } from "lucide-react";
import { useCartStore } from "@/stores/cartStore";

const EXIT_INTENT_KEY = "vs-exit-intent-seen";

function canShowExitIntent() {
  if (typeof window === "undefined" || window.innerWidth < 768) return false;
  try {
    return sessionStorage.getItem(EXIT_INTENT_KEY) !== "1";
  } catch {
    return true;
  }
}

function markExitIntentSeen() {
  try {
    sessionStorage.setItem(EXIT_INTENT_KEY, "1");
  } catch {
    // Private browsing may block sessionStorage; the prompt still works once.
  }
}

/**
 * A single, desktop-only exit assist keeps the next action visible without
 * interrupting browsing or making unverifiable price/stock promises.
 */
export function ExitIntentPrompt() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const totalItems = useCartStore((state) =>
    state.items.reduce((sum, item) => sum + item.quantity, 0),
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    if (
      totalItems > 0 ||
      pathname === "/cart" ||
      pathname === "/checkout" ||
      !canShowExitIntent()
    ) {
      return;
    }

    let armed = false;
    const armTimer = window.setTimeout(() => {
      armed = true;
    }, 8_000);
    const handlePointerLeave = (event: MouseEvent) => {
      if (!armed || event.relatedTarget || event.clientY > 8 || !canShowExitIntent()) return;
      markExitIntentSeen();
      setOpen(true);
      window.removeEventListener("mouseout", handlePointerLeave);
    };

    window.addEventListener("mouseout", handlePointerLeave, { passive: true });
    return () => {
      window.clearTimeout(armTimer);
      window.removeEventListener("mouseout", handlePointerLeave);
    };
  }, [pathname, totalItems]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-foreground/45 p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-intent-title"
        className="relative w-full max-w-md rounded-[2rem] border border-border bg-card p-7 shadow-[var(--shadow-lift)]"
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close shopping assist"
          className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
          Before you go
        </p>
        <h2
          id="exit-intent-title"
          className="mt-3 max-w-xs font-display text-2xl font-bold tracking-tight"
        >
          Find something worth taking home.
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Browse today’s value picks or keep exploring the full VS Store catalog whenever you’re
          ready.
        </p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Link
            to="/offers"
            onClick={() => setOpen(false)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Shop today’s offers <ArrowUpRight className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-xl border border-border px-4 py-3 text-sm font-semibold transition-colors hover:border-primary hover:bg-accent"
          >
            Keep browsing
          </button>
        </div>
      </div>
    </div>
  );
}
