import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from 'vite-plugin-pwa';

import proxyOptions from "./proxyOptions";

// Frappe serves built assets at /assets/vunapos/vunapos/ (build.outDir below), but a service
// worker's scope can't cover a sibling directory like /vunapos - only its own dir or a
// descendant. So sw.js is copied to the site root instead (copy-service-worker in
// package.json), and Workbox's relative precache URLs must be rewritten to this prefix or
// every precached asset 404s (manifestTransforms below).
const ASSET_PREFIX = "/assets/vunapos/vunapos/";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss(), VitePWA({
		registerType: 'autoUpdate',
		// Registered manually (src/registerServiceWorker.ts) with scope '/' - vite-plugin-pwa's
		// auto-injected registration would use the asset path as scope, which can't cover
		// /vunapos (see ASSET_PREFIX above).
		injectRegister: false,
		// manifest: false + hand-rolled public/manifest.webmanifest (linked in index.html) -
		// vite-plugin-pwa's own manifest/icon injection bypasses manifestTransforms below, so
		// those URLs never get rewritten to ASSET_PREFIX and 404. The normal public/ glob avoids that.
		manifest: false,
		workbox: {
			// Without this, sw.js importScripts() a relative workbox-<hash>.js chunk resolved
			// against sw.js's copied location (site root), not where the chunk actually lives -
			// 404. Inlining avoids needing a second copy-to-root step for that chunk.
			inlineWorkboxRuntime: true,
			// Extended past the default (js/css/html) so the manifest and icons go through
			// normal glob-discovery precache, which - unlike includeAssets/manifest injection -
			// respects manifestTransforms below.
			globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
			// /vunapos is the actual page route; it must be precached for
			// navigateFallback to serve it offline (Workbox requires the fallback
			// URL itself to be in the precache manifest).
			navigateFallback: '/vunapos',
			additionalManifestEntries: [{ url: '/vunapos', revision: null }],
			// SW scope is '/' (site root), so without this, navigateFallback intercepts every
			// navigation on the site - including /login. Live-verified bug: an expired session
			// redirects to /login (AuthGate.tsx), the SW serves the cached /vunapos shell
			// instead, AuthGate remounts, still has no session, and redirects again -
			// compounding into an infinite redirect loop. Anything outside /vunapos must
			// always hit the real network.
			navigateFallbackDenylist: [/^(?!\/vunapos(?:$|\/)).*/],
			// The service worker never opportunistically caches API responses -
			// offline data flows only through the deliberate Dexie layer (I3/§9.2:
			// events and caches are doorbells/replicas, never a second source of truth).
			runtimeCaching: [
				{
					urlPattern: /^\/api\//,
					handler: 'NetworkOnly',
				},
			],
			manifestTransforms: [
				(entries) => ({
					manifest: entries.map((entry) =>
						entry.url.startsWith('/') ? entry : { ...entry, url: `${ASSET_PREFIX}${entry.url}` },
					),
					warnings: [],
				}),
			],
		},
	})],
	server: {
		port: 8080,
		host: "0.0.0.0",
		proxy: proxyOptions,
	},
	build: {
		outDir: "../vunapos/public/vunapos",
		emptyOutDir: true,
		target: "es2015",
	},
});
