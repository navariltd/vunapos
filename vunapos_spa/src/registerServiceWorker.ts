// Registered manually (not vite-plugin-pwa's auto-injected registerSW.js) because the
// worker needs scope: "/" to cover /vunapos, which the default asset-path scope can't
// (see the ASSET_PREFIX note in vite.config.ts). The build copies sw.js to the site
// root (copy-service-worker in package.json) so it's served at /sw.js.
export function registerServiceWorker() {
	// Vite's development server falls back to index.html for /sw.js, which browsers
	// reject as a service worker because it has text/html content. The production
	// build copies the generated worker to /sw.js, so registration belongs there only.
	if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
		return;
	}

	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
			console.error("Service worker registration failed", err);
		});
	});
}
