import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "./styles.css";

const rootElement = document.getElementById("root");

// The Shopify theme loads this shared entry on native Shopify pages too
// (policies, checkout-adjacent surfaces, and other platform-owned templates).
// Those pages intentionally do not render the React application root, so the
// entry must remain a no-op there instead of creating a false runtime error.
if (rootElement) {
  const router = getRouter();

  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
