import { useEffect, useRef, useState } from "react";
import {
  normalizeJudgeMeRuntimeConfig,
  parseShopifyProductNumericId,
} from "@/lib/judgeme-config.js";

declare global {
  interface Window {
    __VS_STORE_JUDGEME__?: unknown;
  }
}

type JudgeMeReviewsProps = {
  productId: string;
  productTitle: string;
};

export function JudgeMeReviews({ productId, productTitle }: JudgeMeReviewsProps) {
  const widgetRoot = useRef<HTMLDivElement>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "loaded" | "failed">("idle");
  const runtimeConfig =
    typeof window === "undefined"
      ? null
      : normalizeJudgeMeRuntimeConfig(window.__VS_STORE_JUDGEME__);
  const numericProductId = parseShopifyProductNumericId(productId);
  const widgetScriptUrl = runtimeConfig?.widgetScriptUrl;

  useEffect(() => {
    if (!widgetScriptUrl || !numericProductId || !widgetRoot.current) return;

    let mounted = true;
    setLoadState("loading");
    const script = document.createElement("script");
    script.src = widgetScriptUrl;
    script.async = true;
    script.dataset["vsStoreJudgemeLoader"] = "true";
    script.onload = () => {
      if (mounted) setLoadState("loaded");
    };
    script.onerror = () => {
      if (mounted) setLoadState("failed");
    };
    document.head.appendChild(script);

    return () => {
      mounted = false;
      script.onload = null;
      script.onerror = null;
      script.remove();
    };
  }, [numericProductId, widgetScriptUrl]);

  if (!runtimeConfig || !numericProductId) {
    return (
      <section
        aria-label="Product reviews"
        className="rounded-2xl border border-border bg-background p-5 text-sm leading-6 text-muted-foreground"
      >
        Customer reviews aren’t available right now.
      </section>
    );
  }

  return (
    <section aria-label="Product reviews" aria-busy={loadState === "loading"}>
      <div
        ref={widgetRoot}
        id="judgeme_product_reviews"
        className="jdgm-widget jdgm-review-widget jdgm-outside-widget"
        data-product-title={productTitle}
        data-id={numericProductId}
        data-product-id={numericProductId}
        data-widget="review"
        data-auto-install="false"
        data-shop-reviews-count={runtimeConfig.shopReviewsCount}
        data-entry-point="review_widget.js"
        data-entry-key="review-widget/main.js"
      />
      {loadState === "failed" && (
        <p
          role="status"
          className="mt-4 rounded-2xl border border-border bg-background p-5 text-sm text-muted-foreground"
        >
          Customer reviews couldn’t be loaded. Please try again later.
        </p>
      )}
    </section>
  );
}
