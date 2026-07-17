// Registered manually (not vite-plugin-pwa's auto-injected registerSW.js) because the
// worker needs scope: "/" to cover /vunapos, which the default asset-path scope can't
// (see the ASSET_PREFIX note in vite.config.ts). The build copies sw.js to the site
// root (copy-service-worker in package.json) so it's served at /sw.js.
export function registerServiceWorker() {
	if (!("serviceWorker" in navigator)) {
		return;
	}

	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
			console.error("Service worker registration failed", err);
		});
	});
}
