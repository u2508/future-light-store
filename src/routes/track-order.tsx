import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/track-order")({
  head: () => ({
    meta: [
      { title: "Track your order — VS Store" },
      { name: "description", content: "Enter your VS Store order number and email to check delivery status." },
      { property: "og:title", content: "Track your order — VS Store" },
      { property: "og:description", content: "Check the delivery status of your VS Store order." },
    ],
  }),
  component: TrackOrderPage,
});

function TrackOrderPage() {
  const [submitted, setSubmitted] = useState(false);
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="font-display text-3xl font-bold">Track your order</h1>
      <p className="mt-2 text-sm text-muted-foreground">Use the order number from your confirmation email.</p>
      <form
        className="mt-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
        }}
      >
        <input
          required
          placeholder="Order number"
          aria-label="Order number"
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm"
        />
        <input
          required
          type="email"
          placeholder="Email address"
          aria-label="Email address"
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm"
        />
        <button className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground">
          Find my order
        </button>
      </form>
      {submitted && (
        <p className="mt-4 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          We couldn't find tracking for that order yet. Shipping confirmations include a live tracking link.
        </p>
      )}
    </div>
  );
}
