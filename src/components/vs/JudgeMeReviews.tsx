import { useEffect, useRef, useState } from "react";
import {
  type JudgeMeRuntimeConfig,
  normalizeJudgeMeRuntimeConfig,
  parseShopifyProductNumericId,
} from "@/lib/judgeme-config.js";

declare global {
  interface Window {
    __VS_STORE_JUDGEME__?: unknown;
  }
}

type JudgeMeReviewsProps = {
  active: boolean;
  productId: string;
  productTitle: string;
};

type JudgeMeLoader = {
  src: string;
  promise: Promise<void>;
};

const JUDGEME_LOADER_SELECTOR = "script[data-vs-store-judgeme-loader='true']";
let judgeMeLoader: JudgeMeLoader | null = null;

function ensureJudgeMeLoader(widgetScriptUrl: string) {
  const existing = document.querySelector<HTMLScriptElement>(JUDGEME_LOADER_SELECTOR);
  if (existing) {
    if (existing.src !== widgetScriptUrl) {
      return Promise.reject(
        new Error("Judge.me loader URL does not match the active store config."),
      );
    }
    if (existing.dataset["vsStoreJudgemeState"] === "loaded") return Promise.resolve();
    if (existing.dataset["vsStoreJudgemeState"] === "failed") existing.remove();
    else if (judgeMeLoader?.src === widgetScriptUrl) return judgeMeLoader.promise;
    else {
      return new Promise<void>((resolve, reject) => {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("Judge.me loader failed to load.")),
          { once: true },
        );
      });
    }
  }

  if (judgeMeLoader) {
    return judgeMeLoader.src === widgetScriptUrl
      ? judgeMeLoader.promise
      : Promise.reject(new Error("Judge.me loader URL does not match the active store config."));
  }

  const script = document.createElement("script");
  script.src = widgetScriptUrl;
  script.async = true;
  script.dataset["vsStoreJudgemeLoader"] = "true";
  script.dataset["vsStoreJudgemeState"] = "loading";

  const promise = new Promise<void>((resolve, reject) => {
    script.addEventListener(
      "load",
      () => {
        script.dataset["vsStoreJudgemeState"] = "loaded";
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        script.dataset["vsStoreJudgemeState"] = "failed";
        script.remove();
        if (judgeMeLoader?.promise === promise) judgeMeLoader = null;
        reject(new Error("Judge.me loader failed to load."));
      },
      { once: true },
    );
  });
  judgeMeLoader = { src: widgetScriptUrl, promise };
  document.head.appendChild(script);
  return promise;
}

export function JudgeMeReviews({ active, productId, productTitle }: JudgeMeReviewsProps) {
  const widgetRoot = useRef<HTMLDivElement>(null);
  const loaderReady = useRef(false);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "loaded" | "failed">("idle");
  const [runtimeConfig, setRuntimeConfig] = useState<JudgeMeRuntimeConfig | null>(null);
  const numericProductId = parseShopifyProductNumericId(productId);

  useEffect(() => {
    if (!active || !numericProductId || runtimeConfig) return;

    const config = normalizeJudgeMeRuntimeConfig(window.__VS_STORE_JUDGEME__);
    if (!config) {
      setLoadState("failed");
      return;
    }

    setRuntimeConfig((current) =>
      current?.widgetScriptUrl === config.widgetScriptUrl &&
      current.shopReviewsCount === config.shopReviewsCount
        ? current
        : config,
    );
  }, [active, numericProductId, runtimeConfig]);

  useEffect(() => {
    if (
      !active ||
      !numericProductId ||
      !widgetRoot.current ||
      !runtimeConfig ||
      loaderReady.current
    ) {
      return;
    }

    let mounted = true;
    setLoadState("loading");
    void ensureJudgeMeLoader(runtimeConfig.widgetScriptUrl).then(
      () => {
        loaderReady.current = true;
        if (mounted) setLoadState("loaded");
      },
      () => {
        if (mounted) setLoadState("failed");
      },
    );

    // Keep the script and its widget DOM in place. The Reviews tab is force-
    // mounted by the parent; changing tabs must not tear down Judge.me state.
    return () => {
      mounted = false;
    };
  }, [active, numericProductId, runtimeConfig]);

  if (!numericProductId) {
    return (
      <section
        aria-label="Product reviews"
        className="rounded-2xl border border-border bg-background p-5 text-sm leading-6 text-muted-foreground"
      >
        Reviews could not be connected to this product.
      </section>
    );
  }

  return (
    <section aria-label="Product reviews" aria-busy={loadState === "loading"}>
      <div
        ref={widgetRoot}
        className="jdgm-widget jdgm-review-widget jdgm-outside-widget"
        data-id={numericProductId}
        data-product-title={productTitle}
        data-shop-reviews-count={runtimeConfig?.shopReviewsCount}
      />
      {loadState === "loading" && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Loading customer reviews…
        </p>
      )}
      {loadState === "failed" && (
        <p
          role="status"
          className="mt-4 rounded-2xl border border-border bg-background p-5 text-sm text-muted-foreground"
        >
          Reviews are temporarily unavailable. Please try again later.
        </p>
      )}
    </section>
  );
}
