import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), tailwindcss(), react()],
  // The OneDrive build runner copies public assets with rsync after Vite has
  // compiled. Skipping Vite's provider-backed recursive copy avoids stalls
  // while preserving the normal public directory behavior everywhere else.
  publicDir: process.env.SALT_BUILD_SKIP_PUBLIC_COPY === "1" ? false : "public",
  resolve: { tsconfigPaths: true },
});
