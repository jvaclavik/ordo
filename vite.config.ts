import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";
import { devApi } from "./scripts/devApi.ts";

export default defineConfig({
  server: { port: 5177 },
  plugins: [
    devApi(),
    tailwindcss(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "icon-192.png",
        "icon-512.png",
        "icon-maskable-512.png",
      ],
      manifest: {
        name: "Ordo",
        short_name: "Ordo",
        description: "Seznamy, nástěnky a poznámky na jednom místě.",
        lang: "cs",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f4f3f0",
        theme_color: "#f4f3f0",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          {
            name: "Nový úkol",
            short_name: "Přidat",
            url: "/add",
            description: "Rychle přidat úkol",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2,wasm}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [
          /^\/sw\.js$/,
          /^\/workbox-.*\.js$/,
          /^\/api\//,
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "api/**/*.test.ts"],
  },
});
