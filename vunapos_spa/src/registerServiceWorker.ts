// This cache-free worker preserves PWA installation without providing offline behavior.
export function registerServiceWorker() {
	// Production copies the static worker to /sw.js so it can cover /vunapos.
	if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
		return;
	}

	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
			console.error("Service worker registration failed", err);
		});
	});
}
