import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Updates silently in the background and swaps in on next load — no "new version
      // available, click to refresh" prompt to build, which matters here since this app
      // changes often (every deploy) and a stale cached build would show wrong numbers.
      registerType: "autoUpdate",
      includeAssets: ["logo.png", "apple-touch-icon.png"],
      manifest: {
        name: "Vedansh Medicare — Lead Platform",
        short_name: "VM Leads",
        description: "Referral and lead management for Vedansh Medicare",
        // Deliberately no start_url here. Per the manifest spec, omitting it means the
        // browser falls back to the URL that was open when "Add to Home Screen" happened —
        // which matters a lot for this app, since a marketing person or leader installs from
        // their own personal deep link (/marketing/:id, /refer/:doctorCode), not from "/".
        // A hardcoded start_url would send every install to the same page regardless of
        // whose link they installed from.
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#1f9dae",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Only ever cache the built app shell (JS/CSS/fonts/icons) for fast repeat loads —
        // deliberately NOT caching anything under /api/. This app shows live referral
        // status, credit amounts, and patient data; a cached API response could show stale
        // money/status info, which is worse than just showing a loading state. Real offline
        // *submission* (queuing a lead with no signal) is a separate feature, not part of
        // this basic installable-app pass.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
});
